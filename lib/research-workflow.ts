import type {
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
    description: '梳理概念来源、关键定义和相关理论脉络。',
    recommended: false,
    graphFocus: ['Problem', 'Method', 'Claim', 'Evidence'],
    sourceHints: ['papers', 'web'],
  },
  {
    id: 'architecture',
    title: '系统架构',
    description: '重点研究系统组件、数据流、Agent 流程和工程实现。',
    recommended: true,
    graphFocus: ['Method', 'Component', 'OpenSourceProject', 'Limitation'],
    sourceHints: ['papers', 'github', 'web'],
  },
  {
    id: 'paper_graph',
    title: '论文图结构',
    description: '聚焦论文语料如何建模成图、超图或证据结构。',
    recommended: true,
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
    description: '关注科研文献、化工、医学等场景中的价值和约束。',
    recommended: false,
    graphFocus: ['Problem', 'Paper', 'Claim', 'ResearchGap'],
    sourceHints: ['papers', 'web', 'local_kb'],
  },
];

export const CLARIFICATION_QUESTIONS = [
  {
    id: 'focus',
    question: '你更希望这次研究优先解决什么？',
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
    options: ['论文源', 'Web', 'GitHub', '本地 HyperRAG'],
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
  return DEFAULT_DIRECTIONS.map(card => ({
    ...card,
    recommended:
      card.recommended ||
      (card.id === 'open_source' && /github|开源|repo|代码/.test(lower)) ||
      (card.id === 'evaluation' && /实验|评估|benchmark|metric/.test(lower)) ||
      (card.id === 'theory' && /理论|基础|定义|concept/.test(lower)) ||
      (sourceCount > 0 && card.id === 'paper_graph'),
  }));
}

export function buildResearchScope(topic: string, patch?: Partial<ResearchScope>): ResearchScope {
  const focus = patch?.focus?.length
    ? patch.focus
    : DEFAULT_DIRECTIONS.filter(card => card.recommended).map(card => card.title);
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

export function buildGraphTemplate(scope: ResearchScope): ResearchGraphTemplate {
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
    '论文图结构设计',
    '证据链',
    ...(scope.focus.includes('系统架构') ? ['系统组件', '工程实现'] : []),
    ...(scope.focus.includes('实验评估') ? ['评估指标', '数据集'] : []),
    ...(scope.sources.includes('github') ? ['开源项目'] : []),
    '局限性',
  ]);

  const gaps = [
    gap(
      'gap-papers',
      '代表性论文不足',
      '需要建立 Paper 节点和方法来源。',
      ['Paper', 'Method'],
      [`${scope.topic} survey recent papers`, `${scope.topic} method scientific literature`],
      ['papers'],
      'high'
    ),
    gap(
      'gap-graph-schema',
      '论文图结构证据不足',
      '需要明确 Paper / Method / Evidence / GraphSchema 如何连接。',
      ['GraphSchema', 'Evidence'],
      [`${scope.topic} graph schema paper corpus`, `${scope.topic} evidence graph scientific papers`],
      ['papers', 'web', 'local_kb'],
      'high'
    ),
    gap(
      'gap-architecture',
      '系统架构组件不足',
      '需要补齐组件、数据流和 Agent 流程。',
      ['Component', 'Method', 'OpenSourceProject'],
      [`${scope.topic} system architecture implementation`, `${scope.topic} open source implementation`],
      ['web', 'github'],
      scope.focus.includes('系统架构') ? 'high' : 'medium'
    ),
    gap(
      'gap-evaluation',
      '评估指标和局限性不足',
      '需要补齐 metric、benchmark、limitation。',
      ['Metric', 'Dataset', 'Limitation'],
      [`${scope.topic} evaluation metrics benchmark limitation`],
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
  const gapQueries = getOpenGaps(graph, scope.depth === 'deep' ? 4 : 3)
    .flatMap(item => item.suggestedQueries)
    .slice(0, scope.depth === 'fast' ? 2 : scope.depth === 'deep' ? 6 : 4);
  return unique([scope.topic, ...gapQueries]).join(' | ');
}

function nodeTypeForSource(source: ResearchSource) {
  if (source.sourceProvider === 'github') return 'OpenSourceProject';
  if (source.type === 'paper') return 'Paper';
  return 'Evidence';
}

function claimFromSource(source: ResearchSource, scope: ResearchScope) {
  const snippet = (source.fullTextExcerpt || source.snippet || '').replace(/\s+/g, ' ').trim();
  if (source.sourceProvider === 'github') return `开源项目 ${source.title} 可作为 ${scope.topic} 的实现参考。`;
  if (source.type === 'paper') return `论文 ${source.title} 提供了与 ${scope.topic} 相关的方法或证据。`;
  return snippet ? snippet.slice(0, 160) : `${source.title} 包含与 ${scope.topic} 相关的信息。`;
}

export function applySourcesToGraph(
  scope: ResearchScope,
  graph: ResearchGraphTemplate,
  sources: ResearchSource[]
) {
  const nextGraph: ResearchGraphTemplate = {
    ...graph,
    nodes: [...graph.nodes],
    edges: [...graph.edges],
    gaps: [...graph.gaps],
    rounds: [...(graph.rounds || [])],
    updatedAt: new Date().toISOString(),
  };

  const evidenceInserts = sources.slice(0, scope.depth === 'deep' ? 18 : 12).map(source => {
    const sourceNodeId = `${nodeTypeForSource(source).toLowerCase()}-${safeId(source.id || source.title)}`;
    const evidenceNodeId = `evidence-${safeId(source.id || source.title)}`;
    const claimNodeId = `claim-${safeId(source.title)}`;

    const nodesToAdd: ResearchGraphNode[] = [
      {
        id: sourceNodeId,
        type: nodeTypeForSource(source),
        label: source.title,
        status: 'partial',
        metadata: {
          url: source.url,
          provider: source.sourceProvider,
          year: source.year,
          citationCount: source.citationCount,
          authors: source.authors,
        },
      },
      {
        id: evidenceNodeId,
        type: 'Evidence',
        label: (source.fullTextExcerpt || source.snippet || source.title).slice(0, 80),
        status: 'partial',
        metadata: { sourceId: source.id, url: source.url },
      },
      {
        id: claimNodeId,
        type: 'Claim',
        label: claimFromSource(source, scope).slice(0, 100),
        status: 'partial',
        metadata: { sourceId: source.id },
      },
    ];

    for (const node of nodesToAdd) {
      if (!nextGraph.nodes.some(existing => existing.id === node.id)) nextGraph.nodes.push(node);
    }

    const edge: ResearchHyperedge = {
      id: `edge-${safeId(source.id || source.title)}`,
      type: 'CLAIM_SUPPORTED_BY_EVIDENCE',
      label: '证据支持结论',
      nodeIds: [claimNodeId, evidenceNodeId, sourceNodeId],
      evidenceIds: [source.id],
      confidence: source.fullTextExcerpt ? 0.72 : 0.58,
      metadata: { provider: source.sourceProvider, query: source.query },
    };
    if (!nextGraph.edges.some(existing => existing.id === edge.id)) nextGraph.edges.push(edge);

    return {
      source_id: source.id,
      claim: claimFromSource(source, scope),
      snippet: (source.fullTextExcerpt || source.snippet || '').slice(0, 1200),
      node_refs: [claimNodeId, evidenceNodeId, sourceNodeId],
      edge_refs: [edge.id],
      confidence: source.fullTextExcerpt ? 0.72 : 0.58,
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
      },
    };
  });

  nextGraph.gaps = evaluateGaps(scope, nextGraph);
  nextGraph.nextSearchTasks = nextGraph.gaps
    .filter(item => item.status !== 'filled')
    .flatMap(item => item.suggestedQueries.slice(0, 1))
    .slice(0, 5);

  return { graph: nextGraph, evidenceInserts };
}

export function evaluateGaps(scope: ResearchScope, graph: ResearchGraphTemplate): ResearchGap[] {
  const counts = graph.nodes.reduce<Record<string, number>>((acc, node) => {
    acc[node.type] = (acc[node.type] || 0) + 1;
    return acc;
  }, {});

  return graph.gaps.map(item => {
    const filledTypes = item.targetNodeTypes.filter(type => (counts[type] || 0) > (type === 'Problem' ? 1 : 0));
    const status: ResearchGap['status'] =
      filledTypes.length >= item.targetNodeTypes.length ? 'filled' :
      filledTypes.length > 0 ? 'partial' :
      'open';
    return { ...item, status };
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
