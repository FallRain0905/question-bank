import type {
  AcceptedResearchEvidence,
  ResearchDirectionCard,
  ResearchEvidence,
  ResearchGap,
  ResearchGraphNode,
  ResearchGraphTemplate,
  ResearchHyperedge,
  ResearchOutputType,
  ResearchRound,
  ResearchScope,
  ResearchSessionDepth,
  ResearchSource,
  ResearchSourcePreference,
} from '@/types';
import type { ResearchDepth, ResearchMode } from '@/lib/research-retrieval';

const NODE_TYPES = [
  'Problem',
  'TopicCluster',
  'Method',
  'ApplicationArea',
  'Metric',
  'Trend',
  'RepresentativePaper',
  'WebInsight',
  'Limitation',
  'OpenQuestion',
  'OpenSourceProject',
  'Evidence',
];

const HYPEREDGE_TYPES = [
  'PAPER_SUPPORTS_TREND',
  'WEB_SUPPORTS_TREND',
  'METHOD_USED_IN_AREA',
  'METHOD_EVALUATED_BY_METRIC',
  'TREND_HAS_LIMITATION',
  'SOURCE_SUPPORTS_INSIGHT',
];

export const DEFAULT_DIRECTIONS: ResearchDirectionCard[] = [
  {
    id: 'landscape',
    title: '领域概览',
    description: '快速建立主题边界、核心概念、主要方向和推荐入口。',
    recommended: false,
    graphFocus: ['TopicCluster', 'Trend', 'RepresentativePaper', 'WebInsight'],
    sourceHints: ['papers', 'web'],
  },
  {
    id: 'methods',
    title: '主流方法',
    description: '梳理当前常见方法、技术路线、机制和适用场景。',
    recommended: false,
    graphFocus: ['Method', 'ApplicationArea', 'Metric'],
    sourceHints: ['papers', 'web'],
  },
  {
    id: 'recent_trends',
    title: '近期趋势',
    description: '关注最近几年升温的方向、热点问题和新兴路线。',
    recommended: false,
    graphFocus: ['Trend', 'RepresentativePaper', 'WebInsight'],
    sourceHints: ['papers', 'web'],
  },
  {
    id: 'papers',
    title: '代表论文',
    description: '找出摘要级即可判断价值的代表论文、综述和高引用入口。',
    recommended: false,
    graphFocus: ['RepresentativePaper', 'Method', 'Trend'],
    sourceHints: ['papers'],
  },
  {
    id: 'practice',
    title: 'Web/产业动态',
    description: '补充技术博客、机构报告、标准、项目文档和实践信号。',
    recommended: false,
    graphFocus: ['WebInsight', 'ApplicationArea', 'OpenSourceProject'],
    sourceHints: ['web', 'github'],
  },
  {
    id: 'limits',
    title: '指标与限制',
    description: '关注常见评价指标、瓶颈、风险、成本和开放问题。',
    recommended: false,
    graphFocus: ['Metric', 'Limitation', 'OpenQuestion'],
    sourceHints: ['papers', 'web'],
  },
];

export const CLARIFICATION_QUESTIONS = [
  {
    id: 'focus',
    question: '这次研究优先建立哪部分认知框架？',
    type: 'multi_choice',
    options: ['领域概览', '主流方法', '近期趋势', '代表论文', 'Web/产业动态', '指标与限制'],
  },
  {
    id: 'output',
    question: '最终输出更接近哪一种？',
    type: 'single_choice',
    options: ['领域认知简报', '技术路线图', '对比表', '深入阅读清单'],
  },
  {
    id: 'sources',
    question: '信息源优先级是什么？',
    type: 'multi_choice',
    options: ['论文源', 'Web', 'GitHub', '本地知识库'],
  },
];

function safeId(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function topicMatches(topic: string, patterns: RegExp[]) {
  return patterns.some(pattern => pattern.test(topic));
}

function hasFocus(focus: string[], labels: string[]) {
  return focus.some(item => labels.some(label => item === label || item.includes(label)));
}

function needsOpenSource(topic: string, focus: string[]) {
  return hasFocus(focus, ['Web/产业动态', '开源实现']) || topicMatches(topic, [/github|开源|repo|代码|实现|project/i]);
}

function needsMetrics(topic: string, focus: string[]) {
  return hasFocus(focus, ['指标与限制']) || topicMatches(topic, [/指标|评估|评价|性能|benchmark|metric|limitation|challenge/i]);
}

export function normalizeResearchSessionDepth(depth: unknown): ResearchSessionDepth {
  return depth === 'fast' || depth === 'deep' || depth === 'standard' ? depth : 'standard';
}

export function researchDepthToRetrievalDepth(depth: ResearchSessionDepth): ResearchDepth {
  if (depth === 'fast') return 'fast';
  if (depth === 'deep') return 'deep';
  return 'medium';
}

export function sourcePrefsToMode(sources: ResearchSourcePreference[]): ResearchMode {
  const academic = sources.includes('papers') || sources.includes('local_kb');
  const web = sources.includes('web') || sources.includes('github');
  if (academic && web) return 'both';
  if (academic) return 'academic';
  return 'general';
}

export function getDirectionCards(topic: string, sourceCount = 0): ResearchDirectionCard[] {
  const lower = topic.toLowerCase();
  const broadDomain = !topicMatches(lower, [/系统架构|论文图|知识图谱|超图|agent|github|开源|评估|benchmark|metric/i]);
  const asksPractice = needsOpenSource(lower, []);
  const asksMetrics = needsMetrics(lower, []);

  return DEFAULT_DIRECTIONS.map(card => ({
    ...card,
    recommended:
      card.recommended ||
      (card.id === 'landscape' && (broadDomain || sourceCount > 0)) ||
      (card.id === 'methods' && broadDomain) ||
      (card.id === 'recent_trends' && broadDomain) ||
      (card.id === 'practice' && asksPractice) ||
      (card.id === 'limits' && asksMetrics) ||
      (card.id === 'papers' && topicMatches(lower, [/论文|文献|paper|literature|survey|review/i])),
  }));
}

export function buildResearchScope(topic: string, patch?: Partial<ResearchScope>): ResearchScope {
  const focus = patch?.focus?.length
    ? patch.focus
    : getDirectionCards(topic).filter(card => card.recommended).map(card => card.title);
  const sources = patch?.sources?.length
    ? patch.sources
    : unique(
        DEFAULT_DIRECTIONS
          .filter(card => card.recommended || focus.includes(card.title))
          .flatMap(card => card.sourceHints)
      );

  return {
    topic,
    focus,
    sources: sources.length ? sources : ['papers', 'web'],
    outputType: patch?.outputType || 'technical_report',
    timeRange: patch?.timeRange || 'recent_3_years',
    depth: normalizeResearchSessionDepth(patch?.depth),
    constraints: patch?.constraints || [
      '只生成领域认知简报，不写完整综述',
      '论文只使用摘要和元数据，Web 来源用于补充趋势和实践信号',
    ],
  };
}

function gap(
  id: string,
  label: string,
  reason: string,
  targetNodeTypes: string[],
  suggestedQueries: string[],
  preferredSources: ResearchSourcePreference[],
  priority: ResearchGap['priority'] = 'high'
): ResearchGap {
  return { id, label, reason, priority, targetNodeTypes, suggestedQueries, preferredSources, status: 'open' };
}

function topicQuery(topic: string, suffix: string) {
  return `"${topic}" ${suffix}`;
}

export function buildGraphTemplate(scope: ResearchScope): ResearchGraphTemplate {
  const includeOpenSource = needsOpenSource(scope.topic, scope.focus) || scope.sources.includes('github');
  const includeMetrics = needsMetrics(scope.topic, scope.focus);
  const nodes: ResearchGraphNode[] = [
    {
      id: `problem-${safeId(scope.topic)}`,
      type: 'Problem',
      label: scope.topic,
      status: 'seed',
      metadata: { focus: scope.focus, outputType: scope.outputType, graphKind: 'research_landscape' },
    },
  ];

  const requiredSlots = unique([
    '领域概览',
    '近期趋势',
    '主流方法',
    '代表论文',
    'Web/实践信号',
    includeMetrics ? '评价指标' : '常见判断维度',
    '限制与开放问题',
    ...(includeOpenSource ? ['开源/项目动态'] : []),
  ]);

  const gaps: ResearchGap[] = [
    gap(
      'gap-landscape',
      '领域概览不足',
      '需要形成该领域的大方向、核心问题和快速入口。',
      ['TopicCluster', 'Trend', 'RepresentativePaper', 'WebInsight'],
      [
        topicQuery(scope.topic, 'overview landscape main directions'),
        topicQuery(scope.topic, 'review recent advances field overview'),
      ],
      ['papers', 'web'],
      'high'
    ),
    gap(
      'gap-trends',
      '近期趋势不足',
      '需要识别最近几年升温的研究热点、产业信号和新兴方法。',
      ['Trend', 'RepresentativePaper', 'WebInsight'],
      [
        topicQuery(scope.topic, 'recent progress emerging trends'),
        topicQuery(scope.topic, '2024 2025 advances industry report'),
      ],
      ['papers', 'web'],
      'high'
    ),
    gap(
      'gap-methods',
      '主流方法分类不足',
      '需要补齐该领域常见方法、技术路线、机制和适用场景。',
      ['Method', 'ApplicationArea', 'Metric'],
      [
        topicQuery(scope.topic, 'methods taxonomy mechanism applications'),
        topicQuery(scope.topic, 'technical routes performance comparison'),
      ],
      ['papers', 'web', 'local_kb'],
      'high'
    ),
    gap(
      'gap-papers',
      '代表论文不足',
      '需要摘要级代表论文、综述、高引用或近期入口论文来支撑认知地图。',
      ['RepresentativePaper', 'Method', 'Trend'],
      [
        topicQuery(scope.topic, 'representative papers review survey'),
        topicQuery(scope.topic, 'highly cited recent papers methods'),
      ],
      ['papers'],
      'medium'
    ),
    gap(
      'gap-web',
      'Web 实践信号不足',
      '需要 Web 来源补充产业动态、报告、标准、项目文档或实践经验。',
      ['WebInsight', 'ApplicationArea', 'OpenSourceProject'],
      [
        topicQuery(scope.topic, 'industry practice report standard'),
        topicQuery(scope.topic, 'technical blog project documentation'),
      ],
      includeOpenSource ? ['web', 'github'] : ['web'],
      'medium'
    ),
    gap(
      'gap-limits',
      '指标与限制不足',
      '需要补齐评价指标、瓶颈、风险、成本和开放问题。',
      ['Metric', 'Limitation', 'OpenQuestion'],
      [
        topicQuery(scope.topic, 'metrics benchmark limitations challenges'),
        topicQuery(scope.topic, 'open questions bottlenecks future directions'),
      ],
      ['papers', 'web'],
      'medium'
    ),
  ];

  return {
    nodeTypes: NODE_TYPES,
    hyperedgeTypes: HYPEREDGE_TYPES,
    requiredSlots,
    nodes,
    edges: [],
    gaps,
    nextSearchTasks: gaps.slice(0, 3).flatMap(item => item.suggestedQueries.slice(0, 1)),
    rounds: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getOpenGaps(graph: ResearchGraphTemplate, limit = 3) {
  return graph.gaps
    .filter(gapItem => gapItem.status !== 'filled')
    .sort((a, b) => {
      const rank = { high: 3, medium: 2, low: 1 };
      return rank[b.priority] - rank[a.priority];
    })
    .slice(0, limit);
}

export function buildSearchQueryFromGraph(scope: ResearchScope, graph: ResearchGraphTemplate) {
  const gapQueries = getOpenGaps(graph, scope.depth === 'deep' ? 5 : 4)
    .flatMap(item => item.suggestedQueries)
    .slice(0, scope.depth === 'fast' ? 2 : scope.depth === 'deep' ? 8 : 5);
  return unique([scope.topic, ...gapQueries]).join(' ');
}

function sourceNodeType(source: ResearchSource, evidence?: AcceptedResearchEvidence) {
  if (source.sourceProvider === 'github' || evidence?.nodeTypes?.includes('OpenSourceProject')) return 'OpenSourceProject';
  if (source.type === 'paper') return 'RepresentativePaper';
  return 'WebInsight';
}

function insightNodeType(evidence: AcceptedResearchEvidence) {
  if (evidence.insightType === 'method') return 'Method';
  if (evidence.insightType === 'application') return 'ApplicationArea';
  if (evidence.insightType === 'metric') return 'Metric';
  if (evidence.insightType === 'limitation') return 'Limitation';
  if (evidence.insightType === 'open_question') return 'OpenQuestion';
  return 'Trend';
}

function sanitizeNodeTypes(types: string[], source: ResearchSource, evidence: AcceptedResearchEvidence) {
  const allowed = new Set(NODE_TYPES);
  const nodes = types.filter(type => allowed.has(type));
  const sourceType = sourceNodeType(source, evidence);
  if (!nodes.includes(sourceType)) nodes.unshift(sourceType);
  const insightType = insightNodeType(evidence);
  if (!nodes.includes(insightType)) nodes.push(insightType);
  if (!nodes.includes('Evidence')) nodes.push('Evidence');
  return unique(nodes).slice(0, 6);
}

function edgeTypeFor(source: ResearchSource, evidence: AcceptedResearchEvidence) {
  if (evidence.insightType === 'method') return 'METHOD_USED_IN_AREA';
  if (evidence.insightType === 'metric') return 'METHOD_EVALUATED_BY_METRIC';
  if (evidence.insightType === 'limitation' || evidence.insightType === 'open_question') return 'TREND_HAS_LIMITATION';
  if (source.type === 'paper') return 'PAPER_SUPPORTS_TREND';
  if (source.type === 'web') return 'WEB_SUPPORTS_TREND';
  return 'SOURCE_SUPPORTS_INSIGHT';
}

export function applySourcesToGraph(
  scope: ResearchScope,
  graph: ResearchGraphTemplate,
  sources: ResearchSource[],
  acceptedEvidence: AcceptedResearchEvidence[]
) {
  const nextGraph: ResearchGraphTemplate = {
    ...graph,
    nodes: [...graph.nodes],
    edges: [...graph.edges],
    gaps: [...graph.gaps],
    rounds: [...(graph.rounds || [])],
    updatedAt: new Date().toISOString(),
  };

  const sourceMap = new Map(sources.map(source => [source.id, source]));
  const evidenceInserts = acceptedEvidence.slice(0, scope.depth === 'deep' ? 24 : 16).flatMap(evidence => {
    const source = sourceMap.get(evidence.sourceId);
    if (!source) return [];

    const nodeTypes = sanitizeNodeTypes(evidence.nodeTypes || [], source, evidence);
    const sourceType = sourceNodeType(source, evidence);
    const sourceNodeId = `${sourceType.toLowerCase()}-${safeId(source.id || source.title)}`;
    const trendLabel = evidence.trendCluster || source.perspective || evidence.insightType || scope.topic;
    const trendNodeId = `trend-${safeId(trendLabel)}`;
    const evidenceNodeId = `evidence-${safeId(source.id || source.title)}`;
    const insightNodeId = `${insightNodeType(evidence).toLowerCase()}-${safeId(evidence.claim || source.title)}-${safeId(source.id).slice(0, 12)}`;

    const nodesToAdd: ResearchGraphNode[] = [
      {
        id: sourceNodeId,
        type: sourceType,
        label: source.title,
        status: 'filled',
        metadata: {
          url: source.url,
          provider: source.sourceProvider,
          sourceKind: source.sourceKind,
          year: source.year,
          venue: source.venue,
          citationCount: source.citationCount,
          authors: source.authors,
          doi: source.doi,
          gapIds: evidence.gapIds,
          relevanceScore: evidence.relevanceScore,
          insightType: evidence.insightType,
        },
      },
      {
        id: trendNodeId,
        type: 'Trend',
        label: trendLabel,
        status: 'partial',
        metadata: { gapIds: evidence.gapIds, insightType: evidence.insightType },
      },
      {
        id: evidenceNodeId,
        type: 'Evidence',
        label: evidence.evidenceSnippet.slice(0, 80),
        status: 'filled',
        metadata: { sourceId: source.id, url: source.url, gapIds: evidence.gapIds },
      },
      {
        id: insightNodeId,
        type: insightNodeType(evidence),
        label: evidence.claim.slice(0, 100),
        status: 'partial',
        metadata: {
          sourceId: source.id,
          gapIds: evidence.gapIds,
          methodTags: evidence.methodTags || [],
          applicationTags: evidence.applicationTags || [],
          metricTags: evidence.metricTags || [],
        },
      },
    ];

    for (const node of nodesToAdd) {
      if (!nextGraph.nodes.some(existing => existing.id === node.id)) nextGraph.nodes.push(node);
    }

    const edge: ResearchHyperedge = {
      id: `edge-${safeId(source.id || source.title)}-${safeId(evidence.gapIds.join('-'))}`,
      type: edgeTypeFor(source, evidence),
      label: '来源支撑领域洞察',
      nodeIds: [sourceNodeId, trendNodeId, insightNodeId, evidenceNodeId],
      evidenceIds: [source.id],
      confidence: evidence.relevanceScore,
      metadata: {
        provider: source.sourceProvider,
        sourceType: source.type,
        sourceKind: source.sourceKind,
        query: source.query,
        gapIds: evidence.gapIds,
        relevanceScore: evidence.relevanceScore,
        reason: evidence.reason,
        insightType: evidence.insightType,
        trendCluster: evidence.trendCluster,
        nodeTypes,
      },
    };
    if (!nextGraph.edges.some(existing => existing.id === edge.id)) nextGraph.edges.push(edge);

    return [{
      source_id: source.id,
      claim: evidence.claim,
      snippet: evidence.evidenceSnippet.slice(0, 1200),
      node_refs: nodesToAdd.map(node => node.id),
      edge_refs: [edge.id],
      confidence: evidence.relevanceScore,
      metadata: {
        title: source.title,
        url: source.url,
        type: source.type,
        provider: source.sourceProvider,
        sourceKind: source.sourceKind,
        year: source.year,
        venue: source.venue,
        citationCount: source.citationCount,
        authors: source.authors,
        doi: source.doi,
        query: source.query,
        perspective: source.perspective,
        relevanceScore: evidence.relevanceScore,
        gapIds: evidence.gapIds,
        nodeTypes,
        insightType: evidence.insightType,
        trendCluster: evidence.trendCluster,
        methodTags: evidence.methodTags || [],
        applicationTags: evidence.applicationTags || [],
        metricTags: evidence.metricTags || [],
        gateReason: evidence.reason,
      },
    }];
  });

  nextGraph.gaps = evaluateGaps(scope, nextGraph);
  nextGraph.nextSearchTasks = nextGraph.gaps
    .filter(item => item.status !== 'filled')
    .flatMap(item => item.suggestedQueries.slice(0, 1))
    .slice(0, 6);

  return { graph: nextGraph, evidenceInserts };
}

export function evaluateGaps(_scope: ResearchScope, graph: ResearchGraphTemplate): ResearchGap[] {
  return graph.gaps.map(gapItem => {
    const relatedEdges = graph.edges.filter(edge => {
      const gapIds = Array.isArray(edge.metadata?.gapIds) ? edge.metadata.gapIds : [];
      return gapIds.includes(gapItem.id);
    });
    const sourceTypes = new Set(relatedEdges.map(edge => String(edge.metadata?.sourceType || '')));
    const insightTypes = new Set(relatedEdges.map(edge => String(edge.metadata?.insightType || '')));
    const scores = relatedEdges.map(edge => Number(edge.metadata?.relevanceScore || edge.confidence || 0)).filter(Boolean);
    const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
    const hasSourceMix = sourceTypes.has('paper') && sourceTypes.has('web');
    const coverage =
      relatedEdges.length +
      Math.min(2, insightTypes.size) +
      (hasSourceMix ? 1 : 0) +
      (average >= 0.65 ? 1 : 0);
    const status: ResearchGap['status'] =
      coverage >= 5 ? 'filled' :
      coverage >= 2 ? 'partial' :
      'open';
    return { ...gapItem, status };
  });
}

export function buildResearchRound(
  graph: ResearchGraphTemplate,
  query: string,
  sourcesAdded: number,
  evidenceAdded: number
): ResearchRound {
  const index = (graph.rounds || []).length + 1;
  return {
    id: `round-${index}-${Date.now()}`,
    index,
    status: 'completed',
    query,
    searchTasks: graph.nextSearchTasks || [],
    sourcesAdded,
    evidenceAdded,
    gapsOpen: graph.gaps.filter(item => item.status !== 'filled').length,
    createdAt: new Date().toISOString(),
  };
}

export function evidenceRowsToTyped(rows: any[]): ResearchEvidence[] {
  return (rows || []).map(row => ({
    id: row.id,
    session_id: row.session_id,
    source_id: row.source_id,
    claim: row.claim,
    snippet: row.snippet,
    node_refs: row.node_refs || [],
    edge_refs: row.edge_refs || [],
    confidence: Number(row.confidence || 0),
    metadata: row.metadata || {},
    created_at: row.created_at,
  }));
}

export function outputTypeLabel(outputType: ResearchOutputType) {
  const labels: Record<ResearchOutputType, string> = {
    concise_answer: '简短回答',
    technical_report: '领域认知简报',
    literature_review: '文献入口地图',
    system_design: '技术路线图',
    comparison_table: '对比表',
  };
  return labels[outputType];
}
