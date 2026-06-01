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
  'Paper',
  'Method',
  'Component',
  'GraphSchema',
  'Claim',
  'Evidence',
  'Metric',
  'Dataset',
  'OpenSourceProject',
  'Limitation',
  'ResearchGap',
];

const HYPEREDGE_TYPES = [
  'PAPER_PROPOSES_METHOD',
  'METHOD_HAS_COMPONENT',
  'CLAIM_SUPPORTED_BY_EVIDENCE',
  'METHOD_EVALUATED_BY_METRIC',
  'GRAPH_SCHEMA_SUPPORTS_TASK',
  'PROJECT_IMPLEMENTS_METHOD',
  'METHOD_HAS_LIMITATION',
  'EVIDENCE_FILLS_GAP',
];

export const DEFAULT_DIRECTIONS: ResearchDirectionCard[] = [
  {
    id: 'theory',
    title: '理论基础',
    description: '梳理概念来源、关键定义、理论机制和基础综述。',
    recommended: false,
    graphFocus: ['Problem', 'Method', 'Claim', 'Evidence'],
    sourceHints: ['papers', 'web'],
  },
  {
    id: 'architecture',
    title: '系统架构',
    description: '研究系统组件、数据流、Agent 流程和工程实现。',
    recommended: false,
    graphFocus: ['Method', 'Component', 'OpenSourceProject', 'Limitation'],
    sourceHints: ['papers', 'github', 'web'],
  },
  {
    id: 'paper_graph',
    title: '论文图结构',
    description: '聚焦论文语料如何建模为图、超图或证据结构。',
    recommended: false,
    graphFocus: ['GraphSchema', 'Paper', 'Evidence', 'Metric'],
    sourceHints: ['papers', 'local_kb'],
  },
  {
    id: 'evaluation',
    title: '实验评估',
    description: '关注数据集、指标、baseline、实验结论和复现实验。',
    recommended: false,
    graphFocus: ['Dataset', 'Metric', 'Claim', 'Limitation'],
    sourceHints: ['papers'],
  },
  {
    id: 'open_source',
    title: '开源实现',
    description: '检索可参考项目、许可证、活跃度和工程取舍。',
    recommended: false,
    graphFocus: ['OpenSourceProject', 'Component', 'Method', 'Limitation'],
    sourceHints: ['github', 'web'],
  },
  {
    id: 'application',
    title: '领域应用',
    description: '关注科研、化工、医学、能源等场景中的价值和约束。',
    recommended: false,
    graphFocus: ['Problem', 'Paper', 'Claim', 'ResearchGap'],
    sourceHints: ['papers', 'web', 'local_kb'],
  },
];

export const CLARIFICATION_QUESTIONS = [
  {
    id: 'focus',
    question: '这次研究优先解决什么问题？',
    type: 'multi_choice',
    options: ['系统架构', '论文图结构', '理论基础', '实验评估', '开源实现'],
  },
  {
    id: 'output',
    question: '最终输出更接近哪一种？',
    type: 'single_choice',
    options: ['技术方案', '文献综述', '简洁回答', '对比表'],
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

function hasFocus(focus: string[], label: string) {
  return focus.some(item => item === label || item.includes(label));
}

function needsArchitecture(topic: string, focus: string[]) {
  return hasFocus(focus, '系统架构') || topicMatches(topic, [/系统|架构|平台|agent|workflow|pipeline|implementation|实现|工程/i]);
}

function needsPaperGraph(topic: string, focus: string[]) {
  return hasFocus(focus, '论文图结构') || topicMatches(topic, [/论文语料|文献图|知识图谱|图结构|超图|hypergraph|graph schema|graph rag|hyper-rag/i]);
}

function needsEvaluation(topic: string, focus: string[]) {
  return hasFocus(focus, '实验评估') || topicMatches(topic, [/评估|实验|benchmark|metric|指标|性能|对比|评价/i]);
}

function needsOpenSource(topic: string, focus: string[]) {
  return hasFocus(focus, '开源实现') || topicMatches(topic, [/github|开源|repo|代码|实现/i]);
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
  const asksArchitecture = needsArchitecture(lower, []);
  const asksPaperGraph = needsPaperGraph(lower, []);
  const asksEvaluation = needsEvaluation(lower, []);
  const asksOpenSource = needsOpenSource(lower, []);
  const asksTheory = topicMatches(lower, [/理论|基础|定义|concept|机制|原理|what is/i]);
  const broadDomain = !asksArchitecture && !asksPaperGraph && !asksEvaluation && !asksOpenSource;

  return DEFAULT_DIRECTIONS.map(card => ({
    ...card,
    recommended:
      card.recommended ||
      (card.id === 'architecture' && asksArchitecture) ||
      (card.id === 'paper_graph' && asksPaperGraph) ||
      (card.id === 'open_source' && asksOpenSource) ||
      (card.id === 'evaluation' && asksEvaluation) ||
      (card.id === 'theory' && (asksTheory || broadDomain)) ||
      (card.id === 'application' && broadDomain) ||
      (sourceCount > 0 && card.id === 'evaluation' && asksEvaluation),
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
    sources: sources.length ? sources : ['papers', 'web', 'github', 'local_kb'],
    outputType: patch?.outputType || 'technical_report',
    timeRange: patch?.timeRange || 'recent_3_years',
    depth: normalizeResearchSessionDepth(patch?.depth),
    constraints: patch?.constraints || ['优先保留可引用证据', '每轮检索都服务于补全研究图谱缺口'],
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
  const includeArchitecture = needsArchitecture(scope.topic, scope.focus);
  const includePaperGraph = needsPaperGraph(scope.topic, scope.focus);
  const includeEvaluation = needsEvaluation(scope.topic, scope.focus);
  const includeOpenSource = needsOpenSource(scope.topic, scope.focus) || scope.sources.includes('github');
  const nodes: ResearchGraphNode[] = [
    {
      id: `problem-${safeId(scope.topic)}`,
      type: 'Problem',
      label: scope.topic,
      status: 'seed',
      metadata: { focus: scope.focus, outputType: scope.outputType },
    },
  ];

  const requiredSlots = unique([
    '代表性论文',
    '核心方法',
    '证据链',
    ...(includePaperGraph ? ['论文图结构设计'] : ['技术路线', '应用场景']),
    ...(includeArchitecture ? ['系统组件', '工程实现'] : []),
    ...(includeEvaluation ? ['评价指标', '数据集'] : []),
    ...(includeOpenSource ? ['开源项目'] : []),
    '局限性',
  ]);

  const gaps: ResearchGap[] = [
    gap(
      'gap-papers',
      '代表性论文不足',
      '需要补齐综述、代表性论文和方法来源。',
      ['Paper', 'Method'],
      [
        topicQuery(scope.topic, 'review synthesis applications'),
        topicQuery(scope.topic, 'representative papers methods advances'),
      ],
      ['papers'],
      'high'
    ),
    gap(
      'gap-methods',
      '核心技术路线不足',
      '需要补齐该主题下的主要方法、机制、适用场景和代表性证据。',
      ['Method', 'Claim', 'Evidence'],
      [
        topicQuery(scope.topic, 'synthesis methods structure property relationship'),
        topicQuery(scope.topic, 'mechanism applications performance evidence'),
      ],
      ['papers', 'web', 'local_kb'],
      'high'
    ),
  ];

  if (includePaperGraph) {
    gaps.push(gap(
      'gap-graph-schema',
      '论文图结构证据不足',
      '需要明确 Paper / Method / Evidence / GraphSchema 如何连接。',
      ['GraphSchema', 'Evidence'],
      [
        topicQuery(scope.topic, 'paper corpus graph schema evidence graph'),
        topicQuery(scope.topic, 'scientific literature graph representation extraction'),
      ],
      ['papers', 'web', 'local_kb'],
      'high'
    ));
  }

  if (includeArchitecture) {
    gaps.push(gap(
      'gap-architecture',
      '系统架构组件不足',
      '需要补齐组件、数据流、Agent 流程和工程实现。',
      ['Component', 'Method', 'OpenSourceProject'],
      [
        topicQuery(scope.topic, 'system architecture implementation pipeline'),
        topicQuery(scope.topic, 'open source implementation engineering workflow'),
      ],
      ['web', 'github'],
      'high'
    ));
  }

  if (includeEvaluation) {
    gaps.push(gap(
      'gap-evaluation',
      '评价指标和局限性不足',
      '需要补齐 metric、benchmark、dataset、limitation。',
      ['Metric', 'Dataset', 'Limitation'],
      [
        topicQuery(scope.topic, 'characterization BET adsorption stability performance metrics'),
        topicQuery(scope.topic, 'database benchmark dataset evaluation limitation'),
      ],
      ['papers', 'web'],
      'medium'
    ));
  } else {
    gaps.push(gap(
      'gap-limitations',
      '局限性和适用边界不足',
      '需要补齐当前方法的限制、成本、风险和适用条件。',
      ['Limitation', 'Evidence'],
      [
        topicQuery(scope.topic, 'limitations challenges stability scalability'),
        topicQuery(scope.topic, 'comparison tradeoffs barriers future directions'),
      ],
      ['papers', 'web'],
      'medium'
    ));
  }

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
  const gapQueries = getOpenGaps(graph, scope.depth === 'deep' ? 4 : 3)
    .flatMap(item => item.suggestedQueries)
    .slice(0, scope.depth === 'fast' ? 2 : scope.depth === 'deep' ? 6 : 4);
  return unique([scope.topic, ...gapQueries]).join(' ');
}

function sourceNodeType(source: ResearchSource, evidence?: AcceptedResearchEvidence) {
  if (evidence?.nodeTypes?.includes('OpenSourceProject')) return 'OpenSourceProject';
  if (source.sourceProvider === 'github') return 'OpenSourceProject';
  if (evidence?.nodeTypes?.includes('Paper')) return 'Paper';
  if (source.type === 'paper') return 'Paper';
  return 'Evidence';
}

function sanitizeNodeTypes(types: string[], source: ResearchSource) {
  const allowed = new Set(NODE_TYPES);
  const nodes = types.filter(type => allowed.has(type));
  if (source.type === 'paper' && !nodes.includes('Paper')) nodes.unshift('Paper');
  if (source.sourceProvider === 'github' && !nodes.includes('OpenSourceProject')) nodes.unshift('OpenSourceProject');
  if (!nodes.includes('Claim')) nodes.push('Claim');
  if (!nodes.includes('Evidence')) nodes.push('Evidence');
  return unique(nodes).slice(0, 5);
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
  const evidenceInserts = acceptedEvidence.slice(0, scope.depth === 'deep' ? 18 : 12).flatMap(evidence => {
    const source = sourceMap.get(evidence.sourceId);
    if (!source) return [];

    const nodeTypes = sanitizeNodeTypes(evidence.nodeTypes || [], source);
    const sourceNodeId = `${sourceNodeType(source, evidence).toLowerCase()}-${safeId(source.id || source.title)}`;
    const evidenceNodeId = `evidence-${safeId(source.id || source.title)}`;
    const claimNodeId = `claim-${safeId(evidence.claim || source.title)}`;

    const nodesToAdd: ResearchGraphNode[] = [
      {
        id: sourceNodeId,
        type: sourceNodeType(source, evidence),
        label: source.title,
        status: 'filled',
        metadata: {
          url: source.url,
          provider: source.sourceProvider,
          year: source.year,
          citationCount: source.citationCount,
          authors: source.authors,
          gapIds: evidence.gapIds,
          relevanceScore: evidence.relevanceScore,
        },
      },
      {
        id: evidenceNodeId,
        type: 'Evidence',
        label: evidence.evidenceSnippet.slice(0, 80),
        status: 'filled',
        metadata: { sourceId: source.id, url: source.url, gapIds: evidence.gapIds },
      },
      {
        id: claimNodeId,
        type: 'Claim',
        label: evidence.claim.slice(0, 100),
        status: 'filled',
        metadata: { sourceId: source.id, gapIds: evidence.gapIds },
      },
      ...nodeTypes
        .filter(type => !['Paper', 'OpenSourceProject', 'Evidence', 'Claim'].includes(type))
        .map(type => ({
          id: `${type.toLowerCase()}-${safeId(evidence.claim || source.title)}-${safeId(source.id).slice(0, 12)}`,
          type,
          label: evidence.claim.slice(0, 80),
          status: 'partial' as const,
          metadata: { sourceId: source.id, gapIds: evidence.gapIds },
        })),
    ];

    for (const node of nodesToAdd) {
      if (!nextGraph.nodes.some(existing => existing.id === node.id)) nextGraph.nodes.push(node);
    }

    const edge: ResearchHyperedge = {
      id: `edge-${safeId(source.id || source.title)}-${safeId(evidence.gapIds.join('-'))}`,
      type: 'CLAIM_SUPPORTED_BY_EVIDENCE',
      label: '证据支持结论',
      nodeIds: [claimNodeId, evidenceNodeId, sourceNodeId],
      evidenceIds: [source.id],
      confidence: evidence.relevanceScore,
      metadata: {
        provider: source.sourceProvider,
        query: source.query,
        gapIds: evidence.gapIds,
        relevanceScore: evidence.relevanceScore,
        reason: evidence.reason,
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
        year: source.year,
        venue: source.venue,
        citationCount: source.citationCount,
        authors: source.authors,
        query: source.query,
        perspective: source.perspective,
        relevanceScore: evidence.relevanceScore,
        gapIds: evidence.gapIds,
        nodeTypes,
        gateReason: evidence.reason,
      },
    }];
  });

  nextGraph.gaps = evaluateGaps(scope, nextGraph);
  nextGraph.nextSearchTasks = nextGraph.gaps
    .filter(item => item.status !== 'filled')
    .flatMap(item => item.suggestedQueries.slice(0, 1))
    .slice(0, 5);

  return { graph: nextGraph, evidenceInserts };
}

export function evaluateGaps(_scope: ResearchScope, graph: ResearchGraphTemplate): ResearchGap[] {
  return graph.gaps.map(gapItem => {
    const relatedEdges = graph.edges.filter(edge => {
      const gapIds = Array.isArray(edge.metadata?.gapIds) ? edge.metadata.gapIds : [];
      return gapIds.includes(gapItem.id);
    });
    const scores = relatedEdges.map(edge => Number(edge.metadata?.relevanceScore || edge.confidence || 0)).filter(Boolean);
    const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
    const status: ResearchGap['status'] =
      relatedEdges.length >= 2 && average >= 0.55 ? 'filled' :
      relatedEdges.length >= 1 ? 'partial' :
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
    concise_answer: '简洁回答',
    technical_report: '技术报告',
    literature_review: '文献综述',
    system_design: '系统设计方案',
    comparison_table: '对比表',
  };
  return labels[outputType];
}
