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
const LANDSCAPE_NODE_TYPES = [
  'RepresentativePaper',
  'WebInsight',
  'Method',
  'ApplicationArea',
  'Metric',
  'Trend',
  'Limitation',
  'OpenQuestion',
  'OpenSourceProject',
];

const GENERIC_TERMS = new Set([
  '研究', '论文', '材料', '方法', '系统', '应用', '评估', '指标', '综述', '技术', '路线', '核心', '代表性',
  'research', 'paper', 'papers', 'method', 'methods', 'system', 'systems', 'review', 'survey', 'recent',
  'study', 'studies', 'application', 'applications', 'evaluation', 'metric', 'metrics', 'core',
  'agent', 'agents', 'synthesis', 'evidence', 'structure', 'limitations', 'challenges', 'stability',
  'scalability', 'advances', 'open', 'implementation', 'framework', 'frameworks', 'planning',
]);

const TERM_ALIASES: Array<[RegExp, string[]]> = [
  [/mof|金属有机框架/i, ['mof', 'mofs', 'metal organic framework', 'metal-organic framework', 'metal organic frameworks', 'metal-organic frameworks', '金属有机框架']],
  [/ccus|碳捕集|碳封存|碳利用/i, ['ccus', 'carbon capture', 'carbon capture utilization and storage', 'carbon capture and storage', 'co2 capture', 'carbon capture storage', '碳捕集']],
  [/rag|检索增强/i, ['rag', 'retrieval augmented generation', 'retrieval-augmented generation', '检索增强生成']],
  [/超图|hypergraph/i, ['hypergraph', 'hypergraphs', 'higher order relation', 'higher-order relation', '超图']],
  [/知识图谱|knowledge graph/i, ['knowledge graph', 'knowledge graphs', 'kg', '知识图谱']],
];

const INSIGHT_RULES: Array<{
  type: NonNullable<AcceptedResearchEvidence['insightType']>;
  nodeTypes: string[];
  terms: RegExp[];
}> = [
  { type: 'representative_paper', nodeTypes: ['RepresentativePaper', 'Trend'], terms: [/review|survey|overview|representative|citation|综述|代表|进展/i] },
  { type: 'trend', nodeTypes: ['Trend'], terms: [/trend|recent|emerging|advance|progress|hot|frontier|趋势|热点|前沿|进展/i] },
  { type: 'method', nodeTypes: ['Method'], terms: [/method|approach|technique|route|mechanism|model|算法|方法|路线|机制|工艺/i] },
  { type: 'application', nodeTypes: ['ApplicationArea'], terms: [/application|case|industry|practice|use case|应用|场景|产业|实践/i] },
  { type: 'metric', nodeTypes: ['Metric'], terms: [/metric|benchmark|performance|capacity|selectivity|accuracy|指标|性能|基准|评价/i] },
  { type: 'limitation', nodeTypes: ['Limitation'], terms: [/limitation|challenge|barrier|risk|cost|bottleneck|限制|挑战|瓶颈|成本|风险/i] },
  { type: 'web_insight', nodeTypes: ['WebInsight'], terms: [/blog|report|standard|documentation|industry|project|white paper|报告|标准|项目|文档/i] },
  { type: 'open_question', nodeTypes: ['OpenQuestion'], terms: [/future|open question|future direction|unresolved|gap|未来|开放问题|空白/i] },
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
    source.abstract,
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
    .replace(/["'“”‘’()（）【】\[\]{}]/g, ' ');
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

function tokenizeTopic(text: string) {
  const normalized = String(text || '').toLowerCase();
  const terms = tokenize(normalized);
  const rawAcronyms = (normalized.match(/\b[a-z0-9]{2,12}\b/g) || [])
    .filter(term => !GENERIC_TERMS.has(term));
  const aliases = TERM_ALIASES
    .filter(([pattern]) => pattern.test(normalized))
    .flatMap(([, values]) => values);
  return Array.from(new Set([...terms, ...rawAcronyms, ...aliases].filter(term => term.length > 1)));
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
  const haystack = sourceText(source, 4200).toLowerCase();
  const title = String(source.title || '').toLowerCase();
  const topicTerms = tokenizeTopic(scope.topic);
  const focusTerms = tokenize(scope.focus.join(' '));
  const queryTerms = tokenize([
    source.query || '',
    ...plannedQueries.flatMap(item => item.queries || []),
  ].join(' '));
  const topic = overlapScore(topicTerms, haystack);
  const focus = overlapScore(focusTerms, haystack);
  const query = overlapScore(queryTerms, haystack);
  const titleTopic = overlapScore(topicTerms, title);
  const titleFocus = overlapScore(focusTerms, title);
  const titleQuery = overlapScore(queryTerms, title);
  const anchorScore = Math.max(topic.score, titleTopic.score + 0.12);
  const supportScore = Math.max(
    focus.score * 0.65,
    topic.score,
    query.score * 0.8,
    titleTopic.score + 0.12,
    titleFocus.score * 0.65 + 0.08,
    titleQuery.score * 0.8 + 0.08
  );
  const score = Math.min(1, anchorScore * 0.65 + supportScore * 0.35);
  const hits = Array.from(new Set([...topic.hits, ...focus.hits, ...query.hits, ...titleTopic.hits, ...titleFocus.hits, ...titleQuery.hits])).slice(0, 8);
  const anchorHits = Array.from(new Set([...topic.hits, ...titleTopic.hits])).slice(0, 8);
  return { score, supportScore: Math.min(1, supportScore), anchorScore: Math.min(1, anchorScore), hits, anchorHits };
}

function detectInsight(source: ResearchSource) {
  const text = sourceText(source, 5000);
  const matched = INSIGHT_RULES.find(rule => rule.terms.some(term => term.test(text)));
  if (matched) return matched;
  if (source.type === 'paper') return INSIGHT_RULES[0];
  if (source.sourceProvider === 'github') return { type: 'web_insight' as const, nodeTypes: ['OpenSourceProject', 'WebInsight'], terms: [] };
  return { type: 'web_insight' as const, nodeTypes: ['WebInsight'], terms: [] };
}

function keywordTags(text: string, limit = 6) {
  return tokenize(text)
    .filter(term => term.length > 2 || /^[\u4e00-\u9fa5]{2,}$/.test(term))
    .slice(0, limit);
}

function fallbackGate(
  scope: ResearchScope,
  graph: ResearchGraphTemplate,
  sources: ResearchSource[],
  plannedQueries: PlannedResearchQuery[] = [],
  fallbackReason = 'LLM landscape gate unavailable or returned an invalid response.',
  llmStatus: EvidenceGateResult['llmStatus'] = 'exception',
  llmAttempted = true
): EvidenceGateResult {
  const openGaps = getOpenGaps(graph, 6);
  const accepted: AcceptedResearchEvidence[] = [];
  const rejected: RejectedResearchSource[] = [];

  for (const source of sources) {
    const relevance = lexicalRelevance(source, scope, plannedQueries);
    const hasContent = Boolean((source.abstract || source.snippet || source.fullTextExcerpt || '').trim());
    const isAcademic = source.type === 'paper' || ['semantic_scholar', 'semantic_scholar_recommendation', 'openalex', 'arxiv', 'local_papers'].includes(source.sourceProvider || '');
    const anchorThreshold = isAcademic ? 0.08 : source.sourceProvider === 'github' ? 0.16 : 0.12;
    const supportThreshold = isAcademic ? 0.12 : source.sourceProvider === 'github' ? 0.2 : 0.16;
    const insight = detectInsight(source);
    const hasSpecificTitleMatch = relevance.hits.length > 0 && Boolean(source.title?.trim());
    const hasTopicAnchor = relevance.anchorScore >= anchorThreshold || relevance.anchorHits.length > 0;
    const hasLandscapeSignal = insight.type !== 'web_insight' || source.type === 'web' || source.sourceProvider === 'github';
    const hasGapSupport = relevance.supportScore >= supportThreshold || relevance.score >= Math.max(anchorThreshold, supportThreshold);

    if ((!hasContent && !hasSpecificTitleMatch) || !hasTopicAnchor || !hasGapSupport || !hasLandscapeSignal) {
      rejected.push({
        sourceId: source.id,
        reason: `Rule landscape gate rejected: topicAnchor=${relevance.anchorScore.toFixed(2)}, support=${relevance.supportScore.toFixed(2)}, score=${relevance.score.toFixed(2)}, insight=${insight.type}, anchorHits=${relevance.anchorHits.join(', ') || 'none'}, hits=${relevance.hits.join(', ') || 'none'}`,
      });
      continue;
    }

    const text = sourceText(source, 1800);
    const sourceGapIds = openGaps
      .filter(gap => {
        if (source.type === 'paper' && gap.preferredSources.includes('papers')) return true;
        if (source.type === 'web' && (gap.preferredSources.includes('web') || gap.preferredSources.includes('github'))) return true;
        return false;
      })
      .slice(0, source.type === 'paper' ? 2 : 1)
      .map(gap => gap.id);
    const gapIds = sourceGapIds.length ? sourceGapIds : openGaps.slice(0, 1).map(gap => gap.id);

    accepted.push({
      sourceId: source.id,
      relevanceScore: Math.max(MIN_RELEVANCE, Math.min(0.9, 0.52 + relevance.score)),
      gapIds,
      claim: source.type === 'paper'
        ? `论文「${source.title}」为「${scope.topic}」的领域认知提供摘要级线索。`
        : `Web 来源「${source.title}」为「${scope.topic}」补充实践或趋势信号。`,
      evidenceSnippet: text.slice(0, 1200),
      nodeTypes: source.sourceProvider === 'github'
        ? Array.from(new Set(['OpenSourceProject', ...insight.nodeTypes]))
        : insight.nodeTypes,
      reason: `Rule landscape fallback accepted: insight=${insight.type}, topicAnchor=${relevance.anchorScore.toFixed(2)}, support=${relevance.supportScore.toFixed(2)}, hits=${relevance.hits.join(', ') || 'none'}`,
      insightType: insight.type,
      trendCluster: source.perspective || insight.type.replace(/_/g, ' '),
      methodTags: insight.type === 'method' || source.type === 'paper' ? keywordTags(text, 5) : [],
      applicationTags: insight.type === 'application' ? keywordTags(text, 5) : [],
      metricTags: insight.type === 'metric' ? keywordTags(text, 5) : [],
    });
  }

  return { accepted, rejected, fallback: true, fallbackReason, llmAttempted, llmStatus };
}

function normalizeGateResult(parsed: any, sources: ResearchSource[]): EvidenceGateResult | null {
  const sourceIds = new Set(sources.map(source => source.id));
  if (!parsed || !Array.isArray(parsed.accepted)) return null;
  const rejectedRows = Array.isArray(parsed.rejected) ? parsed.rejected : [];

  const accepted: AcceptedResearchEvidence[] = parsed.accepted
    .map((item: any) => ({
      sourceId: String(item?.sourceId || '').trim(),
      relevanceScore: Number(item?.relevanceScore || 0),
      gapIds: Array.isArray(item?.gapIds) ? item.gapIds.map((id: any) => String(id || '').trim()).filter(Boolean) : [],
      claim: String(item?.claim || '').trim(),
      evidenceSnippet: String(item?.evidenceSnippet || '').trim(),
      nodeTypes: Array.isArray(item?.nodeTypes)
        ? item.nodeTypes.map((type: any) => String(type || '').trim()).filter((type: string) => LANDSCAPE_NODE_TYPES.includes(type))
        : [],
      reason: String(item?.reason || '').trim(),
      insightType: item?.insightType,
      trendCluster: String(item?.trendCluster || '').trim(),
      methodTags: Array.isArray(item?.methodTags) ? item.methodTags.map((tag: any) => String(tag || '').trim()).filter(Boolean).slice(0, 8) : [],
      applicationTags: Array.isArray(item?.applicationTags) ? item.applicationTags.map((tag: any) => String(tag || '').trim()).filter(Boolean).slice(0, 8) : [],
      metricTags: Array.isArray(item?.metricTags) ? item.metricTags.map((tag: any) => String(tag || '').trim()).filter(Boolean).slice(0, 8) : [],
    }))
    .filter((item: AcceptedResearchEvidence) =>
      sourceIds.has(item.sourceId) &&
      item.relevanceScore >= MIN_RELEVANCE &&
      item.gapIds.length > 0 &&
      item.claim &&
      item.evidenceSnippet
    )
    .map((item: AcceptedResearchEvidence) => ({
      ...item,
      nodeTypes: item.nodeTypes.length ? item.nodeTypes : ['WebInsight'],
      insightType: item.insightType || 'web_insight',
    }))
    .slice(0, 20);

  const acceptedIds = new Set(accepted.map(item => item.sourceId));
  const explicitRejected: RejectedResearchSource[] = rejectedRows.map((item: any) => ({
      sourceId: String(item?.sourceId || '').trim(),
      reason: String(item?.reason || 'Did not satisfy the landscape gate.').trim(),
    }))
    .filter((item: RejectedResearchSource) => sourceIds.has(item.sourceId) && !acceptedIds.has(item.sourceId));
  const explicitRejectedIds = new Set(explicitRejected.map(item => item.sourceId));
  const rejected: RejectedResearchSource[] = [
    ...explicitRejected,
    ...sources
      .filter(source => !acceptedIds.has(source.id) && !explicitRejectedIds.has(source.id))
      .map(source => ({ sourceId: source.id, reason: 'Not accepted by landscape gate.' })),
  ].filter(item => sourceIds.has(item.sourceId) && !acceptedIds.has(item.sourceId));

  return { accepted, rejected, fallback: false, llmAttempted: true, llmStatus: 'used' };
}

export async function runEvidenceGate(options: EvidenceGateOptions): Promise<EvidenceGateResult> {
  const { llmConfig, scope, graph, sources, plannedQueries } = options;
  if (sources.length === 0) return { accepted: [], rejected: [] };
  if (!llmConfig?.apiKey || !llmConfig.endpoint || !llmConfig.defaultModel) {
    return fallbackGate(scope, graph, sources, plannedQueries, 'LLM settings are incomplete, so the rule fallback was used.', 'missing_config', false);
  }

  const openGaps = getOpenGaps(graph, 6);
  const sourceContext = sources.slice(0, 24).map((source, index) => `[${index + 1}]
sourceId: ${source.id}
title: ${source.title}
type: ${source.type}
provider: ${source.sourceProvider || source.type}
sourceKind: ${source.sourceKind || ''}
year: ${source.year || ''}
citations: ${source.citationCount || ''}
query: ${source.query || ''}
text:
${sourceText(source)}
`).join('\n');

  const prompt = `You are a strict but fair landscape gate for a research assistant.
The product is building a short field landscape brief, not a full literature review.
Paper sources only contain metadata and abstracts. Web sources contain snippets or short crawled excerpts. Both papers and web sources are valuable.

Return only JSON:
{"accepted":[{"sourceId":"...","relevanceScore":0.0,"gapIds":["..."],"claim":"...","evidenceSnippet":"...","nodeTypes":["RepresentativePaper","WebInsight","Method","ApplicationArea","Metric","Trend","Limitation","OpenQuestion","OpenSourceProject"],"insightType":"representative_paper|method|trend|application|metric|limitation|web_insight|open_question","trendCluster":"...","methodTags":["..."],"applicationTags":["..."],"metricTags":["..."],"reason":"..."}],"rejected":[{"sourceId":"...","reason":"..."}]}

Rules:
- The user's original topic is authoritative: ${scope.topic}
- Selected focus: ${scope.focus.join(' / ') || 'not specified'}
- Accept sources that help map the field landscape: representative papers, recent trends, main method families, web/practice signals, metrics, limitations, or open questions.
- Reject sources from unrelated domains even if they match generic words such as agent, synthesis, evidence, stability, limitation, or framework.
- Do not require PDF/full text. Abstract-level paper evidence is enough for a preliminary landscape brief.
- Web sources can support industry/practice/project/standard/trend insights if topic-relevant.
- relevanceScore must be between 0 and 1. Accept only if score >= ${MIN_RELEVANCE}.
- evidenceSnippet must be a short faithful excerpt or abstract summary from the source text.
- Assign each accepted source to one or more open gap ids.
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
        max_tokens: 2800,
      }),
    });
    if (!res.ok) return fallbackGate(scope, graph, sources, plannedQueries, `LLM landscape gate request failed with HTTP ${res.status}.`, 'http_error', true);
    const data = await res.json();
    const parsed = parseJsonObject(data.choices?.[0]?.message?.content || '');
    if (!parsed) return fallbackGate(scope, graph, sources, plannedQueries, 'LLM landscape gate did not return parseable JSON.', 'invalid_json', true);
    const normalized = normalizeGateResult(parsed, sources);
    return normalized || fallbackGate(scope, graph, sources, plannedQueries, 'LLM landscape gate returned JSON that did not match the expected schema.', 'invalid_schema', true);
  } catch (err: any) {
    return fallbackGate(scope, graph, sources, plannedQueries, `LLM landscape gate failed: ${err?.message || 'unknown error'}.`, 'exception', true);
  }
}
