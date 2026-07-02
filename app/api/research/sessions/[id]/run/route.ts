import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserEmbeddingConfig, getUserLLMConfig, getUserResearchToolConfig } from '@/lib/user-settings';
import { planResearchQueries, retrieveResearchSources } from '@/lib/research-retrieval';
import type { ResearchRetrievalDebugEvent } from '@/lib/research-retrieval';
import { runEvidenceGate } from '@/lib/research-evidence-gate';
import { researchDbErrorResponse } from '@/lib/research-api-errors';
import { sanitizeForJsonb } from '@/lib/json-sanitize';
import {
  applySourcesToGraph,
  buildGraphTemplate,
  buildResearchRound,
  buildSearchQueryFromGraph,
  evidenceRowsToTyped,
  getOpenGaps,
  researchDepthToRetrievalDepth,
  sourcePrefsToMode,
} from '@/lib/research-workflow';
import type {
  AcceptedResearchEvidence,
  PlannedResearchQuery,
  ResearchEvidence,
  ResearchGraphTemplate,
  ResearchInternalDiagnosis,
  ResearchPlanningContext,
  ResearchScope,
  ResearchSource,
  ResearchSourcePreference,
} from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORBIDDEN_QUERY_TERMS = [
  '代表论文不足',
  '主流方法分类不足',
  '近期趋势不足',
  'Web 实践信号不足',
  '指标与限制不足',
  '领域概览不足',
  '证据不足',
  '当前缺口',
  '待规划',
];

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

function sseEvent(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function countSources(sources: ResearchSource[]) {
  return sources.reduce<Record<string, number>>((acc, source) => {
    const key = source.sourceProvider || source.type || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function logResearchRun(sessionId: string, label: string, payload: Record<string, any>) {
  console.info(`[research:${sessionId}] ${label}`, JSON.stringify(payload));
}

function preferredSourcesFromScope(scope: ResearchScope) {
  const providers = new Set<string>();
  if (scope.sources.includes('papers')) {
    providers.add('semantic_scholar');
    providers.add('openalex');
    providers.add('arxiv');
    providers.add('local_papers');
  }
  if (scope.sources.includes('web')) {
    providers.add('tavily');
    providers.add('crawled_web');
  }
  if (scope.sources.includes('github')) providers.add('github');
  if (scope.sources.includes('local_kb')) providers.add('local_kb');
  return Array.from(providers);
}

function cleanSearchQuery(raw: string, scope: ResearchScope) {
  let query = String(raw || '').trim();
  for (const phrase of FORBIDDEN_QUERY_TERMS) query = query.replaceAll(phrase, ' ');
  query = query.replace(/\s+/g, ' ').trim();
  if (!query) return '';

  const topic = scope.topic.trim();
  if (topic && !query.toLowerCase().includes(topic.toLowerCase())) {
    query = `${topic} ${query}`;
  }
  return query.replace(/\s+/g, ' ').trim();
}

function normalizeRetrievalPlan(plan: PlannedResearchQuery[], scope: ResearchScope, target?: number) {
  const preferredFallback = preferredSourcesFromScope(scope);
  const seen = new Set<string>();
  const normalized = plan
    .map(item => {
      const queries = (item.queries || [])
        .map(query => cleanSearchQuery(query, scope))
        .filter(Boolean)
        .filter(query => {
          const key = query.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 2);

      return {
        perspective: String(item.perspective || 'Landscape search').trim(),
        reason: String(item.reason || 'Fill the current field landscape coverage gap.').trim(),
        queries,
        preferredSources: Array.isArray(item.preferredSources) && item.preferredSources.length
          ? item.preferredSources.map(source => String(source || '').trim()).filter(Boolean)
          : preferredFallback,
      };
    })
    .filter(item => item.queries.length > 0);

  return normalized.slice(0, target || normalized.length);
}

function buildPlanningContext(scope: ResearchScope, graph: ResearchGraphTemplate): ResearchPlanningContext {
  return {
    topic: scope.topic,
    focus: scope.focus || [],
    openGaps: getOpenGaps(graph, scope.depth === 'deep' ? 6 : scope.depth === 'fast' ? 2 : 4),
    priorQueries: (graph.rounds || []).slice(-4).map(round => round.query).filter(Boolean),
    forbiddenTerms: FORBIDDEN_QUERY_TERMS,
  };
}

function summarizeGateItems(
  items: Array<Partial<AcceptedResearchEvidence> & { sourceId: string; reason: string; relevanceScore?: number }>,
  sources: ResearchSource[],
  limit: number
) {
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  return items.slice(0, limit).map(item => {
    const source = sourceMap.get(item.sourceId);
    return {
      sourceId: item.sourceId,
      title: source?.title || item.sourceId,
      provider: source?.sourceProvider || source?.type || 'source',
      sourceKind: source?.sourceKind || '',
      sourceType: source?.type || '',
      insightType: item.insightType || '',
      trendCluster: item.trendCluster || '',
      url: source?.url || '',
      snippet: (source?.fullTextExcerpt || source?.abstract || source?.snippet || '').slice(0, 360),
      reason: item.reason,
      relevanceScore: item.relevanceScore,
    };
  });
}

function parseJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

const DIAGNOSIS_SOURCE_OPTIONS: ResearchSourcePreference[] = ['papers', 'web', 'github', 'local_kb'];

function normalizePreferredSources(raw: unknown, fallback: ResearchSourcePreference[]) {
  const items = Array.isArray(raw) ? raw : [];
  const normalized = items
    .map(item => String(item || '').trim())
    .filter((item): item is ResearchSourcePreference => DIAGNOSIS_SOURCE_OPTIONS.includes(item as ResearchSourcePreference));
  return normalized.length ? normalized : fallback;
}

function evidenceLine(item: ResearchEvidence, index: number) {
  const meta = item.metadata || {};
  return `[${index}] ${item.claim}
Source: ${meta.title || item.source_id}
Type: ${meta.type || ''} / ${meta.provider || ''} / ${meta.insightType || ''}
Cluster/Tags: ${[meta.trendCluster, ...(meta.methodTags || []), ...(meta.applicationTags || []), ...(meta.metricTags || [])].filter(Boolean).join(', ')}
Snippet: ${item.snippet}`.slice(0, 1200);
}

function fallbackDiagnosis(scope: ResearchScope, graph: ResearchGraphTemplate): ResearchInternalDiagnosis {
  const openGaps = getOpenGaps(graph, scope.depth === 'deep' ? 6 : scope.depth === 'fast' ? 2 : 4);
  const recommendedDirections = (openGaps.length ? openGaps : graph.gaps).slice(0, 4).map(gap => ({
    perspective: gap.label.replace(/不足$/, '补强'),
    reason: gap.reason,
    queries: (gap.suggestedQueries.length ? gap.suggestedQueries : [`${scope.topic} review recent advances`])
      .map(query => cleanSearchQuery(query, scope))
      .filter(Boolean)
      .slice(0, 2),
    preferredSources: gap.preferredSources.length ? gap.preferredSources : scope.sources,
  })).filter(item => item.queries.length > 0);

  if (recommendedDirections.length === 0) {
    recommendedDirections.push({
      perspective: '领域框架补强',
      reason: '当前图谱缺少足够的方向性证据，需要补充综述、近期趋势和 Web 实践信号。',
      queries: [
        cleanSearchQuery('review survey overview recent advances', scope),
        cleanSearchQuery('industry report applications limitations', scope),
      ].filter(Boolean),
      preferredSources: scope.sources.length ? scope.sources : ['papers', 'web'],
    });
  }

  return {
    summary: '内部诊断使用规则兜底生成。建议先围绕开放缺口补充综述、趋势和实践来源。',
    internalDraft: '',
    insufficiencies: openGaps.slice(0, 5).map(gap => ({
      label: gap.label,
      reason: gap.reason,
      severity: gap.priority === 'high' ? 'high' : gap.priority === 'medium' ? 'medium' : 'low',
    })),
    recommendedDirections,
    createdAt: new Date().toISOString(),
    usedLLM: false,
  };
}

async function generateInternalDiagnosis(
  llmConfig: any,
  scope: ResearchScope,
  graph: ResearchGraphTemplate,
  evidence: ResearchEvidence[],
  sources: ResearchSource[]
): Promise<ResearchInternalDiagnosis> {
  const fallback = fallbackDiagnosis(scope, graph);
  if (!llmConfig?.apiKey || !llmConfig?.endpoint || !llmConfig?.defaultModel) return fallback;

  const openGapText = getOpenGaps(graph, 8)
    .map((gap, index) => `${index + 1}. ${gap.label} (${gap.status}) - ${gap.reason}`)
    .join('\n') || '无明显开放缺口';
  const evidenceText = evidence.slice(0, 28).map((item, index) => evidenceLine(item, index + 1)).join('\n\n') || '暂无通过 gate 的证据';
  const sourceText = sources.slice(0, 16).map((source, index) => {
    const text = source.fullTextExcerpt || source.abstract || source.snippet || '';
    return `[${index + 1}] ${source.title}
Provider: ${source.sourceProvider || source.type}
Query: ${source.query || ''}
Text: ${text.slice(0, 500)}`;
  }).join('\n\n');

  const prompt = `你是 Synap 的内部研究诊断器。你不会输出最终报告，而是先根据当前证据写一个很短的内部工作草稿，再判断下一轮应该检索什么。

只返回 JSON，不要 Markdown：
{
  "summary": "一句话说明当前研究状态",
  "internalDraft": "200-400 字内部工作草稿，指出目前已经能初步判断什么、哪里不够",
  "insufficiencies": [{"label":"不足点","reason":"为什么不足","severity":"high|medium|low"}],
  "recommendedDirections": [
    {"perspective":"下一轮方向","reason":"为什么要查这个","queries":["具体 query 1","具体 query 2"],"preferredSources":["papers","web"]}
  ]
}

规则：
- queries 必须围绕用户原始主题，不要把 gap label 直接塞进 query。
- 每个 query 要具体，优先找综述、代表性资料、近期趋势、方法分类、指标/限制、Web 实践信号。
- 如果论文证据不足，优先生成 review/survey/overview 类 query。
- 如果 Web 实践信号不足，优先生成 industry report / official documentation / standard / application 类 query。
- recommendedDirections 最多 4 个，每个最多 2 个 query。
- preferredSources 只能使用 papers、web、github、local_kb。
- 不要把 Synap、研究图谱、内部 gate、系统架构当成用户主题。

用户原始主题：${scope.topic}
用户重点方向：${scope.focus.join('、') || '未指定'}
当前开放缺口：
${openGapText}

已通过 gate 的证据：
${evidenceText}

本轮候选来源摘要：
${sourceText || '无'}`;

  try {
    const res = await fetch(llmConfig.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmConfig.apiKey}` },
      body: JSON.stringify({
        model: llmConfig.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.15,
        max_tokens: 1800,
      }),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const parsed = parseJsonObject(data.choices?.[0]?.message?.content || '');
    if (!parsed) return fallback;

    const recommendedDirections = (Array.isArray(parsed.recommendedDirections) ? parsed.recommendedDirections : [])
      .map((item: any) => ({
        perspective: String(item.perspective || '下一轮检索').trim().slice(0, 80),
        reason: String(item.reason || '补充当前领域认知框架。').trim().slice(0, 240),
        queries: (Array.isArray(item.queries) ? item.queries : [])
          .map((query: any) => cleanSearchQuery(String(query || ''), scope))
          .filter(Boolean)
          .slice(0, 2),
        preferredSources: normalizePreferredSources(item.preferredSources, scope.sources),
      }))
      .filter((item: any) => item.queries.length > 0)
      .slice(0, 4);

    if (recommendedDirections.length === 0) return fallback;

    return {
      summary: String(parsed.summary || '内部诊断已完成。').trim().slice(0, 260),
      internalDraft: String(parsed.internalDraft || '').trim().slice(0, 1800),
      insufficiencies: (Array.isArray(parsed.insufficiencies) ? parsed.insufficiencies : [])
        .map((item: any) => ({
          label: String(item.label || '待补充').trim().slice(0, 80),
          reason: String(item.reason || '需要更多证据。').trim().slice(0, 240),
          severity: item.severity === 'low' || item.severity === 'medium' || item.severity === 'high' ? item.severity : 'medium',
        }))
        .slice(0, 6),
      recommendedDirections,
      createdAt: new Date().toISOString(),
      usedLLM: true,
    };
  } catch {
    return fallback;
  }
}

function applyDiagnosisToGraph(graph: ResearchGraphTemplate, diagnosis: ResearchInternalDiagnosis) {
  const nextTasks = diagnosis.recommendedDirections.flatMap(item => item.queries).filter(Boolean).slice(0, 8);
  const openGapIds = new Set(graph.gaps.filter(gap => gap.status !== 'filled').map(gap => gap.id));
  let directionIndex = 0;

  return {
    ...graph,
    internalDiagnosis: diagnosis,
    nextSearchTasks: nextTasks.length ? nextTasks : graph.nextSearchTasks,
    gaps: graph.gaps.map(gap => {
      if (!openGapIds.has(gap.id)) return gap;
      const direction = diagnosis.recommendedDirections[directionIndex];
      directionIndex += 1;
      if (!direction) return gap;
      return {
        ...gap,
        suggestedQueries: direction.queries,
        preferredSources: direction.preferredSources,
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

async function queryLocalKb(
  token: string,
  userId: string,
  kbId: string | undefined,
  query: string,
  llmConfig: any
): Promise<ResearchSource[]> {
  if (!kbId) return [];
  const embeddingConfig = await getUserEmbeddingConfig(token);
  if (!embeddingConfig?.apiKey) return [];

  try {
    const res = await fetch(`${embeddingConfig.hyperragServiceUrl}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kb_id: kbId,
        user_id: userId,
        question: query,
        mode: 'hyper',
        config: {
          llm: {
            api_key: llmConfig?.apiKey || '',
            model_name: llmConfig?.defaultModel || 'deepseek-chat',
            base_url: llmConfig?.endpoint?.replace('/chat/completions', '') || 'https://api.deepseek.com/v1',
          },
          embedding: {
            api_key: embeddingConfig.apiKey,
            model_name: embeddingConfig.model,
            base_url: embeddingConfig.apiUrl,
            dimensions: embeddingConfig.dimensions,
          },
        },
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.text_units || []).slice(0, 5).map((unit: any, index: number) => ({
      id: `local-kb-${index}-${Date.now()}`,
      title: unit.document_title || 'Local knowledge base passage',
      snippet: String(unit.content || '').slice(0, 700),
      url: '',
      type: 'web' as const,
      sourceProvider: 'local_kb' as const,
      sourceKind: 'local_kb' as const,
      fullTextExcerpt: String(unit.content || '').slice(0, 2000),
      score: 1.5,
    }));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthedClient(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const { data: session, error: sessionError } = await auth.supabase
    .from('research_sessions')
    .select('*')
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (sessionError) return researchDbErrorResponse(sessionError);
  if (!session) return NextResponse.json({ error: 'Research session not found' }, { status: 404 });
  if (!session.scope) return NextResponse.json({ error: 'Research scope is not confirmed yet' }, { status: 400 });

  const encoder = new TextEncoder();
  const transform = new TransformStream();
  const writer = transform.writable.getWriter();
  const send = async (event: string, data: object) => writer.write(encoder.encode(sseEvent(event, data)));

  (async () => {
    const storedScope = session.scope as ResearchScope;
    const scope: ResearchScope = {
      ...storedScope,
      sources: Array.isArray(body.sources) && body.sources.length > 0 ? body.sources : storedScope.sources,
      depth: body.depth || storedScope.depth,
    };
    let graph = (session.graph_template || buildGraphTemplate(scope)) as ResearchGraphTemplate;

    try {
      await auth.supabase
        .from('research_sessions')
        .update({ status: 'SEARCHING', updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', auth.user.id);

      const fallbackSearchQuery = cleanSearchQuery(String(body.query || buildSearchQueryFromGraph(scope, graph)), scope);
      await send('status', { stage: 'planning', message: '正在根据领域认知缺口生成检索计划' });

      const [llmConfig, toolConfig] = await Promise.all([
        getUserLLMConfig(auth.token),
        getUserResearchToolConfig(auth.token),
      ]);
      await send('debug', {
        stage: 'config',
        llmGateWillAttempt: Boolean(llmConfig?.apiKey && llmConfig?.endpoint && llmConfig?.defaultModel),
        hasTavily: Boolean(toolConfig?.tavilyApiKey),
        hasSemanticScholar: Boolean(toolConfig?.semanticScholarApiKey),
        includeGithub: scope.sources.includes('github') || body.includeGithub === true,
      });

      const planningContext = buildPlanningContext(scope, graph);
      const planOverride = Array.isArray(body.planOverride) ? body.planOverride : null;
      const rawPlan: PlannedResearchQuery[] = planOverride
        ? sanitizeForJsonb(planOverride)
        : body.query
          ? [{
              perspective: '用户指定追问',
              reason: '用户手动输入了本轮检索问题。',
              queries: [String(body.query)],
              preferredSources: preferredSourcesFromScope(scope),
            }]
          : await planResearchQueries({
              query: fallbackSearchQuery,
              mode: sourcePrefsToMode(scope.sources),
              depth: researchDepthToRetrievalDepth(scope.depth),
              llmConfig,
              toolConfig,
              supabase: auth.supabase,
              includeGithub: scope.sources.includes('github') || body.includeGithub === true,
              planningContext,
            });
      const retrievalPlan = normalizeRetrievalPlan(rawPlan, scope);
      const safePlan = retrievalPlan.length ? retrievalPlan : normalizeRetrievalPlan(planningContext.openGaps.map(gap => ({
        perspective: gap.label,
        reason: gap.reason,
        queries: gap.suggestedQueries,
        preferredSources: gap.preferredSources,
      })), scope);
      const plannedSearchQuery = safePlan.flatMap(item => item.queries).join(' | ') || fallbackSearchQuery;

      await send('status', { stage: 'planning', message: '本轮领域检索计划已生成，可以编辑后执行' });
      await send('tasks', {
        query: plannedSearchQuery,
        tasks: safePlan.flatMap(item => item.queries),
        plannedQueries: safePlan,
      });
      await send('debug', {
        stage: 'plan',
        count: safePlan.length,
        plan: safePlan.map(item => ({
          perspective: item.perspective,
          queries: item.queries,
          preferredSources: item.preferredSources,
        })),
      });
      logResearchRun(id, 'plan', {
        topic: scope.topic,
        depth: scope.depth,
        sources: scope.sources,
        queries: safePlan.flatMap(item => item.queries),
      });

      if (body.planOnly === true) {
        await send('done', { plannedQueries: safePlan, query: plannedSearchQuery, graph });
        await writer.close();
        return;
      }

      await send('status', { stage: 'searching', message: '正在检索论文摘要、Web 摘录和实践来源' });
      const retrievalDebug: ResearchRetrievalDebugEvent[] = [];
      const sourcesFromRetrieval = await retrieveResearchSources({
        query: `${scope.topic} ${scope.focus.join(' ')}`,
        mode: sourcePrefsToMode(scope.sources),
        depth: researchDepthToRetrievalDepth(scope.depth),
        llmConfig,
        toolConfig,
        supabase: auth.supabase,
        plan: safePlan,
        includeGithub: scope.sources.includes('github') || body.includeGithub === true,
        planningContext,
        debugEvents: retrievalDebug,
      });

      let sources: ResearchSource[] = sanitizeForJsonb(sourcesFromRetrieval);
      if (scope.sources.includes('local_kb') && body.kb_id) {
        sources = sanitizeForJsonb([
          ...sources,
          ...(await queryLocalKb(auth.token, auth.user.id, body.kb_id, plannedSearchQuery, llmConfig)),
        ]);
      }

      await send('debug', {
        stage: 'retrieval',
        events: retrievalDebug,
        finalSources: {
          total: sources.length,
          countsByProvider: countSources(sources),
        },
      });
      logResearchRun(id, 'retrieval', {
        events: retrievalDebug,
        finalTotal: sources.length,
        finalByProvider: countSources(sources),
      });
      for (const source of sources) await send('source', { source });

      await send('status', { stage: 'gate', message: '正在筛选能支撑领域认知框架的来源' });
      const gate = sanitizeForJsonb(await runEvidenceGate({
        llmConfig,
        scope,
        graph,
        sources,
        plannedQueries: safePlan,
      }));
      await send('gate', {
        accepted: gate.accepted.length,
        rejected: gate.rejected.length,
        fallback: gate.fallback === true,
        fallbackReason: gate.fallbackReason || '',
        llmAttempted: gate.llmAttempted === true,
        llmStatus: gate.llmStatus || '',
        acceptedSamples: summarizeGateItems(gate.accepted, sources, 8),
        rejectedSamples: summarizeGateItems(gate.rejected, sources, 8),
      });
      await send('debug', {
        stage: 'gate',
        llmAttempted: gate.llmAttempted === true,
        llmStatus: gate.llmStatus || '',
        fallback: gate.fallback === true,
        fallbackReason: gate.fallbackReason || '',
        accepted: gate.accepted.length,
        rejected: gate.rejected.length,
        acceptedByInsightType: gate.accepted.reduce<Record<string, number>>((acc: Record<string, number>, item: any) => {
          const key = item.insightType || 'unknown';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
      });
      logResearchRun(id, 'gate', {
        llmAttempted: gate.llmAttempted === true,
        llmStatus: gate.llmStatus || '',
        fallback: gate.fallback === true,
        fallbackReason: gate.fallbackReason || '',
        accepted: gate.accepted.length,
        rejected: gate.rejected.length,
      });

      await send('status', { stage: 'extracting', message: '正在把通过筛选的来源写入领域认知图' });
      const applied = applySourcesToGraph(scope, graph, sources, gate.accepted);
      graph = sanitizeForJsonb(applied.graph);
      const evidencePayload = sanitizeForJsonb(applied.evidenceInserts.map(item => ({
        ...item,
        session_id: id,
        user_id: auth.user.id,
        metadata: {
          ...(item.metadata || {}),
          gateFallback: gate.fallback === true,
        },
      })));

      let evidenceRows: any[] = [];
      if (evidencePayload.length > 0) {
        const { data: inserted, error: evidenceError } = await auth.supabase
          .from('research_evidence')
          .insert(evidencePayload)
          .select();
        if (evidenceError) throw evidenceError;
        evidenceRows = inserted || [];
      }

      const { data: allEvidenceRows, error: allEvidenceError } = await auth.supabase
        .from('research_evidence')
        .select('*')
        .eq('session_id', id)
        .eq('user_id', auth.user.id)
        .order('created_at', { ascending: false })
        .limit(60);
      if (allEvidenceError) throw allEvidenceError;

      await send('status', { stage: 'diagnosis', message: '正在基于本轮证据生成内部诊断和下一轮建议' });
      const diagnosis = sanitizeForJsonb(await generateInternalDiagnosis(
        llmConfig,
        scope,
        graph,
        evidenceRowsToTyped(allEvidenceRows || []),
        sources
      ));
      graph = sanitizeForJsonb(applyDiagnosisToGraph(graph, diagnosis));
      await send('diagnosis', { diagnosis });
      await send('debug', {
        stage: 'diagnosis',
        usedLLM: diagnosis.usedLLM === true,
        recommendedDirections: diagnosis.recommendedDirections.map((item: any) => ({
          perspective: item.perspective,
          queries: item.queries,
          preferredSources: item.preferredSources,
        })),
      });

      const round = buildResearchRound(graph, plannedSearchQuery, sources.length, evidenceRows.length);
      graph.rounds = [...(graph.rounds || []), round];

      await send('status', { stage: 'graph', message: '正在更新领域认知图并评估覆盖度' });
      await send('graph', { graph });
      await send('evidence', { evidence: evidenceRowsToTyped(evidenceRows) });
      await send('gaps', { gaps: graph.gaps });

      const { data: updated, error: updateError } = await auth.supabase
        .from('research_sessions')
        .update({
          graph_template: sanitizeForJsonb(graph),
          scope: sanitizeForJsonb(scope),
          depth: scope.depth,
          status: 'WAITING_USER_ADJUSTMENT',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', auth.user.id)
        .select()
        .single();
      if (updateError) throw updateError;

      await send('done', {
        session: updated,
        graph,
        round,
        evidence: evidenceRowsToTyped(evidenceRows),
        sources,
        gate,
      });
      await writer.close();
    } catch (err: any) {
      await auth.supabase
        .from('research_sessions')
        .update({ status: 'WAITING_USER_ADJUSTMENT', updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', auth.user.id);
      await send('done', { error: err.message || 'Research round failed', graph });
      await writer.close();
    }
  })();

  return new Response(transform.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
