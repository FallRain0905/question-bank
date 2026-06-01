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
本次研究围绕「${scope.topic}」展开，重点关注 ${scope.focus.join('、') || '用户指定方向'}。当前已收集 ${evidence.length} 条证据，研究图中包含 ${graph.nodes.length} 个节点和 ${graph.edges.length} 条关系。

## Evidence Board
${topEvidence.map((item, index) => `- [${index + 1}] ${item.claim}\n  来源：${item.metadata?.title || item.source_id}`).join('\n') || '- 暂无可用证据。'}

## 技术报告草稿
### 1. 研究范围
输出形式：${outputTypeLabel(scope.outputType)}。信息源：${scope.sources.join(', ')}。

### 2. 当前研究缺口
${graph.gaps.filter(gap => gap.status !== 'filled').map(gap => `- ${gap.label}: ${gap.reason}`).join('\n') || '- 当前主要缺口已初步填补。'}

### 3. 下一步建议
继续围绕未填补缺口运行检索轮次，并优先补充可引用论文、工程实现和评估指标。`;
}

async function generateDraftWithLLM(llmConfig: any, scope: ResearchScope, graph: ResearchGraphTemplate, evidence: any[]) {
  if (!llmConfig?.apiKey || !llmConfig?.endpoint) return fallbackDraft(scope, graph, evidence);

  const evidenceContext = evidence.slice(0, 24).map((item, index) => {
    const meta = item.metadata || {};
    return `[${index + 1}] ${item.claim}
Source: ${meta.title || item.source_id}
Provider: ${meta.provider || ''}
URL: ${meta.url || ''}
Snippet: ${item.snippet}`;
  }).join('\n\n');

  const prompt = `You are a rigorous Chinese research assistant writing a research draft from an evidence board.

Rules:
- Respond in Chinese.
- Start directly with a Markdown title using the user's original topic.
- Do not write greetings such as "好的" or "根据您的要求".
- Do not describe Synap, Research Graph, Graph Schema, or Evidence Board as the user's research objective.
- Do not rewrite the topic as "constructing a knowledge graph" unless the user's topic explicitly asks for knowledge graphs.
- If evidence is insufficient, say so. Do not invent claims.

User original topic: ${scope.topic}
Selected focus: ${scope.focus.join('、') || '未指定'}
Expected output type: ${outputTypeLabel(scope.outputType)}
Open research gaps: ${graph.gaps.map(gap => `${gap.label}(${gap.status}): ${gap.reason}`).join('；')}

Required sections:
## 带引用回答
Answer the original topic directly. Use citations like [1], [2].

## Evidence Board
Organize as claim - evidence - source number.

## 技术报告草稿
Include background, key technical routes, evidence synthesis, limitations, and next retrieval suggestions.

Evidence:
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
