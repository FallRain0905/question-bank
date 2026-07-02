import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserLLMConfig, getUserResearchToolConfig } from '@/lib/user-settings';
import { generateAgentDocument, planAgentTask } from '@/lib/agent-runtime';
import { normalizeResearchOptions, planResearchQueries, retrieveResearchSources } from '@/lib/research-retrieval';
import type { AgentPlan, AgentPlanStep, AgentToolCallLog, ResearchSource } from '@/types';

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

function logForStep(step: AgentPlanStep): AgentToolCallLog {
  return {
    id: step.id,
    tool: step.tool,
    title: step.title,
    status: 'running',
    args: step.args || {},
  };
}

async function executeSearchStep(
  step: AgentPlanStep,
  auth: NonNullable<Awaited<ReturnType<typeof getAuthedClient>> extends infer T ? T extends { error: any } ? never : T : never>,
  llmConfig: any,
  toolConfig: any
) {
  const query = String(step.args?.query || step.args?.topic || '').trim();
  if (!query) return { sources: [] as ResearchSource[], plannedQueries: [] as any[] };
  const selected = normalizeResearchOptions(step.args?.mode, step.args?.depth);
  const retrievalOptions = {
    query,
    mode: selected.mode,
    depth: selected.depth,
    llmConfig,
    toolConfig,
    supabase: auth.supabase,
    includeGithub: step.args?.includeGithub === true,
  };
  const plannedQueries = await planResearchQueries(retrievalOptions);
  const sources = await retrieveResearchSources({ ...retrievalOptions, plan: plannedQueries });
  return { sources, plannedQueries };
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({}));
  const message = String(body.message || '').trim();
  if (!message) return NextResponse.json({ error: 'Missing message' }, { status: 400 });

  const [llmConfig, toolConfig] = await Promise.all([
    getUserLLMConfig(auth.token),
    getUserResearchToolConfig(auth.token),
  ]);

  if (!body.confirmedPlan) {
    const plan = await planAgentTask(message, auth.user.id, llmConfig);
    return NextResponse.json({
      type: 'plan',
      message: '我先拟定了一个执行计划。确认后我再调用工具。',
      plan,
    });
  }

  const plan = body.confirmedPlan as AgentPlan;
  const toolCalls: AgentToolCallLog[] = [];
  const allSources: ResearchSource[] = [];
  let document: any = null;
  const plannedQueries: any[] = [];

  for (const step of plan.steps || []) {
    const call = logForStep(step);
    toolCalls.push(call);
    try {
      if (step.tool === 'researchSearch') {
        const result = await executeSearchStep(step, auth, llmConfig, toolConfig);
        allSources.push(...result.sources);
        plannedQueries.push(...result.plannedQueries);
        call.status = 'completed';
        call.result = `检索到 ${result.sources.length} 个来源。`;
      }

      if (step.tool === 'createDocument') {
        const draft = await generateAgentDocument({
          userId: auth.user.id,
          message,
          plan,
          sources: allSources,
          llmConfig,
        });
        const { data, error } = await auth.supabase
          .from('agent_documents')
          .insert({
            user_id: auth.user.id,
            title: draft.title,
            content_md: draft.markdown,
            source: 'agent',
            metadata: {
              runtime: draft.runtime,
              plan,
              sourceCount: allSources.length,
              plannedQueries,
            },
          })
          .select()
          .single();
        if (error) throw error;
        document = data;
        call.status = 'completed';
        call.result = `已创建文档：${data.title}`;
      }
    } catch (err: any) {
      call.status = 'failed';
      call.error = err.message || 'Tool execution failed';
    }
  }

  return NextResponse.json({
    type: 'result',
    message: document
      ? `已完成。创建了文档《${document.title}》，并保留了 ${allSources.length} 个检索来源。`
      : `已完成。共检索到 ${allSources.length} 个来源。`,
    plan,
    toolCalls,
    sources: allSources,
    plannedQueries,
    document,
  });
}
