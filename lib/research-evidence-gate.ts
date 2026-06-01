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

const MIN_RELEVANCE = 0.55;
const NODE_TYPES = ['Paper', 'Method', 'Component', 'GraphSchema', 'Claim', 'Evidence', 'Metric', 'Dataset', 'OpenSourceProject', 'Limitation'];

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
  return Array.from(new Set(
    String(text || '')
      .toLowerCase()
      .replace(/["'“”‘’()（）【】[\]{}]/g, ' ')
      .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
      .flatMap(part => {
        const trimmed = part.trim();
        if (!trimmed) return [];
        if (/^[\u4e00-\u9fa5]+$/.test(trimmed) && trimmed.length > 2) {
          return [trimmed, ...Array.from({ length: trimmed.length - 1 }, (_, i) => trimmed.slice(i, i + 2))];
        }
        return trimmed.length > 1 ? [trimmed] : [];
      })
      .filter(term => term.length > 1)
  ));
}

function lexicalRelevance(source: ResearchSource, scope: ResearchScope) {
  const topicTerms = tokenize(`${scope.topic} ${scope.focus.join(' ')}`);
  const haystack = sourceText(source, 3000).toLowerCase();
  if (topicTerms.length === 0) return 0;
  const hits = topicTerms.filter(term => haystack.includes(term)).length;
  return hits / Math.min(topicTerms.length, 8);
}

function fallbackGate(scope: ResearchScope, graph: ResearchGraphTemplate, sources: ResearchSource[]): EvidenceGateResult {
  const openGaps = getOpenGaps(graph, 5);
  const accepted: AcceptedResearchEvidence[] = [];
  const rejected: RejectedResearchSource[] = [];

  for (const source of sources) {
    const relevance = lexicalRelevance(source, scope);
    const hasContent = Boolean((source.snippet || source.fullTextExcerpt || '').trim());
    const threshold = source.type === 'paper' ? 0.16 : source.sourceProvider === 'github' ? 0.32 : 0.24;
    if (!hasContent || relevance < threshold) {
      rejected.push({
        sourceId: source.id,
        reason: hasContent ? '主题词重合不足，规则 gate 拒绝。' : '缺少摘要或正文，规则 gate 拒绝。',
      });
      continue;
    }

    const gapIds = openGaps.slice(0, source.type === 'paper' ? 2 : 1).map(gap => gap.id);
    accepted.push({
      sourceId: source.id,
      relevanceScore: Math.max(MIN_RELEVANCE, Math.min(0.85, 0.55 + relevance)),
      gapIds,
      claim: source.type === 'paper'
        ? `论文「${source.title}」提供了与「${scope.topic}」相关的研究证据。`
        : `来源「${source.title}」包含与「${scope.topic}」相关的信息。`,
      evidenceSnippet: (source.fullTextExcerpt || source.snippet || source.title).slice(0, 1200),
      nodeTypes: source.type === 'paper' ? ['Paper', 'Claim', 'Evidence'] : ['Claim', 'Evidence'],
      reason: 'LLM gate 不可用，使用规则 fallback 通过。',
    });
  }

  return { accepted, rejected, fallback: true };
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
    return fallbackGate(scope, graph, sources);
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

  const prompt = `You are a strict evidence gate for a research assistant.
Return only JSON:
{"accepted":[{"sourceId":"...","relevanceScore":0.0,"gapIds":["..."],"claim":"...","evidenceSnippet":"...","nodeTypes":["Paper","Method","Claim","Evidence","Metric","Dataset","Limitation","OpenSourceProject"],"reason":"..."}],"rejected":[{"sourceId":"...","reason":"..."}]}

Rules:
- The user's original topic is authoritative: ${scope.topic}
- Selected focus: ${scope.focus.join(' / ') || 'not specified'}
- Accept only sources directly relevant to the topic. Reject sources from unrelated domains even if they match generic words.
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
    if (!res.ok) return fallbackGate(scope, graph, sources);
    const data = await res.json();
    const parsed = parseJsonObject(data.choices?.[0]?.message?.content || '');
    const normalized = normalizeGateResult(parsed, sources);
    return normalized || fallbackGate(scope, graph, sources);
  } catch {
    return fallbackGate(scope, graph, sources);
  }
}
