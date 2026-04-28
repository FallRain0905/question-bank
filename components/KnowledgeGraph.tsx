'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';

const Graphin = dynamic(() => import('@antv/graphin').then(m => m.Graphin), { ssr: false });

const colors = [
  '#F6BD16', '#00C9C9', '#F08F56', '#D580FF', '#FF3D00',
  '#16f69c', '#004ac9', '#f056d1', '#a680ff', '#c8ff00',
];

const entityTypeColors: Record<string, string> = {
  PERSON: '#00C9C9',
  CONCEPT: '#a68fff',
  ORGANIZATION: '#F08F56',
  LOCATION: '#16f69c',
  EVENT: '#004ac9',
  PRODUCT: '#f056d1',
};

interface NeighborData {
  vertices: Record<string, {
    entity_name?: string;
    entity_type?: string;
    description?: string;
    additional_properties?: string;
    [key: string]: any;
  }>;
  edges: Record<string, {
    keywords?: string;
    summary?: string;
    description?: string;
    weight?: number;
    [key: string]: any;
  }>;
}

interface KnowledgeGraphProps {
  kbId: string;
  token: string;
  height?: string;
}

function buildGraphOptions(data: NeighborData, selectedVertex: string, mode: 'hyper' | 'graph') {
  const nodes: any[] = [];
  const edges: any[] = [];
  const plugins: any[] = [];

  // Add vertices as nodes
  for (const key in data.vertices) {
    nodes.push({
      id: key,
      ...data.vertices[key],
    });
  }

  const edgeKeys = Object.keys(data.edges);

  if (mode === 'graph') {
    // Standard pairwise edges
    for (const key of edgeKeys) {
      const nodeIds = key.split('|#|');
      for (let j = 0; j < nodeIds.length; j++) {
        for (let k = j + 1; k < nodeIds.length; k++) {
          edges.push({
            source: nodeIds[j],
            target: nodeIds[k],
            id: `e-${edges.length}`,
          });
        }
      }
    }
  } else {
    // Hyper mode: bubble-sets + virtual edges for layout
    for (let i = 0; i < edgeKeys.length; i++) {
      const key = edgeKeys[i];
      const nodeIds = key.split('|#|');
      if (nodeIds.length < 2) continue;
      const color = colors[i % colors.length];

      for (let j = 0; j < nodeIds.length; j++) {
        for (let k = j + 1; k < nodeIds.length; k++) {
          edges.push({
            source: nodeIds[j],
            target: nodeIds[k],
            id: `e-${edges.length}`,
            style: { stroke: color, lineWidth: 1, opacity: 0.3 },
          });
        }
      }

      plugins.push({
        key: `bubble-sets-${i}`,
        type: 'bubble-sets',
        members: nodeIds,
        fill: color,
        stroke: color,
        fillOpacity: 0.15,
        maxRoutingIterations: 100,
        maxMarchingIterations: 20,
        pixelGroup: 4,
        edgeR0: 10,
        edgeR1: 60,
        nodeR0: 15,
        nodeR1: 50,
        morphBuffer: 10,
        threshold: 4,
        memberInfluenceFactor: 1,
        edgeInfluenceFactor: 4,
        nonMemberInfluenceFactor: -0.8,
        virtualEdges: true,
      });
    }
  }

  plugins.push({
    type: 'tooltip',
    getContent: (_e: any, items: any[]) => {
      let result = '';
      items.forEach(item => {
        result += `<div style="padding:2px 0"><strong>${String(item.id)}</strong>`;
        if (item.entity_type) result += `<br/><span style="color:#888;font-size:11px">${item.entity_type}</span>`;
        if (item.description) {
          const desc = String(item.description).split('<SEP>').slice(0, 2).join('; ');
          if (desc) result += `<br/><span style="color:#666;font-size:11px">${desc.slice(0, 100)}</span>`;
        }
        result += '</div>';
      });
      return result;
    },
  });

  return {
    autoResize: true,
    data: { nodes, edges },
    node: {
      palette: { field: 'cluster' },
      style: {
        size: mode === 'graph' ? 20 : 25,
        labelText: (d: any) => d.id,
        labelFontSize: 10,
        labelPlacement: 'bottom' as const,
        fill: (d: any) => {
          if (d.id === selectedVertex) return '#1a1a1a';
          return entityTypeColors[d.entity_type] || '#8566CC';
        },
        stroke: '#fff',
        lineWidth: 1,
      },
    },
    edge: {
      style: { stroke: '#a68fff', lineWidth: 1.5, endArrow: false },
    },
    animate: false,
    behaviors: ['zoom-canvas', 'drag-canvas', 'drag-element'],
    autoFit: { type: 'view' as const },
    layout: {
      type: 'force',
      preventOverlap: true,
      nodeClusterBy: 'entity_type',
      gravity: 10,
      linkDistance: 120,
      nodeStrength: -200,
    },
    plugins,
  };
}

export default function KnowledgeGraph({ kbId, token, height = '600px' }: KnowledgeGraphProps) {
  const [mode, setMode] = useState<'graph' | 'hyper'>('hyper');
  const [graphKey, setGraphKey] = useState(0);

  // Entity name list for dropdown
  const [entityNames, setEntityNames] = useState<string[]>([]);
  const [namesLoading, setNamesLoading] = useState(false);

  // Selected entity
  const [selectedEntity, setSelectedEntity] = useState<string | undefined>(undefined);
  const [graphData, setGraphData] = useState<NeighborData | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  // Entity detail for right panel
  const [entityDetail, setEntityDetail] = useState<{
    entity_name: string;
    entity_type: string;
    descriptions: string[];
    properties: string[];
  }>({ entity_name: '', entity_type: '', descriptions: [], properties: [] });

  // Load entity names with scroll pagination
  const loadEntityNames = useCallback(async () => {
    if (!token || !kbId) return;
    setNamesLoading(true);
    try {
      const res = await fetch(`/api/hyperrag/entity-names?kb_id=${kbId}&page=1&page_size=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const list: string[] = data.names || [];
      setEntityNames(list);

      // Auto-select first entity
      if (list.length > 0 && !selectedEntity) {
        setSelectedEntity(list[0]);
      }
    } catch (err) {
      console.error('Failed to load entity names:', err);
    }
    setNamesLoading(false);
  }, [token, kbId, selectedEntity]);

  // Initial load
  useEffect(() => {
    if (token && kbId) {
      setEntityNames([]);
      setSelectedEntity(undefined);
      loadEntityNames();
    }
  }, [token, kbId]);

  // Fetch neighbor subgraph when entity is selected
  useEffect(() => {
    if (!selectedEntity || !token || !kbId) return;

    setGraphLoading(true);
    fetch(`/api/hyperrag/vertex-neighbor?kb_id=${kbId}&vertex_id=${encodeURIComponent(selectedEntity)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then((data: NeighborData) => {
        setGraphData(data);
        setGraphKey(k => k + 1);

        // Update entity detail panel
        const vertex = data.vertices[selectedEntity];
        if (vertex) {
          setEntityDetail({
            entity_name: vertex.entity_name || selectedEntity,
            entity_type: vertex.entity_type || '',
            descriptions: vertex.description ? vertex.description.split('<SEP>') : [],
            properties: vertex.additional_properties ? vertex.additional_properties.split('<SEP>') : [],
          });
        }
      })
      .catch(err => {
        console.error('Failed to fetch vertex neighbor:', err);
        setGraphData(null);
      })
      .finally(() => setGraphLoading(false));
  }, [selectedEntity, token, kbId]);

  const switchMode = useCallback((m: 'graph' | 'hyper') => {
    setMode(m);
    setGraphKey(k => k + 1);
  }, []);

  const options = useMemo(() => {
    if (!graphData || !selectedEntity) return null;
    return buildGraphOptions(graphData, selectedEntity, mode);
  }, [graphData, selectedEntity, mode]);

  // No data state
  if (entityNames.length === 0 && !namesLoading) {
    return (
      <div className="text-center py-16 bg-white border border-gray-100 rounded-xl">
        <p className="text-gray-400 mb-2">暂无图谱数据</p>
        <p className="text-xs text-gray-300">请先在「索引管理」中构建索引</p>
      </div>
    );
  }

  const vertexCount = graphData ? Object.keys(graphData.vertices).length : 0;
  const edgeCount = graphData ? Object.keys(graphData.edges).length : 0;

  return (
    <div>
      {/* Top bar: entity selector + mode switch */}
      <div className="flex items-center justify-between mb-3 gap-4">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm text-gray-500 shrink-0">选择实体</span>
          <div className="relative flex-1 max-w-xs">
            <select
              value={selectedEntity || ''}
              onChange={e => setSelectedEntity(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 truncate"
            >
              {entityNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          {namesLoading && <span className="text-xs text-gray-400">加载中...</span>}
        </div>

        <div className="flex items-center gap-3">
          {selectedEntity && (
            <span className="text-xs text-gray-400">{vertexCount} 节点 · {edgeCount} 超边</span>
          )}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => switchMode('graph')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${mode === 'graph' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
            >Graph</button>
            <button
              onClick={() => switchMode('hyper')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${mode === 'hyper' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
            >Hyper</button>
          </div>
        </div>
      </div>

      {/* Main area: graph + detail panel */}
      <div className="flex gap-4">
        {/* Graph */}
        <div className="flex-1 min-w-0">
          <div style={{ height, border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
            {graphLoading ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                加载超图数据中...
              </div>
            ) : options ? (
              <Graphin key={graphKey} options={options} style={{ width: '100%', height: '100%' }} />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                {selectedEntity ? '暂无邻居数据' : '请选择一个实体'}
              </div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selectedEntity && entityDetail.entity_name && (
          <div className="w-72 shrink-0 bg-white border border-gray-100 rounded-xl p-4 overflow-auto" style={{ maxHeight: height }}>
            <h3 className="font-medium text-sm text-gray-900 mb-3">实体详情</h3>

            <div className="space-y-3 text-sm">
              <div>
                <span className="text-gray-500">名称：</span>
                <span className="text-gray-900">{entityDetail.entity_name}</span>
              </div>

              {entityDetail.entity_type && (
                <div>
                  <span className="text-gray-500">类型：</span>
                  <span className="inline-block px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">{entityDetail.entity_type}</span>
                </div>
              )}

              {entityDetail.descriptions.length > 0 && entityDetail.descriptions.some(d => d.trim()) && (
                <div>
                  <span className="text-gray-500 block mb-1">描述：</span>
                  <ul className="space-y-1">
                    {entityDetail.descriptions.filter(d => d.trim()).map((desc, idx) => (
                      <li key={idx} className="text-xs text-gray-600 leading-relaxed pl-2 border-l-2 border-gray-200">
                        {desc}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {entityDetail.properties.length > 0 && entityDetail.properties.some(p => p.trim()) && (
                <div>
                  <span className="text-gray-500 block mb-1">属性：</span>
                  <ul className="space-y-1">
                    {entityDetail.properties.filter(p => p.trim()).map((prop, idx) => (
                      <li key={idx} className="text-xs text-gray-600 leading-relaxed pl-2 border-l-2 border-gray-200">
                        {prop}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
