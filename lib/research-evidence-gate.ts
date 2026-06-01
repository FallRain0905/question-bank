import type {
  AcceptedResearchEvidence,
  EvidenceGateResult,
  PlannedResearchQuery,
  ResearchGraphTemplate,
  ResearchScope,
  ResearchSource,
  RejectedResearchSource,
} from '@/types';
import { getOpenGaps } from '@/lib/research-workflow';

interface LLMConfig {
  apiKey?: string;
  endpoint?: string;
  defaultModel?: string;
}

interface EvidenceGateOptions {
  llmConfig: LLMConfig;
  scope: ResearchScope;
  graph: ResearchGraphTemplate;
  sources: ResearchSource[];
  plannedQueries: PlannedResearchQuery[];
}

const MIN_RELEVANCE = 0.5;
const NODE_TYPES = ['Paper', 'Method', 'Component', 'GraphSchema', 'Claim', 'Evidence', 'Metric', 'Dataset', 'OpenSourceProject', 'Limitation'];
const GENERIC_TERMS = new Set([
  '研究', '论文', '材料', '方法', '系统', '应用', '评估', '指标', '综述', '技术', '路线', '核心', '代表性',
  'research', 'paper', 'papers', 'method', 'methods', 'system', 'systems', 'review', 'survey', 'recent',
  'study', 'studies', 'application', 'applications', 'evaluation', 'metric', 'metrics', 'core',
]);

const TERM_ALIASES: Array<[RegExp, string[]]> = [
  [/mof|金属有机框架/i, ['mof', 'mofs', 'metal organic framework', 'metal-organic framework', 'metal organic frameworks', 'metal-organic frameworks']],
  [/ccus|碳捕集|碳封存|碳利用/i, ['ccus', 'carbon capture', 'carbon capture utilization and storage', 'carbon capture and storage', 'co2 capture']],
  [/rag|检索增强/i, ['rag', 'retrieval augmented generation', 'retrieval-augmented generation']],
  [/超图|hypergraph/i, ['hypergraph', 'hypergraphs', 'higher order relation', 'higher-order relation', '超图']],
  [/知识图谱|knowledge graph/i, ['knowledge graph', 'knowledge graphs', 'kg', '知识图谱']],
];

function parseJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function sourceText(source: ResearchSource, maxChars = 1200) {
  return [
    source.title,
    source.snippet,
    source.fullTextExcerpt,
    source.authors?.join(', '),
    source.venue,
    source.year ? String(source.year) : '',
  ].filter(Boolean).join('\n').slice(0, maxChars);
}

function tokenize(text: string) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/["'“”‘’()（）【】[\]{}]/g, ' ');
  const tokens: string[] = [];

  for (const match of normalized.matchAll(/[a-z0-9]+|[\u4e00-\u9fa5]+/g)) {
    const part = match[0].trim();
    if (!part) continue;

    if (/^[\u4e00-\u9fa5]+$/.test(part)) {
      if (part.length <= 2) {
        tokens.push(part);
      } else {
        tokens.push(part);
        for (let i = 0; i < part.length - 1; i += 1) tokens.push(part.slice(i, i + 2));
      }
    } else if (part.length > 1) {
      tokens.push(part);
    }
  }

  for (const [pattern, aliases] of TERM_ALIASES) {
    if (pattern.test(normalized)) tokens.push(...aliases);
  }

  return Array.from(new Set(tokens.filter(term => term.length > 1 && !GENERIC_TERMS.has(term))));
}

function overlapScore(terms: string[], haystack: string) {
  if (terms.length === 0) return { score: 0, hits: [] as string[] };
  const hits = terms.filter(term => haystack.includes(term));
  return {
    score: hits.length / Math.min(terms.length, 8),
    hits,
  };
}

function lexicalRelevance(source: ResearchSource, scope: ResearchScope, plannedQueries: PlannedResearchQuery[]) {
  const haystack = sourceText(source, 4000).toLowerCase();
  const title = String(source.title || '').toLowerCase();
  const topicTerms = tokenize(`${scope.topic} ${scope.focus.join(' ')}`);
  const queryTerms = tokenize([
    source.query || '',
    ...plannedQueries.flatMap(item => item.queries || []),
  ].join(' '));
  const topic = overlapScore(topicTerms, haystack);
  const query = overlapScore(queryTerms, haystack);
  const titleTopic = overlapScore(topicTerms, title);
  const titleQuery = overlapScore(queryTerms, title);
  const score = Math.max(
    topic.score,
    query.score * 0.8,
    titleTopic.score + 0.12,
    titleQuery.score * 0.8 + 0.08
  );
  const hits = Array.from(new Set([...topic.hits, ...query.hits, ...titleTopic.hits, ...titleQuery.hits])).slice(0, 8);
  return { score: Math.min(1, score), hits };
}

function fallbackGate(
  scope: ResearchScope,
  graph: ResearchGraphTemplate,
  sources: ResearchSource[],
  plannedQueries: PlannedResearchQuery[] = [],
  fallbackReason = 'LLM gate unavailable or returned an invalid response.'
): EvidenceGateResult {
  const openGaps = getOpenGaps(graph, 5);
  const accepted: AcceptedResearchEvidence[] = [];
  const rejected: RejectedResearchSource[] = [];

  for (const source of sources) {
    const relevance = lexicalRelevance(source, scope, plannedQueries);
    const hasContent = Boolean((source.snippet || source.fullTextExcerpt || '').trim());
    const isAcademic = source.type === 'paper' || ['semantic_scholar', 'semantic_scholar_recommendation', 'openalex', 'arxiv', 'local_papers'].includes(source.sourceProvider || '');
    const threshold = isAcademic ? 0.08 : source.sourceProvider === 'github' ? 0.2 : 0.14;
    const hasSpecificTitleMatch = relevance.hits.length > 0 && Boolean(source.title?.trim());

    if ((!hasContent && !hasSpecificTitleMatch) || relevance.score < threshold) {
      rejected.push({
        sourceId: source.id,
        reason: hasContent
          ? `主题/检索词匹配不足，规则 gate 拒绝。score=${relevance.score.toFixed(2)}，命中=${relevance.hits.join(', ') || '无'}`
          : `缺少摘要或正文，且标题未命中核心主题词。score=${relevance.score.toFixed(2)}，命中=${relevance.hits.join(', ') || '无'}`,
      });
      continue;
    }

    const gapIds = openGaps.slice(0, source.type === 'paper' ? 2 : 1).map(gap => gap.id);
    accepted.push({
      sourceId: source.id,
      relevanceScore: Math.max(MIN_RELEVANCE, Math.min(0.9, 0.52 + relevance.score)),
      gapIds,
      claim: source.type === 'paper'
        ? `论文「${source.title}」提供了与「${scope.topic}」相关的研究证据。`
        : `来源「${source.title}」包含与「${scope.topic}」相关的信息。`,
      evidenceSnippet: (source.fullTextExcerpt || source.snippet || source.title).slice(0, 1200),
      nodeTypes: source.type === 'paper' ? ['Paper', 'Claim', 'Evidence'] : ['Claim', 'Evidence'],
      reason: `LLM gate 不可用，使用规则 fallback 通过。score=${relevance.score.toFixed(2)}，命中=${relevance.hits.join(', ') || '无'}`,
    });
  }

  return { accepted, rejected, fallback: true, fallbackReason };
}

function normalizeGateResult(parsed: any, sources: ResearchSource[]): EvidenceGateResult | null {
  const sourceIds = new Set(sources.map(source => source.id));
  if (!Array.isArray(parsed?.accepted) || !Array.isArray(parsed?.rejected)) return null;

  const accepted: AcceptedResearchEvidence[] = parsed.accepted
    .map((item: any) => ({
      sourceId: String(item?.sourceId || '').trim(),
      relevanceScore: Number(item?.relevanceScore || 0),
      gapIds: Array.isArray(item?.gapIds) ? item.gapIds.map((id: any) => String(id || '').trim()).filter(Boolean) : [],
      claim: String(item?.claim || '').trim(),
      evidenceSnippet: String(item?.evidenceSnippet || '').trim(),
      nodeTypes: Array.isArray(item?.nodeTypes)
        ? item.nodeTypes.map((type: any) => String(type || '').trim()).filter((type: string) => NODE_TYPES.includes(type))
        : [],
      reason: String(item?.reason || '').trim(),
    }))
    .filter((item: AcceptedResearchEvidence) =>
      sourceIds.has(item.sourceId) &&
      item.relevanceScore >= MIN_RELEVANCE &&
      item.gapIds.length > 0 &&
      item.claim &&
      item.evidenceSnippet
    )
    .slice(0, 18);

  const acceptedIds = new Set(accepted.map(item => item.sourceId));
  const rejected: RejectedResearchSource[] = [
    ...parsed.rejected.map((item: any) => ({
      sourceId: String(item?.sourceId || '').trim(),
      reason: String(item?.reason || '不满足 evidence gate 相关性要求。').trim(),
    })),
    ...sources
      .filter(source => !acceptedIds.has(source.id))
      .map(source => ({ sourceId: source.id, reason: '未通过 evidence gate。' })),
  ].filter(item => sourceIds.has(item.sourceId) && !acceptedIds.has(item.sourceId));

  return { accepted, rejected };
}

export async function runEvidenceGate(options: EvidenceGateOptions): Promise<EvidenceGateResult> {
  const { llmConfig, scope, graph, sources, plannedQueries } = options;
  if (sources.length === 0) return { accepted: [], rejected: [] };
  if (!llmConfig?.apiKey || !llmConfig.endpoint || !llmConfig.defaultModel) {
    return fallbackGate(scope, graph, sources, plannedQueries, 'LLM settings are incomplete, so the rule fallback was used.');
  }

  const openGaps = getOpenGaps(graph, 6);
  const sourceContext = sources.slice(0, 24).map((source, index) => `[${index + 1}]
sourceId: ${source.id}
title: ${source.title}
provider: ${source.sourceProvider || source.type}
year: ${source.year || ''}
citations: ${source.citationCount || ''}
query: ${source.query || ''}
text:
${sourceText(source)}
`).join('\n');

  const prompt = `You are a strict but fair evidence gate for a research assistant.
Return only JSON:
{"accepted":[{"sourceId":"...","relevanceScore":0.0,"gapIds":["..."],"claim":"...","evidenceSnippet":"...","nodeTypes":["Paper","Method","Claim","Evidence","Metric","Dataset","Limitation","OpenSourceProject"],"reason":"..."}],"rejected":[{"sourceId":"...","reason":"..."}]}

Rules:
- The user's original topic is authoritative: ${scope.topic}
- Selected focus: ${scope.focus.join(' / ') || 'not specified'}
- Accept sources that directly help answer the topic or one of the planned queries.
- Do not reject a source merely because the user's topic is Chinese and the source is English; map common academic aliases and acronyms.
- Reject sources from unrelated domains even if they match generic words.
- relevanceScore must be between 0 and 1. Accept only if score >= ${MIN_RELEVANCE}.
- evidenceSnippet must be a short, faithful excerpt or abstract summary from the source text.
- Assign each accepted source to one or more open gap ids.
- If the source has no usable abstract/snippet/body, reject it unless the title is highly specific to the topic.
- Do not invent facts beyond the source text.

Open gaps:
${openGaps.map(gap => `- ${gap.id}: ${gap.label}; ${gap.reason}`).join('\n')}

Planned queries:
${plannedQueries.flatMap(item => item.queries).join(' | ')}

Sources:
${sourceContext}`;

  try {
    const res = await fetch(llmConfig.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmConfig.apiKey}` },
      body: JSON.stringify({
        model: llmConfig.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 2200,
      }),
    });
    if (!res.ok) return fallbackGate(scope, graph, sources, plannedQueries, `LLM gate request failed with HTTP ${res.status}.`);
    const data = await res.json();
    const parsed = parseJsonObject(data.choices?.[0]?.message?.content || '');
    const normalized = normalizeGateResult(parsed, sources);
    return normalized || fallbackGate(scope, graph, sources, plannedQueries, 'LLM gate returned JSON that did not match the expected schema.');
  } catch (err: any) {
    return fallbackGate(scope, graph, sources, plannedQueries, `LLM gate failed: ${err?.message || 'unknown error'}.`);
  }
}
