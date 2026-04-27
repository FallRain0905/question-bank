'use client';

import { useMemo, useState, useCallback } from 'react';
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

interface KnowledgeGraphProps {
  entities: any[];
  relationships: any[];
  height?: string;
}

function buildGraphOptions(entities: any[], relationships: any[], mode: 'hyper' | 'graph') {
  const nodes: any[] = [];
  const edges: any[] = [];
  const plugins: any[] = [];

  // Build vertices map
  const vertexMap: Record<string, any> = {};
  entities.forEach(entity => {
    const name = String(entity.entity_name || entity.name || `Entity_${Math.random()}`);
    vertexMap[name] = {
      ...entity,
      entity_type: String(entity.entity_type || '未知'),
      description: String(entity.description || ''),
    };
  });

  // Build edges from relationships
  const edgeMap: Record<string, any> = {};
  relationships.forEach((edge: any, index: number) => {
    let edgeKey: string;
    if (Array.isArray(edge.entity_set) && edge.entity_set.length > 0) {
      edgeKey = edge.entity_set.map((e: any) => String(e)).join('|#|');
    } else if (typeof edge.entity_set === 'string' && edge.entity_set.length > 0) {
      edgeKey = edge.entity_set;
    } else {
      edgeKey = `edge_${index}`;
    }

    // Ensure entities in edges exist in vertexMap
    edgeKey.split('|#|').forEach(name => {
      if (!vertexMap[name]) {
        vertexMap[name] = { entity_type: '未知', description: '' };
      }
    });

    edgeMap[edgeKey] = {
      keywords: String(edge.keywords || ''),
      description: String(edge.description || ''),
      weight: edge.weight || 1,
    };
  });

  // Create nodes
  for (const key in vertexMap) {
    nodes.push({
      ...vertexMap[key],
      id: key,
    });
  }

  if (mode === 'graph') {
    // Standard pairwise edges
    for (const key of Object.keys(edgeMap)) {
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
    // Hyper mode: bubble-sets
    const edgeKeys = Object.keys(edgeMap);
    for (let i = 0; i < edgeKeys.length; i++) {
      const key = edgeKeys[i];
      const nodeIds = key.split('|#|');
      if (nodeIds.length < 2) continue;
      const color = colors[i % colors.length];

      // Also create virtual edges for layout
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
        fill: (d: any) => entityTypeColors[d.entity_type] || '#8566CC',
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

export default function KnowledgeGraph({ entities, relationships, height = '500px' }: KnowledgeGraphProps) {
  const [mode, setMode] = useState<'graph' | 'hyper'>('graph');
  const [graphKey, setGraphKey] = useState(0);

  const switchMode = useCallback((m: 'graph' | 'hyper') => {
    setMode(m);
    setGraphKey(k => k + 1); // Force re-mount to avoid destroyed instance error
  }, []);

  const options = useMemo(() => {
    return buildGraphOptions(entities, relationships, mode);
  }, [entities, relationships, mode]);

  if (!entities.length && !relationships.length) {
    return (
      <div className="text-center py-16 bg-white border border-gray-100 rounded-xl">
        <p className="text-gray-400 mb-2">暂无图谱数据</p>
        <p className="text-xs text-gray-300">请先在「索引管理」中构建索引</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500">{entities.length} 实体 · {relationships.length} 关系</span>
        </div>
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
      <div style={{ height, border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
        <Graphin key={graphKey} options={options} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
}
