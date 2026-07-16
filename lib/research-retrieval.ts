import type { PlannedResearchQuery, ResearchPlanningContext, ResearchSource } from '@/types';

export type ResearchMode = 'academic' | 'general' | 'both';
export type ResearchDepth = 'fast' | 'medium' | 'deep';

type SupabaseLike = {
  from: (table: string) => any;
};

interface LLMConfig {
  apiKey: string;
  endpoint: string;
  defaultModel: string;
}

interface ToolConfig {
  tavilyApiKey: string;
  semanticScholarApiKey: string;
  githubToken?: string;
}

interface RetrievalOptions {
  query: string;
  mode: ResearchMode;
  depth: ResearchDepth;
  llmConfig: LLMConfig;
  toolConfig: ToolConfig;
  supabase?: SupabaseLike;
  includeGithub?: boolean;
  planningContext?: ResearchPlanningContext;
  debugEvents?: ResearchRetrievalDebugEvent[];
}

export type ResearchRetrievalDebugEvent =
  | {
      stage: 'query';
      perspective: string;
      query: string;
      preferredSources: string[];
      requestedProviders: string[];
      countsByProvider: Record<string, number>;
      total: number;
    }
  | {
      stage: 'recommendations';
      seedIds: string[];
      count: number;
    }
  | {
      stage: 'crawl';
      crawlTargets: number;
      crawled: number;
    }
  | {
      stage: 'final';
      rawCount: number;
      uniqueCount: number;
      rankedCount: number;
      finalCount: number;
      countsByProvider: Record<string, number>;
      countsByType: Record<string, number>;
    };

interface DepthConfig {
  perspectives: number;
  perSourceLimit: number;
  crawlLimit: number;
  maxChars: number;
}

const DEPTH_CONFIG: Record<ResearchDepth, DepthConfig> = {
  fast: { perspectives: 2, perSourceLimit: 3, crawlLimit: 0, maxChars: 1200 },
  medium: { perspectives: 4, perSourceLimit: 5, crawlLimit: 3, maxChars: 3500 },
  deep: { perspectives: 6, perSourceLimit: 8, crawlLimit: 6, maxChars: 6000 },
};

const BAD_RETRIEVAL_QUERY_PARTS = [
  '代表性论文不足',
  '核心技术路线不足',
  '论文图结构证据不足',
  '系统架构组件不足',
  '评价指标和局限性不足',
  '局限性和适用边界不足',
  '代表论文不足',
  '主流方法分类不足',
  '近期趋势不足',
  'Web 实践信号不足',
  '指标与限制不足',
  '领域概览不足',
  '证据不足',
  '待规划',
  '当前缺口',
  '不足',
];

const MATERIAL_QUERY_PATTERNS = [
  /\bsynthesis\b/i,
  /structure[-\s]?property/i,
  /\bBET\b/i,
  /\badsorption\b/i,
  /\bcharacterization\b/i,
  /\bcatalyst|catalysis\b/i,
  /合成|结构.?性能|吸附|表征|催化|材料制备/,
];

const REVIEW_TERMS = /\breview\b|\bsurvey\b|\boverview\b|\btutorial\b|\btaxonomy\b|\broadmap\b|\blandscape\b|综述|述评|概览|教程|分类/i;

function normalizeMode(mode: unknown): ResearchMode {
  return mode === 'academic' || mode === 'general' || mode === 'both' ? mode : 'both';
}

function normalizeDepth(depth: unknown): ResearchDepth {
  return depth === 'fast' || depth === 'deep' || depth === 'medium' ? depth : 'medium';
}

export function normalizeResearchOptions(mode: unknown, depth: unknown) {
  return {
    mode: normalizeMode(mode),
    depth: normalizeDepth(depth),
  };
}

function sseSafeJson(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function callLLM(llm: LLMConfig, prompt: string, maxTokens: number) {
  if (!llm.apiKey || !llm.endpoint || !llm.defaultModel) throw new Error('LLM config missing');
  const res = await fetch(llm.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify({
      model: llm.defaultModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function preferredSourcesForMode(mode: ResearchMode) {
  if (mode === 'academic') return ['semantic_scholar', 'openalex', 'arxiv', 'local_papers'];
  if (mode === 'general') return ['tavily', 'crawled_web'];
  return ['semantic_scholar', 'openalex', 'arxiv', 'local_papers', 'tavily', 'crawled_web'];
}

function sourcePrefsForPlanItem(item: PlannedResearchQuery, mode: ResearchMode) {
  const raw = item.preferredSources?.length ? item.preferredSources : preferredSourcesForMode(mode);
  const normalized = new Set(raw.map(source => String(source || '').toLowerCase().trim()));
  if (normalized.has('papers')) {
    normalized.add('semantic_scholar');
    normalized.add('openalex');
    normalized.add('arxiv');
    normalized.add('local_papers');
  }
  if (normalized.has('web')) {
    normalized.add('tavily');
    normalized.add('crawled_web');
  }
  return normalized;
}

function wantsSource(preferred: Set<string>, source: string, fallback: boolean) {
  return preferred.size === 0 ? fallback : preferred.has(source);
}

function countBy<T>(items: T[], keyFn: (item: T) => string | undefined | null) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = keyFn(item) || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function cleanRetrievalQuery(raw: string) {
  let query = String(raw || '').trim();
  for (const part of BAD_RETRIEVAL_QUERY_PARTS) query = query.replaceAll(part, ' ');
  return query.replace(/\s+/g, ' ').trim();
}

function isMaterialTopic(topic: string) {
  return /mof|材料|化学|化工|催化|电池|吸附|碳捕集|ccus|纳米|晶体|metal|material|chem|catal|adsorption|battery/i.test(topic);
}

function isDomainPollutedQuery(query: string, topic: string) {
  return !isMaterialTopic(topic) && MATERIAL_QUERY_PATTERNS.some(pattern => pattern.test(query));
}

function topicSearchText(topic: string) {
  const lower = topic.toLowerCase();
  const aliases: Array<[RegExp, string]> = [
    [/机器学习|machine learning/i, 'machine learning'],
    [/深度学习|deep learning/i, 'deep learning'],
    [/人工智能|artificial intelligence|\bai\b/i, 'artificial intelligence'],
    [/大语言模型|大型语言模型|llm|large language model/i, 'large language models'],
    [/强化学习|reinforcement learning/i, 'reinforcement learning'],
    [/自监督学习|self-supervised learning/i, 'self-supervised learning'],
    [/联邦学习|federated learning/i, 'federated learning'],
    [/自动机器学习|automl|automated machine learning/i, 'automated machine learning'],
    [/知识图谱|knowledge graph/i, 'knowledge graph'],
    [/超图|hypergraph/i, 'hypergraph'],
    [/碳捕集|ccus|carbon capture/i, 'carbon capture'],
    [/金属有机框架|mof/i, 'metal-organic frameworks'],
  ];
  return aliases.find(([pattern]) => pattern.test(lower))?.[1] || topic;
}

function landscapeQueries(topic: string, originalSuffix: string, englishSuffix: string) {
  return Array.from(new Set([
    cleanRetrievalQuery(`${topic} ${originalSuffix}`),
    cleanRetrievalQuery(`${topicSearchText(topic)} ${englishSuffix}`),
  ].filter(Boolean)));
}

function reviewFirstQueries(topic: string, englishSuffix: string) {
  const englishTopic = topicSearchText(topic);
  return Array.from(new Set([
    cleanRetrievalQuery(`${topic} review survey overview`),
    cleanRetrievalQuery(`${englishTopic} ${englishSuffix}`),
  ].filter(Boolean)));
}

function gapAwareQueries(gapId: string, topic: string) {
  if (gapId === 'gap-papers') {
    return reviewFirstQueries(topic, 'survey review overview highly cited papers');
  }
  if (gapId === 'gap-landscape') {
    return reviewFirstQueries(topic, 'field survey overview research landscape main directions');
  }
  if (gapId === 'gap-trends') {
    return reviewFirstQueries(topic, 'recent advances survey emerging trends 2024 2025 2026');
  }
  if (gapId === 'gap-methods') {
    return reviewFirstQueries(topic, 'methods taxonomy benchmark comparative survey');
  }
  if (gapId === 'gap-evaluation' || gapId === 'gap-limits') {
    return reviewFirstQueries(topic, 'evaluation benchmarks limitations challenges survey');
  }
  if (gapId === 'gap-web') {
    return landscapeQueries(topic, 'industry report practice standard tools', 'industry report practice standard tools');
  }
  return landscapeQueries(topic, 'overview methods trends', 'overview methods trends limitations');
}

function gapPromptHint(gap: ResearchPlanningContext['openGaps'][number]) {
  const hints: Record<string, string> = {
    'gap-landscape': 'field overview; prefer review/survey/overview sources that describe the whole field',
    'gap-trends': 'recent trends; prefer recent surveys, annual reports, and trend/roadmap sources',
    'gap-methods': 'method taxonomy; prefer survey, taxonomy, benchmark, or comparison sources',
    'gap-papers': 'representative papers; first search review/survey/overview/high-citation entry papers, not narrow application papers',
    'gap-web': 'web/practice signal; prefer industry reports, standards, project docs, official docs, or serious technical reports',
    'gap-limits': 'metrics and limitations; prefer benchmark/evaluation/limitation surveys or standards',
    'gap-evaluation': 'metrics and limitations; prefer benchmark/evaluation/limitation surveys or standards',
  };
  return hints[gap.id] || 'field landscape gap';
}

function cleanPlannedQueries(queries: string[], topic: string, limit = 2) {
  return Array.from(new Set(
    queries
      .map(cleanRetrievalQuery)
      .filter(Boolean)
      .filter(query => !isDomainPollutedQuery(query, topic))
  )).slice(0, limit);
}

function contextualFallbackPlan(query: string, mode: ResearchMode, depth: ResearchDepth, planningContext?: ResearchPlanningContext): PlannedResearchQuery[] {
  const topic = planningContext?.topic?.trim() || query.trim();
  const openGaps = planningContext?.openGaps || [];
  const byGap = openGaps.map(gap => {
    const preferredSources = gap.preferredSources?.length ? gap.preferredSources : preferredSourcesForMode(mode);
    if (gap.id === 'gap-papers') {
      return {
        perspective: gap.label,
        reason: gap.reason || 'Find representative papers, surveys, and recent entry points.',
        queries: gapAwareQueries(gap.id, topic),
        preferredSources,
      };
    }
    if (gap.id === 'gap-methods') {
      return {
        perspective: gap.label,
        reason: gap.reason || 'Map major method families, applications, and evaluation dimensions.',
        queries: gapAwareQueries(gap.id, topic),
        preferredSources,
      };
    }
    if (gap.id === 'gap-evaluation') {
      return {
        perspective: gap.label,
        reason: gap.reason || 'Find evaluation metrics, benchmarks, and limitations.',
        queries: gapAwareQueries(gap.id, topic),
        preferredSources,
      };
    }
    const suggested = cleanPlannedQueries(gap.suggestedQueries || [], topic);
    return {
      perspective: gap.label || '定向检索',
      reason: gap.reason || '补齐当前研究缺口的可引用证据。',
      queries: suggested.length ? suggested : gapAwareQueries(gap.id, topic),
      preferredSources,
    };
  });
  if (byGap.length > 0) return byGap.slice(0, DEPTH_CONFIG[depth].perspectives);

  const candidates = [
    {
      perspective: 'Representative papers',
      reason: 'Find high-signal papers that sketch the field and its main directions.',
      queries: gapAwareQueries('gap-papers', topic),
      preferredSources: ['papers'],
    },
    {
      perspective: 'Recent trends',
      reason: 'Find recent research and web signals that reveal what is becoming popular.',
      queries: gapAwareQueries('gap-trends', topic),
      preferredSources: ['papers', 'web'],
    },
    {
      perspective: 'Main methods',
      reason: 'Map the dominant method families, mechanisms, and technical routes.',
      queries: gapAwareQueries('gap-methods', topic),
      preferredSources: ['papers', 'web'],
    },
    {
      perspective: 'Web and practice signals',
      reason: 'Use web sources to capture industry, standards, project, and implementation context.',
      queries: landscapeQueries(topic, '产业 实践 报告 工具', 'industry practice report technical blog tools'),
      preferredSources: ['web', 'github'],
    },
    {
      perspective: 'Metrics and limitations',
      reason: 'Identify common metrics, evaluation dimensions, bottlenecks, and open questions.',
      queries: gapAwareQueries('gap-limits', topic),
      preferredSources: ['papers', 'web'],
    },
    {
      perspective: 'Recommended entry points',
      reason: 'Find sources useful for quickly understanding the field before deep reading.',
      queries: gapAwareQueries('gap-landscape', topic),
      preferredSources: preferredSourcesForMode(mode),
    },
  ];
  return candidates.slice(0, DEPTH_CONFIG[depth].perspectives);
}

function cleanPlan(plan: any, query: string, mode: ResearchMode, depth: ResearchDepth, planningContext?: ResearchPlanningContext): PlannedResearchQuery[] {
  const target = DEPTH_CONFIG[depth].perspectives;
  const forbidden = (planningContext?.forbiddenTerms?.length ? planningContext.forbiddenTerms : BAD_RETRIEVAL_QUERY_PARTS)
    .map(item => item.toLowerCase());
  const rows = Array.isArray(plan?.perspectives) ? plan.perspectives : [];
  const cleaned = rows
    .map((row: any) => ({
      perspective: String(row?.perspective || '').trim(),
      reason: String(row?.reason || '').trim(),
      queries: Array.isArray(row?.queries)
        ? cleanPlannedQueries(row.queries.map((q: any) => String(q || '')), planningContext?.topic || query, 2)
        : [],
      preferredSources: Array.isArray(row?.preferredSources)
        ? row.preferredSources.map((s: any) => String(s || '').trim()).filter(Boolean)
        : preferredSourcesForMode(mode),
    }))
    .filter((row: PlannedResearchQuery) => row.perspective && row.queries.length > 0)
    .map((row: PlannedResearchQuery) => ({
      ...row,
      queries: row.queries.filter(queryText => {
        const lower = queryText.toLowerCase();
        return !forbidden.some(term => term && lower.includes(term)) && !isDomainPollutedQuery(queryText, planningContext?.topic || query);
      }),
    }))
    .filter((row: PlannedResearchQuery) => row.queries.length > 0)
    .slice(0, target);

  if (cleaned.length >= Math.min(2, target)) return cleaned;
  return contextualFallbackPlan(query, mode, depth, planningContext);
}

export async function planResearchQueries(options: RetrievalOptions): Promise<PlannedResearchQuery[]> {
  const { query, mode, depth, llmConfig, planningContext } = options;
  const target = DEPTH_CONFIG[depth].perspectives;
  const sources = preferredSourcesForMode(mode).join(', ');
  const contextBlock = planningContext ? `
Research context:
- Original topic: ${planningContext.topic}
- Selected focus: ${planningContext.focus.join(' / ') || 'not specified'}
- Open gaps:
${planningContext.openGaps.map(gap => `  - ${gap.id}: ${gapPromptHint(gap)}; suggested=${cleanPlannedQueries(gap.suggestedQueries, planningContext.topic, 2).join(' | ') || gapAwareQueries(gap.id, planningContext.topic).join(' | ')}`).join('\n') || '  - none'}
- Recent queries to avoid: ${planningContext.priorQueries.join(' | ') || 'none'}
- Forbidden query terms: ${planningContext.forbiddenTerms.join(' | ') || BAD_RETRIEVAL_QUERY_PARTS.join(' | ')}
` : '';

  const prompt = `Create a research landscape retrieval plan for the user question.

Return only JSON:
{"perspectives":[{"perspective":"...","reason":"...","queries":["original-language query","English academic query"],"preferredSources":["..."]}]}

Rules:
- Create exactly ${target} perspectives.
- Each perspective must have exactly 2 queries.
- Query 1 should preserve the user's language/context when useful.
- Query 2 should be concise English academic/web search wording.
- Every query must stay anchored to the original topic and selected focus.
- The goal is a short field landscape brief, not a full literature review.
- For academic paper searches, prefer review, survey, overview, taxonomy, benchmark, roadmap, or highly cited entry papers before narrow application papers.
- Representative-paper queries must contain at least one intent word such as review, survey, overview, taxonomy, benchmark, highly cited, seminal, or roadmap.
- Narrow domain-application papers are only useful as application examples; they must not be used as representative papers for a broad field.
- Cover representative papers, recent trends, main method families, web/practice signals, metrics, limitations, and open questions when possible.
- Papers use metadata and abstracts only; do not plan PDF download, full-text extraction, or full-paper embedding.
- Web sources are as important as papers when the selected sources include web.
- Gap labels are planning context only; do not copy gap labels or status words into queries.
- Do not introduce knowledge graph, graph schema, hypergraph, RAG, or paper-graph topics unless the original topic or selected focus explicitly asks for them.
- preferredSources can use: ${sources}.
- Do not answer the question.

User question: ${query}
${contextBlock}`;

  try {
    const content = await callLLM(llmConfig, prompt, depth === 'deep' ? 1200 : 800);
    return cleanPlan(sseSafeJson(content), query, mode, depth, planningContext);
  } catch {
    return contextualFallbackPlan(query, mode, depth, planningContext);
  }
}

function uniqueItems<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function attachMeta(source: ResearchSource, plan: PlannedResearchQuery, query: string): ResearchSource {
  return {
    ...source,
    perspective: source.perspective || plan.perspective,
    query: source.query || query,
  };
}

function isReviewLikeSource(source: ResearchSource) {
  return REVIEW_TERMS.test([
    source.title,
    source.abstract,
    source.snippet,
    source.query,
    source.perspective,
    source.venue,
  ].filter(Boolean).join(' '));
}

async function searchTavily(query: string, apiKey: string, limit: number): Promise<ResearchSource[]> {
  if (!apiKey) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'advanced',
        include_answer: false,
        max_results: limit,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((r: any, i: number) => ({
      id: `web-${i}-${encodeURIComponent(query).slice(0, 28)}`,
      title: r.title || 'Web result',
      snippet: (r.content || '').slice(0, 500),
      url: r.url,
      type: 'web' as const,
      sourceProvider: 'tavily' as const,
      sourceKind: 'web_snippet' as const,
      score: Number(r.score || 0),
    }));
  } catch {
    return [];
  }
}

function mapScholarPaper(p: any, provider: ResearchSource['sourceProvider']): ResearchSource {
  const abstract = String(p.abstract || '').slice(0, 1800);
  return {
    id: `${provider}-${p.paperId || encodeURIComponent(p.title || 'paper').slice(0, 40)}`,
    title: p.title || 'Paper',
    snippet: abstract.slice(0, 700),
    url: p.url || (p.paperId ? `https://www.semanticscholar.org/paper/${p.paperId}` : ''),
    type: 'paper',
    sourceProvider: provider,
    sourceKind: 'paper_metadata',
    abstract,
    pdfUrl: p.openAccessPdf?.url || '',
    externalIds: p.externalIds || (p.paperId ? { semanticScholarPaperId: p.paperId } : undefined),
    authors: p.authors?.map((a: any) => a.name).filter(Boolean),
    year: p.year,
    venue: p.venue,
    citationCount: p.citationCount,
    score: (Number(p.citationCount || 0) / 1000) + (p.year ? Math.max(0, p.year - 2015) / 20 : 0),
  };
}

async function searchSemanticScholar(query: string, apiKey: string, limit: number): Promise<ResearchSource[]> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers['x-api-key'] = apiKey;
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?${new URLSearchParams({
      query,
      limit: String(limit),
      fields: 'title,abstract,url,year,authors,citationCount,venue,externalIds,openAccessPdf',
    })}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map((p: any) => mapScholarPaper(p, 'semantic_scholar'));
  } catch {
    return [];
  }
}

function extractSemanticScholarIds(sources: ResearchSource[]) {
  return sources
    .filter(source => source.sourceProvider === 'semantic_scholar')
    .map(source => source.id.replace(/^semantic_scholar-/, ''))
    .filter(Boolean)
    .slice(0, 3);
}

async function recommendSemanticScholar(seedIds: string[], apiKey: string, limit: number): Promise<ResearchSource[]> {
  if (seedIds.length === 0) return [];
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;
    const url = `https://api.semanticscholar.org/recommendations/v1/papers?${new URLSearchParams({
      limit: String(limit),
      fields: 'title,abstract,url,year,authors,citationCount,venue,externalIds,openAccessPdf',
    })}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ positivePaperIds: seedIds }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.recommendedPapers || []).map((p: any) => mapScholarPaper(p, 'semantic_scholar_recommendation'));
  } catch {
    return [];
  }
}

function openAlexAbstract(index: Record<string, number[]> | null | undefined) {
  if (!index) return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(' ');
}

async function searchOpenAlex(query: string, limit: number): Promise<ResearchSource[]> {
  try {
    const url = `https://api.openalex.org/works?${new URLSearchParams({
      search: query,
      'per-page': String(limit),
      sort: 'relevance_score:desc',
    })}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((w: any) => ({
      id: `openalex-${w.id}`,
      title: w.display_name || 'OpenAlex work',
      snippet: openAlexAbstract(w.abstract_inverted_index).slice(0, 700),
      url: w.doi || w.id || '',
      type: 'paper' as const,
      sourceProvider: 'openalex' as const,
      sourceKind: 'paper_metadata' as const,
      abstract: openAlexAbstract(w.abstract_inverted_index).slice(0, 1800),
      pdfUrl: w.primary_location?.pdf_url || w.best_oa_location?.pdf_url || '',
      externalIds: {
        openAlex: w.id,
        doi: w.doi,
      },
      authors: (w.authorships || []).map((a: any) => a.author?.display_name).filter(Boolean),
      year: w.publication_year,
      venue: w.primary_location?.source?.display_name,
      citationCount: w.cited_by_count,
      doi: w.doi,
      score: Number(w.relevance_score || 0) / 1000,
    }));
  } catch {
    return [];
  }
}

function decodeXml(text: string) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function tag(entry: string, name: string) {
  const match = entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ')) : '';
}

async function searchArxiv(query: string, limit: number): Promise<ResearchSource[]> {
  try {
    const url = `https://export.arxiv.org/api/query?${new URLSearchParams({
      search_query: `all:${query}`,
      sortBy: 'relevance',
      sortOrder: 'descending',
      max_results: String(limit),
    })}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'SynapFlow research search/1.0' } });
    if (!res.ok) return [];
    const xml = await res.text();
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    return entries.map((entry, i) => {
      const id = tag(entry, 'id');
      const title = tag(entry, 'title');
      const summary = tag(entry, 'summary');
      const year = Number((tag(entry, 'published') || '').slice(0, 4)) || undefined;
      return {
        id: `arxiv-${id || i}`,
        title: title || 'arXiv paper',
        snippet: summary.slice(0, 700),
        url: id,
        type: 'paper' as const,
        sourceProvider: 'arxiv' as const,
        sourceKind: 'paper_metadata' as const,
        abstract: summary.slice(0, 1800),
        pdfUrl: id ? id.replace('/abs/', '/pdf/') + '.pdf' : '',
        externalIds: id ? { arxiv: id } : undefined,
        year,
        score: year ? Math.max(0, year - 2015) / 20 : 0,
      };
    });
  } catch {
    return [];
  }
}

async function searchLocalPapers(query: string, supabase: SupabaseLike | undefined, limit: number): Promise<ResearchSource[]> {
  if (!supabase) return [];
  const safeQuery = query.replace(/[%,().]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!safeQuery) return [];
  try {
    const { data } = await supabase
      .from('daily_papers')
      .select('id,title_en,title_zh,abstract_en,summary_zh,arxiv_url,pdf_url,published_at')
      .or(`title_en.ilike.%${safeQuery}%,title_zh.ilike.%${safeQuery}%,abstract_en.ilike.%${safeQuery}%,summary_zh.ilike.%${safeQuery}%`)
      .order('published_at', { ascending: false })
      .limit(limit);
    return (data || []).map((p: any) => ({
      id: `local-paper-${p.id}`,
      title: p.title_zh || p.title_en,
      snippet: (p.abstract_en || p.summary_zh || '').slice(0, 700),
      url: p.arxiv_url || p.pdf_url || '',
      type: 'paper' as const,
      sourceProvider: 'local_papers' as const,
      sourceKind: 'paper_metadata' as const,
      abstract: (p.abstract_en || p.summary_zh || '').slice(0, 1800),
      pdfUrl: p.pdf_url || (p.arxiv_url ? String(p.arxiv_url).replace('/abs/', '/pdf/') + '.pdf' : ''),
      year: p.published_at ? Number(String(p.published_at).slice(0, 4)) : undefined,
      score: 1,
    }));
  } catch {
    return [];
  }
}

async function searchGitHub(query: string, token: string | undefined, limit: number): Promise<ResearchSource[]> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'SynapFlow research search',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`https://api.github.com/search/repositories?${new URLSearchParams({
      q: query,
      sort: 'stars',
      order: 'desc',
      per_page: String(Math.min(limit, 10)),
    })}`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map((repo: any) => ({
      id: `github-${repo.id}`,
      title: repo.full_name || repo.name || 'GitHub repository',
      snippet: [
        repo.description || '',
        repo.language ? `Language: ${repo.language}` : '',
        Number.isFinite(repo.stargazers_count) ? `Stars: ${repo.stargazers_count}` : '',
        repo.updated_at ? `Updated: ${String(repo.updated_at).slice(0, 10)}` : '',
      ].filter(Boolean).join(' · ').slice(0, 700),
      url: repo.html_url || '',
      type: 'web' as const,
      sourceProvider: 'github' as const,
      sourceKind: 'github_repo' as const,
      score: Math.log10(Number(repo.stargazers_count || 0) + 1),
    }));
  } catch {
    return [];
  }
}

async function crawlSource(source: ResearchSource, query: string, maxChars: number): Promise<ResearchSource> {
  if (!source.url) return source;
  const serviceUrl = process.env.CRAWL_SERVICE_URL || 'http://localhost:8002';
  try {
    const res = await fetch(`${serviceUrl}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: source.url, query, max_chars: maxChars }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return source;
    const data = await res.json();
    if (!data?.excerpt && !data?.markdown) return source;
    const excerpt = String(data.excerpt || data.markdown || '').slice(0, maxChars);
    return {
      ...source,
      title: data.title || source.title,
      snippet: excerpt.slice(0, 700) || source.snippet,
      fullTextExcerpt: excerpt,
      sourceProvider: 'crawled_web',
      sourceKind: 'web_excerpt',
      score: (source.score || 0) + 1,
    };
  } catch {
    return source;
  }
}

function termScore(source: ResearchSource, query: string) {
  const terms = cleanRetrievalQuery(query).toLowerCase().split(/\s+/).filter(t => t.length > 2).slice(0, 12);
  const haystack = `${source.title} ${source.snippet} ${source.fullTextExcerpt || ''}`.toLowerCase();
  return terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
}

function rankSources(sources: ResearchSource[], userQuery: string) {
  const providerWeight: Record<string, number> = {
    crawled_web: 3,
    semantic_scholar: 2.6,
    semantic_scholar_recommendation: 2.2,
    openalex: 2,
    arxiv: 1.8,
    local_papers: 1.8,
    github: 1.7,
    local_kb: 1.6,
    tavily: 1.5,
  };
  return sources
    .map(source => ({
      ...source,
      score: (source.score || 0)
        + (providerWeight[source.sourceProvider || ''] || 1)
        + termScore(source, userQuery)
        + (source.type === 'paper' && isReviewLikeSource(source) ? 2.5 : 0)
        + (source.type === 'paper' && REVIEW_TERMS.test(source.query || '') ? 1 : 0)
        + Math.min(2, Number(source.citationCount || 0) / 500)
        + (source.year ? Math.max(0, source.year - 2020) / 10 : 0),
    }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

function selectLandscapeSources(sources: ResearchSource[], max: number) {
  const selected: ResearchSource[] = [];
  const seen = new Set<string>();
  const add = (source: ResearchSource) => {
    if (selected.length >= max || seen.has(source.id)) return;
    selected.push(source);
    seen.add(source.id);
  };
  const reviewPapers = sources.filter(source => source.type === 'paper' && isReviewLikeSource(source));
  const papers = sources.filter(source => source.type === 'paper');
  const web = sources.filter(source => source.type === 'web');

  reviewPapers.slice(0, Math.min(4, Math.ceil(max / 3))).forEach(add);
  papers.slice(0, Math.min(6, Math.ceil(max / 2))).forEach(add);
  web.slice(0, Math.min(6, Math.ceil(max / 2))).forEach(add);
  sources.forEach(add);
  return selected.slice(0, max);
}

export async function retrieveResearchSources(options: RetrievalOptions & { plan: PlannedResearchQuery[] }) {
  const { query, mode, depth, toolConfig, supabase, plan, includeGithub, debugEvents } = options;
  const config = DEPTH_CONFIG[depth];
  const academic = mode === 'academic' || mode === 'both';
  const web = mode === 'general' || mode === 'both';
  const rawSources: ResearchSource[] = [];

  for (const item of plan) {
    const preferred = sourcePrefsForPlanItem(item, mode);
    for (const plannedQuery of item.queries.slice(0, 2)) {
      const searchQuery = cleanRetrievalQuery(plannedQuery);
      if (!searchQuery) continue;
      const searches: Promise<ResearchSource[]>[] = [];
      const requestedProviders: string[] = [];
      if (web && (wantsSource(preferred, 'tavily', web) || wantsSource(preferred, 'crawled_web', web))) {
        requestedProviders.push('tavily');
        searches.push(searchTavily(searchQuery, toolConfig.tavilyApiKey, config.perSourceLimit));
      }
      if (includeGithub && wantsSource(preferred, 'github', false)) {
        requestedProviders.push('github');
        searches.push(searchGitHub(searchQuery, toolConfig.githubToken, Math.max(2, Math.ceil(config.perSourceLimit / 2))));
      }
      if (academic) {
        if (wantsSource(preferred, 'semantic_scholar', academic)) {
          requestedProviders.push('semantic_scholar');
          searches.push(searchSemanticScholar(searchQuery, toolConfig.semanticScholarApiKey, config.perSourceLimit));
        }
        if (wantsSource(preferred, 'openalex', academic)) {
          requestedProviders.push('openalex');
          searches.push(searchOpenAlex(searchQuery, config.perSourceLimit));
        }
        if (wantsSource(preferred, 'arxiv', academic)) {
          requestedProviders.push('arxiv');
          searches.push(searchArxiv(searchQuery, Math.max(2, Math.ceil(config.perSourceLimit / 2))));
        }
        if (wantsSource(preferred, 'local_papers', academic)) {
          requestedProviders.push('local_papers');
          searches.push(searchLocalPapers(searchQuery, supabase, Math.max(2, Math.ceil(config.perSourceLimit / 2))));
        }
      }
      const results = await Promise.all(searches);
      const querySources = results.flat().map(source => attachMeta(source, item, searchQuery));
      debugEvents?.push({
        stage: 'query',
        perspective: item.perspective,
        query: searchQuery,
        preferredSources: Array.from(preferred),
        requestedProviders,
        countsByProvider: countBy(querySources, source => source.sourceProvider || source.type),
        total: querySources.length,
      });
      rawSources.push(...querySources);
    }
  }

  const seedIds = extractSemanticScholarIds(rawSources);
  if (academic) {
    const recommended = await recommendSemanticScholar(seedIds, toolConfig.semanticScholarApiKey, config.perSourceLimit);
    debugEvents?.push({ stage: 'recommendations', seedIds, count: recommended.length });
    rawSources.push(...recommended);
  }

  const unique = uniqueItems(rawSources, source => source.doi || source.url || source.title);
  const crawlTargets = unique
    .filter(source => source.sourceProvider === 'tavily')
    .slice(0, config.crawlLimit);
  const crawled = await Promise.all(crawlTargets.map(source => crawlSource(source, query, config.maxChars)));
  debugEvents?.push({
    stage: 'crawl',
    crawlTargets: crawlTargets.length,
    crawled: crawled.filter(source => source.sourceProvider === 'crawled_web').length,
  });
  const crawledIds = new Set(crawled.map(source => source.id));
  const merged = unique.map(source => crawledIds.has(source.id) ? crawled.find(item => item.id === source.id)! : source);

  const ranked = rankSources(merged, query);
  const relevant = ranked.filter(source => termScore(source, query) > 0 || (source.score || 0) >= 4);
  const finalSources = relevant.length >= Math.min(4, ranked.length) ? relevant : ranked;
  const limit = depth === 'deep' ? 20 : depth === 'medium' ? 12 : 8;
  const limited = selectLandscapeSources(finalSources, limit);
  debugEvents?.push({
    stage: 'final',
    rawCount: rawSources.length,
    uniqueCount: unique.length,
    rankedCount: ranked.length,
    finalCount: limited.length,
    countsByProvider: countBy(limited, source => source.sourceProvider || source.type),
    countsByType: countBy(limited, source => source.type),
  });
  return limited;
}

export async function runResearchRetrieval(options: RetrievalOptions) {
  const plan = await planResearchQueries(options);
  const sources = await retrieveResearchSources({ ...options, plan });
  const searchQueries = uniqueItems(plan.flatMap(item => item.queries), q => q);
  return { plan, sources, searchQueries };
}
