import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserLLMConfig } from '@/lib/user-settings';
import { evidenceRowsToTyped } from '@/lib/research-workflow';
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
    const insightTypes = Array.from(new Set(relatedEdges.map(edge => edge.metadata?.insightType).filter(Boolean)));
    const sourceTypes = Array.from(new Set(relatedEdges.map(edge => edge.metadata?.sourceType).filter(Boolean)));
    return `${gap.label}: ${gap.status}, sources=${relatedEdges.length}, insightTypes=${insightTypes.join('/') || 'none'}, sourceTypes=${sourceTypes.join('/') || 'none'}`;
  }).join('\n');
}

function groupEvidence(evidence: any[]) {
  const groups: Record<string, any[]> = {
    representative_paper: [],
    trend: [],
    method: [],
    application: [],
    metric: [],
    limitation: [],
    web_insight: [],
    open_question: [],
  };
  for (const item of evidence) {
    const type = item.metadata?.insightType || (item.metadata?.type === 'paper' ? 'representative_paper' : 'web_insight');
    if (!groups[type]) groups[type] = [];
    groups[type].push(item);
  }
  return groups;
}

function sourceLine(item: any, index: number) {
  const meta = item.metadata || {};
  const sourceType = meta.type === 'paper' ? '论文' : meta.provider === 'github' ? 'GitHub' : 'Web';
  const year = meta.year ? `, ${meta.year}` : '';
  const citation = meta.citationCount ? `, cited ${meta.citationCount}` : '';
  return `[${index}] ${item.claim}
Source: ${meta.title || item.source_id} (${sourceType}${year}${citation})
Provider: ${meta.provider || ''}
URL: ${meta.url || ''}
InsightType: ${meta.insightType || ''}
TrendCluster: ${meta.trendCluster || ''}
Tags: ${[...(meta.methodTags || []), ...(meta.applicationTags || []), ...(meta.metricTags || [])].join(', ')}
Snippet: ${item.snippet}`;
}

function fallbackDraft(scope: ResearchScope, graph: ResearchGraphTemplate, evidence: any[]) {
  const groups = groupEvidence(evidence);
  const topPapers = groups.representative_paper.slice(0, 5);
  const webItems = groups.web_insight.slice(0, 5);
  const methods = [...groups.method, ...groups.trend].slice(0, 6);
  const limits = [...groups.limitation, ...groups.open_question].slice(0, 5);

  return `# ${scope.topic}：领域认知简报

> 这是一份基于摘要级论文元数据和 Web 摘录生成的初步领域地图，不等同于完整综述。当前通过筛选的来源共 ${evidence.length} 个。

## 领域概览
当前资料围绕「${scope.topic}」建立了初步认知框架，重点方向包括：${scope.focus.join('、') || '领域概览、主流方法、近期趋势和限制'}。

## 主流方向与近期趋势
${methods.map((item, index) => `- ${item.claim} [${index + 1}]`).join('\n') || '- 目前通过筛选的趋势/方法来源不足，需要继续检索。'}

## 代表论文入口
${topPapers.map((item, index) => {
  const meta = item.metadata || {};
  return `- ${meta.title || item.source_id}${meta.year ? ` (${meta.year})` : ''}${meta.citationCount ? `，引用 ${meta.citationCount}` : ''} [${index + 1}]`;
}).join('\n') || '- 暂无足够代表论文入口。'}

## Web/产业/实践信号
${webItems.map((item, index) => `- ${item.claim} [${topPapers.length + index + 1}]`).join('\n') || '- 暂无足够 Web 实践信号。'}

## 常见指标、限制与开放问题
${limits.map((item, index) => `- ${item.claim} [${topPapers.length + webItems.length + index + 1}]`).join('\n') || '- 限制和开放问题仍需补充。'}

## 推荐下一步
${graph.gaps.filter(gap => gap.status !== 'filled').map(gap => `- 继续补充：${gap.label}。建议 query：${gap.suggestedQueries[0] || scope.topic}`).join('\n') || '- 当前认知框架已达到初步覆盖，可以选择代表论文进入阅读器做全文深读。'}

## 来源索引
${evidence.slice(0, 16).map((item, index) => sourceLine(item, index + 1)).join('\n\n') || '暂无通过筛选的来源。'}
`;
}

async function generateDraftWithLLM(llmConfig: any, scope: ResearchScope, graph: ResearchGraphTemplate, evidence: any[]) {
  if (!llmConfig?.apiKey || !llmConfig?.endpoint) return fallbackDraft(scope, graph, evidence);

  const evidenceContext = evidence.slice(0, 32).map((item, index) => sourceLine(item, index + 1)).join('\n\n');

  const prompt = `你是严谨的中文科研助手。请只基于已通过 landscape gate 的来源，写一份短的“领域认知简报”。

要求：
- 直接用 Markdown 输出。
- 标题必须是用户原始主题，不要写寒暄。
- 这是领域态势简报，不是完整综述，不要假装已经阅读全文。
- 论文来源只代表 title/abstract/metadata 层面的摘要级判断。
- Web 来源用于补充产业、实践、标准、项目、技术博客或趋势信号。
- 不要把 Synap 或任何内部工具名当成用户研究目标。
- 如果证据不足，要明确写“初步判断”，并给出下一轮具体检索建议。
- 每个重要判断尽量使用 [1]、[2] 这样的来源编号。
- 全文控制在 800-1500 字。

用户原始主题：${scope.topic}
用户选择方向：${scope.focus.join('、') || '未指定'}
来源数量：${evidence.length}
覆盖情况：
${evidenceCoverage(graph)}

建议章节：
## 领域概览
## 主流方向与近期趋势
## 代表论文入口
## Web/产业/实践信号
## 常见指标、限制与开放问题
## 推荐下一步

已通过筛选的来源：
${evidenceContext || '无'}`;

  try {
    const res = await fetch(llmConfig.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmConfig.apiKey}` },
      body: JSON.stringify({
        model: llmConfig.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 3600,
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
    return NextResponse.json({ error: 'Research landscape graph is not ready yet' }, { status: 400 });
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
