import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserEmbeddingConfig, getUserLLMConfig, getUserResearchToolConfig } from '@/lib/user-settings';
import { retrieveResearchSources } from '@/lib/research-retrieval';
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
import type { PlannedResearchQuery, ResearchGraphTemplate, ResearchScope, ResearchSource } from '@/types';

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

const BAD_QUERY_PHRASES = [
  '代表性论文不足',
  '核心技术路线不足',
  '论文图结构证据不足',
  '系统架构组件不足',
  '评估指标和局限性不足',
  '局限性和适用边界不足',
  '证据不足',
  '待规划',
  '当前缺口',
  '不足',
];

function cleanSearchQuery(raw: string, scope: ResearchScope) {
  let query = String(raw || '').trim();
  for (const phrase of BAD_QUERY_PHRASES) query = query.replaceAll(phrase, ' ');
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

function parseJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function callLLM(llmConfig: any, prompt: string, maxTokens = 1000) {
  if (!llmConfig?.apiKey || !llmConfig?.endpoint || !llmConfig?.defaultModel) throw new Error('LLM config missing');
  const res = await fetch(llmConfig.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmConfig.apiKey}` },
    body: JSON.stringify({
      model: llmConfig.defaultModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function fallbackRoundPlan(scope: ResearchScope, graph: ResearchGraphTemplate): PlannedResearchQuery[] {
  const gaps = getOpenGaps(graph, scope.depth === 'deep' ? 5 : scope.depth === 'fast' ? 2 : 3);
  const preferredSources = preferredSourcesFromScope(scope);
  const tasks = gaps.map(gap => ({
    perspective: gap.label,
    reason: gap.reason,
    queries: gap.suggestedQueries.slice(0, 2),
    preferredSources,
  }));
  return normalizeRetrievalPlan(tasks, scope, scope.depth === 'deep' ? 6 : scope.depth === 'fast' ? 2 : 4);
}

async function planRoundQueries(
  llmConfig: any,
  scope: ResearchScope,
  graph: ResearchGraphTemplate
): Promise<PlannedResearchQuery[]> {
  const fallback = fallbackRoundPlan(scope, graph);
  const target = scope.depth === 'deep' ? 6 : scope.depth === 'fast' ? 2 : 4;
  const gaps = getOpenGaps(graph, target)
    .map(gap => `- ${gap.label}: ${gap.reason}; suggested=${gap.suggestedQueries.join(' / ')}`)
    .join('\n');
  const priorRounds = (graph.rounds || [])
    .slice(-3)
    .map(round => `Round ${round.index}: ${round.query}`)
    .join('\n') || 'none';

  const prompt = `You are a research retrieval planner for an interactive research agent.
Return only JSON:
{"perspectives":[{"perspective":"...","reason":"...","queries":["original-language query","English academic query"],"preferredSources":["semantic_scholar","openalex","arxiv","local_papers","tavily","crawled_web","github","local_kb"]}]}

Rules:
- Create exactly ${target} perspectives.
- Every perspective must fill one current evidence gap and should not be generic.
- Every query must stay anchored to the user's original topic and core object.
- Do not put UI gap labels or status words into queries, such as "代表性论文不足", "核心技术路线不足", "证据不足", "待规划".
- Do not introduce knowledge graph, graph schema, hypergraph, RAG, or paper graph topics unless the original topic or selected focus explicitly contains them.
- Avoid repeating recent queries.
- preferredSources must be chosen only from: ${preferredSourcesFromScope(scope).join(', ')}.

Original topic: ${scope.topic}
Selected focus: ${scope.focus.join(' / ') || 'not specified'}
Constraints: ${(scope.constraints || []).join(' / ') || 'none'}
Current gaps:
${gaps}

Recent searches:
${priorRounds}`;

  try {
    const content = await callLLM(llmConfig, prompt, scope.depth === 'deep' ? 1600 : 1100);
    const parsed = parseJsonObject(content);
    const rows = Array.isArray(parsed?.perspectives) ? parsed.perspectives : [];
    const planned = rows
      .map((row: any) => ({
        perspective: String(row?.perspective || '').trim(),
        reason: String(row?.reason || '').trim(),
        queries: Array.isArray(row?.queries)
          ? row.queries.map((query: any) => String(query || '').trim()).filter(Boolean).slice(0, 2)
          : [],
        preferredSources: Array.isArray(row?.preferredSources)
          ? row.preferredSources.map((source: any) => String(source || '').trim()).filter(Boolean)
          : preferredSourcesFromScope(scope),
      }))
      .filter((row: PlannedResearchQuery) => row.perspective && row.queries.length > 0)
      .slice(0, target);
    const normalized = normalizeRetrievalPlan(planned, scope, target);
    return normalized.length >= Math.min(2, target) ? normalized : fallback;
  } catch {
    return fallback;
  }
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
      await send('status', { stage: 'planning', message: '正在根据当前研究缺口生成检索任务' });

      const [llmConfig, toolConfig] = await Promise.all([
        getUserLLMConfig(auth.token),
        getUserResearchToolConfig(auth.token),
      ]);

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
          : await planRoundQueries(llmConfig, scope, graph);
      const retrievalPlan = normalizeRetrievalPlan(rawPlan, scope);
      const safePlan = retrievalPlan.length ? retrievalPlan : fallbackRoundPlan(scope, graph);
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
      });

      let sources: ResearchSource[] = sanitizeForJsonb(sourcesFromRetrieval);
      if (scope.sources.includes('local_kb') && body.kb_id) {
        sources = sanitizeForJsonb([
          ...sources,
          ...(await queryLocalKb(auth.token, auth.user.id, body.kb_id, plannedSearchQuery, llmConfig)),
        ]);
      }

      for (const source of sources) await send('source', { source });

      await send('status', { stage: 'extracting', message: '正在抽取 Paper / Method / Claim / Evidence 节点' });
      const applied = applySourcesToGraph(scope, graph, sources);
      graph = sanitizeForJsonb(applied.graph);
      const evidencePayload = sanitizeForJsonb(applied.evidenceInserts.map(item => ({
        ...item,
        session_id: id,
        user_id: auth.user.id,
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

      await send('status', { stage: 'graph', message: '正在更新检索超图并评估缺口' });
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
