import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserEmbeddingConfig, getUserLLMConfig, getUserResearchToolConfig } from '@/lib/user-settings';
import { planResearchQueries, retrieveResearchSources } from '@/lib/research-retrieval';
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
import type { PlannedResearchQuery, ResearchGraphTemplate, ResearchPlanningContext, ResearchScope, ResearchSource } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORBIDDEN_QUERY_TERMS = [
  '代表性论文不足',
  '核心技术路线不足',
  '论文图结构证据不足',
  '系统架构组件不足',
  '评价指标和局限性不足',
  '局限性和适用边界不足',
  '证据不足',
  '待规划',
  '当前缺口',
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
        perspective: String(item.perspective || '定向检索').trim(),
        reason: String(item.reason || '补齐当前研究图谱缺口的可引用证据。').trim(),
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
      await send('status', { stage: 'planning', message: '正在根据当前研究缺口生成检索计划' });

      const [llmConfig, toolConfig] = await Promise.all([
        getUserLLMConfig(auth.token),
        getUserResearchToolConfig(auth.token),
      ]);

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

      await send('status', { stage: 'planning', message: '本轮检索计划已生成，可以编辑后执行' });
      await send('tasks', {
        query: plannedSearchQuery,
        tasks: safePlan.flatMap(item => item.queries),
        plannedQueries: safePlan,
      });

      if (body.planOnly === true) {
        await send('done', { plannedQueries: safePlan, query: plannedSearchQuery, graph });
        await writer.close();
        return;
      }

      await send('status', { stage: 'searching', message: '正在调用统一研究检索管线' });
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
      });

      let sources: ResearchSource[] = sanitizeForJsonb(sourcesFromRetrieval);
      if (scope.sources.includes('local_kb') && body.kb_id) {
        sources = sanitizeForJsonb([
          ...sources,
          ...(await queryLocalKb(auth.token, auth.user.id, body.kb_id, plannedSearchQuery, llmConfig)),
        ]);
      }

      for (const source of sources) await send('source', { source });

      await send('status', { stage: 'gate', message: '正在筛选相关证据并拒绝噪音来源' });
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
        rejectedSamples: gate.rejected.slice(0, 5),
      });

      await send('status', { stage: 'extracting', message: '正在把通过筛选的证据写入研究图谱' });
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

      const round = buildResearchRound(graph, plannedSearchQuery, sources.length, evidenceRows.length);
      graph.rounds = [...(graph.rounds || []), round];

      await send('status', { stage: 'graph', message: '正在更新检索超图并评估证据覆盖' });
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
