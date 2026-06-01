import type { PlannedResearchQuery, ResearchSource } from '@/types';

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
}

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

const BAD_RETRIEVAL_QUERY_PARTS = [
  '代表性论文不足',
  '核心技术路线不足',
  '论文图结构证据不足',
  '系统架构组件不足',
  '评估指标和局限性不足',
  '局限性和适用边界不足',
  '证据不足',
  '待规划',
  '当前缺口',
];

function cleanRetrievalQuery(raw: string) {
  let query = String(raw || '').trim();
  for (const part of BAD_RETRIEVAL_QUERY_PARTS) query = query.replaceAll(part, ' ');
  return query.replace(/\s+/g, ' ').trim();
}

function fallbackPlan(query: string, mode: ResearchMode, depth: ResearchDepth): PlannedResearchQuery[] {
  const candidates = [
    {
      perspective: 'Direct evidence',
      reason: 'Search for sources that answer the user question directly.',
      queries: [query],
    },
    {
      perspective: 'Terminology and mechanisms',
      reason: 'Search for the core concepts, mechanisms, and technical vocabulary.',
      queries: [`${query} mechanism concepts`],
    },
    {
      perspective: 'Applications and value',
      reason: 'Search for practical use cases and domain value.',
      queries: [`${query} applications value`],
    },
    {
      perspective: 'Recent progress',
      reason: 'Search for newer work and emerging results.',
      queries: [`${query} recent progress`],
    },
    {
      perspective: 'Limitations and comparisons',
      reason: 'Search for tradeoffs and comparison points.',
      queries: [`${query} limitations comparison`],
    },
    {
      perspective: 'Research methods',
      reason: 'Search for methods, datasets, and evaluation details.',
      queries: [`${query} methods evaluation`],
    },
  ];
  return candidates.slice(0, DEPTH_CONFIG[depth].perspectives).map(item => ({
    ...item,
    preferredSources: preferredSourcesForMode(mode),
  }));
}

function cleanPlan(plan: any, query: string, mode: ResearchMode, depth: ResearchDepth): PlannedResearchQuery[] {
  const target = DEPTH_CONFIG[depth].perspectives;
  const rows = Array.isArray(plan?.perspectives) ? plan.perspectives : [];
  const cleaned = rows
    .map((row: any) => ({
      perspective: String(row?.perspective || '').trim(),
      reason: String(row?.reason || '').trim(),
      queries: Array.isArray(row?.queries)
        ? row.queries.map((q: any) => cleanRetrievalQuery(String(q || ''))).filter(Boolean).slice(0, 2)
        : [],
      preferredSources: Array.isArray(row?.preferredSources)
        ? row.preferredSources.map((s: any) => String(s || '').trim()).filter(Boolean)
        : preferredSourcesForMode(mode),
    }))
    .filter((row: PlannedResearchQuery) => row.perspective && row.queries.length > 0)
    .slice(0, target);

  if (cleaned.length >= Math.min(2, target)) return cleaned;
  return fallbackPlan(query, mode, depth);
}

export async function planResearchQueries(options: RetrievalOptions): Promise<PlannedResearchQuery[]> {
  const { query, mode, depth, llmConfig } = options;
  const target = DEPTH_CONFIG[depth].perspectives;
  const sources = preferredSourcesForMode(mode).join(', ');

  const prompt = `Create a research retrieval plan for the user question.

Return only JSON:
{"perspectives":[{"perspective":"...","reason":"...","queries":["original-language query","English academic query"],"preferredSources":["..."]}]}

Rules:
- Create exactly ${target} perspectives.
- Each perspective must have exactly 2 queries.
- Query 1 should preserve the user's language/context when useful.
- Query 2 should be concise English academic/web search wording.
- preferredSources can use: ${sources}.
- Do not answer the question.

User question: ${query}`;

  try {
    const content = await callLLM(llmConfig, prompt, depth === 'deep' ? 1200 : 800);
    return cleanPlan(sseSafeJson(content), query, mode, depth);
  } catch {
    return fallbackPlan(query, mode, depth);
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
      score: Number(r.score || 0),
    }));
  } catch {
    return [];
  }
}

function mapScholarPaper(p: any, provider: ResearchSource['sourceProvider']): ResearchSource {
  return {
    id: `${provider}-${p.paperId}`,
    title: p.title || 'Paper',
    snippet: (p.abstract || '').slice(0, 700),
    url: p.url || (p.paperId ? `https://www.semanticscholar.org/paper/${p.paperId}` : ''),
    type: 'paper',
    sourceProvider: provider,
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
      fields: 'title,abstract,url,year,authors,citationCount,venue',
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
      fields: 'title,abstract,url,year,authors,citationCount,venue',
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
        + Math.min(2, Number(source.citationCount || 0) / 500)
        + (source.year ? Math.max(0, source.year - 2020) / 10 : 0),
    }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

export async function retrieveResearchSources(options: RetrievalOptions & { plan: PlannedResearchQuery[] }) {
  const { query, mode, depth, toolConfig, supabase, plan, includeGithub } = options;
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
      if (web && (wantsSource(preferred, 'tavily', web) || wantsSource(preferred, 'crawled_web', web))) {
        searches.push(searchTavily(searchQuery, toolConfig.tavilyApiKey, config.perSourceLimit));
      }
      if (includeGithub && wantsSource(preferred, 'github', false)) {
        searches.push(searchGitHub(searchQuery, toolConfig.githubToken, Math.max(2, Math.ceil(config.perSourceLimit / 2))));
      }
      if (academic) {
        if (wantsSource(preferred, 'semantic_scholar', academic)) {
          searches.push(searchSemanticScholar(searchQuery, toolConfig.semanticScholarApiKey, config.perSourceLimit));
        }
        if (wantsSource(preferred, 'openalex', academic)) {
          searches.push(searchOpenAlex(searchQuery, config.perSourceLimit));
        }
        if (wantsSource(preferred, 'arxiv', academic)) {
          searches.push(searchArxiv(searchQuery, Math.max(2, Math.ceil(config.perSourceLimit / 2))));
        }
        if (wantsSource(preferred, 'local_papers', academic)) {
          searches.push(searchLocalPapers(searchQuery, supabase, Math.max(2, Math.ceil(config.perSourceLimit / 2))));
        }
      }
      const results = await Promise.all(searches);
      rawSources.push(...results.flat().map(source => attachMeta(source, item, searchQuery)));
    }
  }

  const seedIds = extractSemanticScholarIds(rawSources);
  if (academic) {
    rawSources.push(...(await recommendSemanticScholar(seedIds, toolConfig.semanticScholarApiKey, config.perSourceLimit)));
  }

  const unique = uniqueItems(rawSources, source => source.doi || source.url || source.title);
  const crawlTargets = unique
    .filter(source => source.sourceProvider === 'tavily')
    .slice(0, config.crawlLimit);
  const crawled = await Promise.all(crawlTargets.map(source => crawlSource(source, query, config.maxChars)));
  const crawledIds = new Set(crawled.map(source => source.id));
  const merged = unique.map(source => crawledIds.has(source.id) ? crawled.find(item => item.id === source.id)! : source);

  const ranked = rankSources(merged, query);
  const relevant = ranked.filter(source => termScore(source, query) > 0 || (source.score || 0) >= 4);
  const finalSources = relevant.length >= Math.min(4, ranked.length) ? relevant : ranked;
  return finalSources.slice(0, depth === 'deep' ? 20 : depth === 'medium' ? 12 : 8);
}

export async function runResearchRetrieval(options: RetrievalOptions) {
  const plan = await planResearchQueries(options);
  const sources = await retrieveResearchSources({ ...options, plan });
  const searchQueries = uniqueItems(plan.flatMap(item => item.queries), q => q);
  return { plan, sources, searchQueries };
}
