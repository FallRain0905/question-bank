import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserLLMConfig, getUserResearchToolConfig } from '@/lib/user-settings';
import { generateAgentDocument } from '@/lib/agent-runtime';
import { loadRecentResearchSources, runSynapseTurn } from '@/lib/synapse-runtime';
import type { AgentPlan, AgentToolCallLog } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

async function executeConfirmedDocument(
  supabase: ReturnType<typeof clientForToken>,
  userId: string,
  conversationId: string,
  message: string,
  plan: AgentPlan,
  llmConfig: any
) {
  const sources = await loadRecentResearchSources(supabase, userId, conversationId);
  const draft = await generateAgentDocument({
    userId,
    message,
    plan,
    sources,
    llmConfig,
  });

  const { data: document, error } = await supabase
    .from('agent_documents')
    .insert({
      user_id: userId,
      title: draft.title,
      content_md: draft.markdown,
      source: 'synapse',
      metadata: {
        runtime: draft.runtime,
        agent: 'synapse',
        conversationId,
        plan,
        sourceCount: sources.length,
        warnings: draft.warnings || [],
      },
    })
    .select()
    .single();
  if (error) throw error;

  const call: AgentToolCallLog = {
    id: plan.steps[0]?.id || `tool-${Date.now()}`,
    tool: 'createDocument',
    title: plan.steps[0]?.title || '创建文档',
    status: 'completed',
    args: plan.steps[0]?.args || {},
    result: [
      `已创建文档：${document.title}`,
      draft.warnings?.length ? `注意：${draft.warnings.join('；')}` : '',
    ].filter(Boolean).join('\n'),
  };

  const answer = `已创建文档《${document.title}》。你可以在右侧“文档”面板预览或下载 Markdown / DOCX。`;

  await Promise.all([
    supabase.from('agent_tool_traces').insert({
      user_id: userId,
      conversation_id: conversationId,
      tool_name: 'createDocument',
      status: 'completed',
      input: { message, plan },
      output: { document, sourceCount: sources.length },
      summary: call.result,
    }),
    supabase.from('agent_messages').insert({
      user_id: userId,
      conversation_id: conversationId,
      role: 'assistant',
      content: answer,
      metadata: { agent: 'synapse', toolCalls: [call], document },
    }),
    supabase
      .from('agent_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('user_id', userId),
  ]);

  return { document, call, answer, sources };
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;

  try {
    const body = await req.json().catch(() => ({}));
    const message = String(body.message || '').trim();
    const conversationId = String(body.conversationId || '').trim() || undefined;
    if (!message) return NextResponse.json({ error: 'Missing message' }, { status: 400 });

    const [llmConfig, toolConfig] = await Promise.all([
      getUserLLMConfig(auth.token),
      getUserResearchToolConfig(auth.token),
    ]);

    if (body.confirmedPlan) {
      if (!conversationId) return NextResponse.json({ error: 'Missing conversationId for confirmed action' }, { status: 400 });
      const result = await executeConfirmedDocument(
        auth.supabase,
        auth.user.id,
        conversationId,
        message,
        body.confirmedPlan as AgentPlan,
        llmConfig
      );
      return NextResponse.json({
        type: 'result',
        conversation: { id: conversationId },
        message: result.answer,
        plan: body.confirmedPlan,
        toolCalls: [result.call],
        sources: result.sources,
        document: result.document,
      });
    }

    const result = await runSynapseTurn({
      userId: auth.user.id,
      message,
      conversationId,
      supabase: auth.supabase,
      llmConfig,
      toolConfig,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Synapse chat error:', error);
    return NextResponse.json({ error: schemaHint(error) }, { status: 500 });
  }
}
