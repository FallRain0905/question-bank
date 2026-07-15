import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserLLMConfig, getUserResearchToolConfig } from '@/lib/user-settings';
import { runConfirmedDocumentLangGraphTurn, runSynapseLangGraphTurn } from '@/lib/synapse-runtime';
import type { AgentPlan } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
  if (message.includes('agent_conversations') || message.includes('agent_messages') || message.includes('agent_tool_traces') || message.includes('agent_files')) {
    return `${message} 请先执行 supabase/migration_synapse_agent.sql。`;
  }
  if (message.includes('agent_documents') || message.includes('schema cache')) {
    return `${message} 请先执行 supabase/migration_agent_documents.sql。`;
  }
  return message || 'Agent request failed';
}

function sseResponse(run: (send: (event: string, data: Record<string, any>) => Promise<void>) => Promise<any>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      async function send(event: string, data: Record<string, any>) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      try {
        await send('status', { message: 'Synapse 正在启动 LangGraph...' });
        const result = await run(send);
        await send('result', result);
        await send('done', { ok: true });
      } catch (error: any) {
        console.error('Synapse stream error:', error);
        await send('error', { error: schemaHint(error) });
      } finally {
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

    if (body.confirmedPlan) {
      if (!conversationId) return NextResponse.json({ error: 'Missing conversationId for confirmed action' }, { status: 400 });
      const input = {
        userId: auth.user.id,
        message,
        conversationId,
        confirmedPlan: body.confirmedPlan as AgentPlan,
        supabase: auth.supabase,
        llmConfig,
        toolConfig,
        agentSettings,
      };
      if (shouldStream) {
        return sseResponse(send => runConfirmedDocumentLangGraphTurn({
          ...input,
          onEvent: event => send(event.type, event as any),
        }));
      }
      const result = await runConfirmedDocumentLangGraphTurn(input);
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
    };
    if (shouldStream) {
      return sseResponse(send => runSynapseLangGraphTurn({
        ...input,
        onEvent: event => send(event.type, event as any),
      }));
    }

    const result = await runSynapseLangGraphTurn(input);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Synapse chat error:', error);
    return NextResponse.json({ error: schemaHint(error) }, { status: 500 });
  }
}
