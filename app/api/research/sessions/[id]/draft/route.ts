import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserLLMConfig } from '@/lib/user-settings';
import { evidenceRowsToTyped, outputTypeLabel } from '@/lib/research-workflow';
import { researchDbErrorResponse } from '@/lib/research-api-errors';
import { sanitizeForJsonb } from '@/lib/json-sanitize';
import type { ResearchGraphTemplate, ResearchScope } from '@/types';

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

function fallbackDraft(scope: ResearchScope, graph: ResearchGraphTemplate, evidence: any[]) {
  const topEvidence = evidence.slice(0, 8);
  return `# ${scope.topic}

## 带引用回答
本次研究围绕 ${scope.focus.join('、')} 展开，已收集 ${evidence.length} 条证据，当前图谱包含 ${graph.nodes.length} 个节点和 ${graph.edges.length} 条超边。

## Evidence Board
${topEvidence.map((item, index) => `- [${index + 1}] ${item.claim}\n  来源：${item.metadata?.title || item.source_id}`).join('\n')}

## 技术报告草稿
### 1. 研究范围
输出形式：${outputTypeLabel(scope.outputType)}。信息源：${scope.sources.join(', ')}。

### 2. 当前图谱缺口
${graph.gaps.filter(gap => gap.status !== 'filled').map(gap => `- ${gap.label}: ${gap.reason}`).join('\n') || '- 当前主要缺口已初步填补。'}

### 3. 下一步建议
继续围绕未填补缺口运行检索轮次，并优先补充可引用论文、开源实现和评估指标。`;
}

async function generateDraftWithLLM(llmConfig: any, scope: ResearchScope, graph: ResearchGraphTemplate, evidence: any[]) {
  if (!llmConfig?.apiKey || !llmConfig?.endpoint) return fallbackDraft(scope, graph, evidence);

  const evidenceContext = evidence.slice(0, 16).map((item, index) => {
    const meta = item.metadata || {};
    return `[${index + 1}] ${item.claim}
Source: ${meta.title || item.source_id}
URL: ${meta.url || ''}
Snippet: ${item.snippet}`;
  }).join('\n\n');

  const prompt = `You are writing a research draft for Synap's interactive deep research workspace.

Respond in Chinese. Use Markdown. Include three sections:
1. 带引用回答
2. Evidence Board
3. 技术报告草稿

Topic: ${scope.topic}
Focus: ${scope.focus.join(', ')}
Output type: ${outputTypeLabel(scope.outputType)}
Graph nodes: ${graph.nodes.map(node => `${node.type}:${node.label}`).slice(0, 40).join(' | ')}
Graph gaps: ${graph.gaps.map(gap => `${gap.label}(${gap.status})`).join(' | ')}

Evidence:
${evidenceContext}`;

  try {
    const res = await fetch(llmConfig.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmConfig.apiKey}` },
      body: JSON.stringify({
        model: llmConfig.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.25,
        max_tokens: 2400,
      }),
    });
    if (!res.ok) return fallbackDraft(scope, graph, evidence);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || fallbackDraft(scope, graph, evidence);
  } catch {
    return fallbackDraft(scope, graph, evidence);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const { id } = await params;

  const { data: session, error: sessionError } = await auth.supabase
    .from('research_sessions')
    .select('*')
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (sessionError) return researchDbErrorResponse(sessionError);
  if (!session) return NextResponse.json({ error: 'Research session not found' }, { status: 404 });
  if (!session.scope || !session.graph_template) {
    return NextResponse.json({ error: 'Research graph is not ready yet' }, { status: 400 });
  }

  const { data: evidenceRows, error: evidenceError } = await auth.supabase
    .from('research_evidence')
    .select('*')
    .eq('session_id', id)
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false });

  if (evidenceError) return researchDbErrorResponse(evidenceError);

  const evidence = evidenceRowsToTyped(evidenceRows || []);
  const llmConfig = await getUserLLMConfig(auth.token);
  const draft = await generateDraftWithLLM(
    llmConfig,
    session.scope as ResearchScope,
    session.graph_template as ResearchGraphTemplate,
    evidence
  );

  const graph = sanitizeForJsonb({
    ...(session.graph_template as ResearchGraphTemplate),
    reportDraft: draft,
    updatedAt: new Date().toISOString(),
  });

  const { data: updated, error: updateError } = await auth.supabase
    .from('research_sessions')
    .update({
      graph_template: graph,
      status: 'DRAFT_READY',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .select()
    .single();

  if (updateError) return researchDbErrorResponse(updateError);
  return NextResponse.json({ session: updated, evidence, draft });
}
