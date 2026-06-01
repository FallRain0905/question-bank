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

function evidenceCoverage(graph: ResearchGraphTemplate) {
  return graph.gaps.map(gap => {
    const relatedEdges = graph.edges.filter(edge => {
      const gapIds = Array.isArray(edge.metadata?.gapIds) ? edge.metadata.gapIds : [];
      return gapIds.includes(gap.id);
    });
    return `${gap.label}: ${gap.status}, accepted evidence=${relatedEdges.length}`;
  }).join('\n');
}

function fallbackDraft(scope: ResearchScope, graph: ResearchGraphTemplate, evidence: any[]) {
  const topEvidence = evidence.slice(0, 10);
  return `# ${scope.topic}

## 带引用回答
本次研究围绕「${scope.topic}」展开，重点关注 ${scope.focus.join('、') || '用户指定方向'}。当前通过 evidence gate 的证据共有 ${evidence.length} 条，研究图中包含 ${graph.nodes.length} 个节点和 ${graph.edges.length} 条关系。

${evidence.length < 3 ? '当前证据不足以形成完整报告，以下内容只能作为初步草稿。' : '以下结论仅基于已通过相关性筛选的证据。'}

## Evidence Board
${topEvidence.map((item, index) => `- [${index + 1}] ${item.claim}\n  来源：${item.metadata?.title || item.source_id}\n  相关性：${item.metadata?.relevanceScore || item.confidence}`).join('\n') || '- 暂无通过筛选的证据。'}

## 证据覆盖说明
${evidenceCoverage(graph)}

## 技术报告草稿
### 1. 研究范围
输出形式：${outputTypeLabel(scope.outputType)}。信息源：${scope.sources.join(', ')}。

### 2. 当前研究缺口
${graph.gaps.filter(gap => gap.status !== 'filled').map(gap => `- ${gap.label}: ${gap.reason}`).join('\n') || '- 当前主要缺口已初步填充。'}

### 3. 下一步建议
继续围绕未填充缺口运行检索轮次，并优先补充代表性综述、可引用论文、评价指标和数据库/benchmark。`;
}

async function generateDraftWithLLM(llmConfig: any, scope: ResearchScope, graph: ResearchGraphTemplate, evidence: any[]) {
  if (!llmConfig?.apiKey || !llmConfig?.endpoint) return fallbackDraft(scope, graph, evidence);

  const evidenceContext = evidence.slice(0, 28).map((item, index) => {
    const meta = item.metadata || {};
    return `[${index + 1}] ${item.claim}
Source: ${meta.title || item.source_id}
Provider: ${meta.provider || ''}
URL: ${meta.url || ''}
Relevance: ${meta.relevanceScore || item.confidence}
Gap IDs: ${(meta.gapIds || []).join(', ')}
Gate reason: ${meta.gateReason || ''}
Snippet: ${item.snippet}`;
  }).join('\n\n');

  const prompt = `You are a rigorous Chinese research assistant writing a research draft from accepted evidence only.

Rules:
- Respond in Chinese.
- Start directly with a Markdown title using the user's original topic.
- Do not write greetings.
- Do not describe Synap, Research Graph, Graph Schema, or Evidence Board as the user's research objective.
- Do not rewrite the topic as "constructing a knowledge graph" unless the user's topic explicitly asks for knowledge graphs.
- Use only accepted evidence below. Do not mention rejected or unavailable sources as facts.
- If accepted evidence is insufficient, explicitly say the report is preliminary and list concrete next searches.
- Use citations like [1], [2] and keep claims tied to source numbers.

User original topic: ${scope.topic}
Selected focus: ${scope.focus.join('、') || '未指定'}
Expected output type: ${outputTypeLabel(scope.outputType)}
Evidence count: ${evidence.length}
Evidence coverage:
${evidenceCoverage(graph)}

Required sections:
## 带引用回答
Answer the original topic directly. If evidence is thin, say so early.

## Evidence Board
Organize as claim - evidence - source number - relevance.

## 证据覆盖说明
Summarize which gaps are filled, partial, or still open.

## 技术报告草稿
Include background, key technical routes, evidence synthesis, limitations, and next retrieval suggestions.

Accepted evidence:
${evidenceContext}`;

  try {
    const res = await fetch(llmConfig.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmConfig.apiKey}` },
      body: JSON.stringify({
        model: llmConfig.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 6000,
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
