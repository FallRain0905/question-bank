import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAgentRun, updateAgentRun } from '@/lib/agent-run-service';
import { getUserLLMConfig, getUserResearchToolConfig } from '@/lib/user-settings';
import { runConfirmedDocumentLangGraphTurn, runSynapseLangGraphTurn } from '@/lib/synapse-runtime';
import type { AgentPlan } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

const FLASH_MODEL = 'deepseek-ai/DeepSeek-V4-Flash';

function clientForToken(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

async function getAuthedClient(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return { error: NextResponse.json({ error: 'Please log in first' }, { status: 401 }) };
  const supabase = clientForToken(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Please log in first' }, { status: 401 }) };
  return { token, supabase, user };
}

function schemaHint(error: any) {
  const message = error?.message || String(error || '');
  if (message.includes('agent_runs') || message.includes('agent_run_events')) {
    return `${message} Please run supabase/migration_agent_runs.sql first.`;
  }
  if (message.includes('memories') || message.includes('memory_settings') || message.includes('memory_events')) {
    return `${message} 请先执行 supabase/migration_synapse_memory_phase1.sql。`;
  }
  if (message.includes('agent_conversations') || message.includes('agent_messages') || message.includes('agent_tool_traces') || message.includes('agent_files')) {
    return `${message} 请先执行 supabase/migration_synapse_agent.sql。`;
  }
  if (message.includes('agent_documents') || message.includes('schema cache')) {
    return `${message} 请先执行 supabase/migration_agent_documents.sql。`;
  }
  return message || 'Agent request failed';
}

function sseResponse(
  run: (send: (event: string, data: Record<string, any>) => Promise<void>) => Promise<any>,
  onError?: (error: any) => Promise<void> | void
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      async function send(event: string, data: Record<string, any>) {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }
      const heartbeat = setInterval(() => {
        send('ping', { ts: Date.now() }).catch(() => {});
      }, 15_000);

      try {
        await send('status', { message: 'Synapse 正在启动 LangGraph...' });
        const result = await run(send);
        await send('result', result);
        await send('done', { ok: true });
      } catch (error: any) {
        console.error('Synapse stream error:', error);
        await onError?.(error);
        await send('error', { error: schemaHint(error) });
      } finally {
        closed = true;
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;

  let agentRun: any = null;
  try {
    const body = await req.json().catch(() => ({}));
    const message = String(body.message || '').trim();
    const conversationId = String(body.conversationId || '').trim() || undefined;
    const agentSettings = {
      model: body.agentSettings?.model === FLASH_MODEL ? FLASH_MODEL : undefined,
      thinkingEnabled: body.agentSettings?.thinkingEnabled !== false,
    };
    if (!message) return NextResponse.json({ error: 'Missing message' }, { status: 400 });

    const [llmConfig, toolConfig] = await Promise.all([
      getUserLLMConfig(auth.token),
      getUserResearchToolConfig(auth.token),
    ]);

    const shouldStream = body.stream === true || req.headers.get('accept')?.includes('text/event-stream');
    const shouldQueue = body.background === true;
    if (body.confirmedPlan && !conversationId) {
      return NextResponse.json({ error: 'Missing conversationId for confirmed action' }, { status: 400 });
    }
    agentRun = await createAgentRun(auth.supabase, auth.user.id, {
      conversationId,
      input: {
        message,
        confirmedPlan: body.confirmedPlan || null,
        stream: shouldStream,
        background: shouldQueue,
        conversationId: conversationId || null,
        agentSettings,
      },
      metadata: {
        runtime: 'langgraph',
        agentSettings,
      },
      status: shouldQueue ? 'queued' : 'running',
    });
    const markRunFailed = (error: any) => updateAgentRun(auth.supabase, auth.user.id, agentRun.id, {
      status: 'failed',
      error: schemaHint(error),
      finishedAt: new Date().toISOString(),
    }).catch(updateError => console.warn('Synapse run failure update failed:', updateError));
    if (shouldQueue) {
      return NextResponse.json({
        type: 'queued',
        runId: agentRun.id,
        conversationId: conversationId || null,
        message: 'Synapse run queued. A background worker can execute it and write events to agent_run_events.',
      });
    }

    if (body.confirmedPlan) {
      const input = {
        userId: auth.user.id,
        message,
        conversationId: conversationId!,
        confirmedPlan: body.confirmedPlan as AgentPlan,
        supabase: auth.supabase,
        llmConfig,
        toolConfig,
        agentSettings,
        runId: agentRun.id,
      };
      if (shouldStream) {
        return sseResponse(async send => {
          await send('run', { runId: agentRun.id, status: 'running', conversationId });
          const result = await runConfirmedDocumentLangGraphTurn({
            ...input,
            onEvent: event => send(event.type, event as any),
          });
          await updateAgentRun(auth.supabase, auth.user.id, agentRun.id, {
            conversationId: result.conversation?.id || conversationId,
            status: 'completed',
            output: {
              type: result.type,
              conversationId: result.conversation?.id || conversationId,
              documentId: result.document?.id || null,
              toolCallCount: result.toolCalls?.length || 0,
            },
            finishedAt: new Date().toISOString(),
          });
          return result;
        }, markRunFailed);
      }
      const result = await runConfirmedDocumentLangGraphTurn(input);
      await updateAgentRun(auth.supabase, auth.user.id, agentRun.id, {
        conversationId: result.conversation?.id || conversationId,
        status: 'completed',
        output: {
          type: result.type,
          conversationId: result.conversation?.id || conversationId,
          documentId: result.document?.id || null,
          toolCallCount: result.toolCalls?.length || 0,
        },
        finishedAt: new Date().toISOString(),
      });
      return NextResponse.json(result);
    }

    const input = {
      userId: auth.user.id,
      message,
      conversationId,
      supabase: auth.supabase,
      llmConfig,
      toolConfig,
      agentSettings,
      runId: agentRun.id,
    };
    if (shouldStream) {
      return sseResponse(async send => {
        await send('run', { runId: agentRun.id, status: 'running', conversationId: conversationId || null });
        const result = await runSynapseLangGraphTurn({
          ...input,
          onEvent: event => send(event.type, event as any),
        });
        await updateAgentRun(auth.supabase, auth.user.id, agentRun.id, {
          conversationId: result.conversation?.id || conversationId || null,
          status: 'completed',
          output: {
            type: result.type,
            conversationId: result.conversation?.id || null,
            messageId: result.assistant?.id || null,
            toolCallCount: result.toolCalls?.length || 0,
            sourceCount: result.sources?.length || 0,
          },
          finishedAt: new Date().toISOString(),
        });
        return result;
      }, markRunFailed);
    }

    const result = await runSynapseLangGraphTurn(input);
    await updateAgentRun(auth.supabase, auth.user.id, agentRun.id, {
      conversationId: result.conversation?.id || conversationId || null,
      status: 'completed',
      output: {
        type: result.type,
        conversationId: result.conversation?.id || null,
        messageId: result.assistant?.id || null,
        toolCallCount: result.toolCalls?.length || 0,
        sourceCount: result.sources?.length || 0,
      },
      finishedAt: new Date().toISOString(),
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Synapse chat error:', error);
    if (agentRun) {
      await updateAgentRun(auth.supabase, auth.user.id, agentRun.id, {
        status: 'failed',
        error: schemaHint(error),
        finishedAt: new Date().toISOString(),
      }).catch(updateError => console.warn('Synapse run failure update failed:', updateError));
    }
    return NextResponse.json({ error: schemaHint(error) }, { status: 500 });
  }
}
