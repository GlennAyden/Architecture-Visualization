'use client';

import { useEffect, useMemo } from 'react';
import { useEdgesState, useNodesState, MarkerType, type Edge } from '@xyflow/react';

import type { ArchNode } from '@/hooks/use-canvas-sync';

// Local payload shapes — mirror what `api.shareView.get` returns. Cannot
// reuse `Doc<'nodes'>` directly: the share endpoint sanitizes fields and
// returns string ids, not branded `Id<'nodes'>` values.
export interface ShareNode {
  _id: string;
  type: 'page' | 'feature';
  name: string;
  parentId: string | null;
  positionX: number;
  positionY: number;
}

export interface ShareEdge {
  _id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: 'hierarchy' | 'dependency' | 'navigation' | 'data_flow';
}

type EdgeType = ShareEdge['type'];
type EdgeVariantStyle = {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  markerEnd: 'arrow' | 'arrowclosed';
};

// Duplicated from `use-canvas-sync.ts` (Rule 3: surgical duplication beats
// a premature shared util). Keep keys aligned with `nodeEdges.type` union.
const EDGE_STYLE_BY_TYPE: Record<EdgeType, EdgeVariantStyle> = {
  hierarchy: { stroke: '#9ca3af', strokeWidth: 2, markerEnd: 'arrow' },
  dependency: {
    stroke: '#9ca3af',
    strokeWidth: 1.5,
    strokeDasharray: '6 4',
    markerEnd: 'arrow',
  },
  navigation: { stroke: '#60a5fa', strokeWidth: 2, markerEnd: 'arrowclosed' },
  data_flow: {
    stroke: '#fb923c',
    strokeWidth: 2,
    strokeDasharray: '2 4',
    markerEnd: 'arrow',
  },
};

function shareNodeToRf(node: ShareNode, parentName: string | null): ArchNode {
  if (node.type === 'feature') {
    return {
      id: node._id,
      type: 'feature-node',
      position: { x: node.positionX, y: node.positionY },
      data: { name: node.name, parentName, readOnly: true },
    };
  }
  return {
    id: node._id,
    type: 'page-node',
    position: { x: node.positionX, y: node.positionY },
    data: { name: node.name, readOnly: true },
  };
}

function shareEdgeToRf(edge: ShareEdge): Edge {
  const style = EDGE_STYLE_BY_TYPE[edge.type];
  return {
    id: edge._id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    type: 'default',
    data: { edgeType: edge.type },
    style: {
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      strokeDasharray: style.strokeDasharray,
    },
    markerEnd: {
      type: style.markerEnd === 'arrowclosed' ? MarkerType.ArrowClosed : MarkerType.Arrow,
      color: style.stroke,
      width: 18,
      height: 18,
    },
  };
}

interface Args {
  nodes: ShareNode[] | undefined;
  edges: ShareEdge[] | undefined;
}

interface SyncResult {
  rfNodes: ArchNode[];
  rfEdges: Edge[];
  // RF still wants change callbacks even in read-only mode (they pipe
  // viewport/selection state updates back into RF's internal store).
  onNodesChange: ReturnType<typeof useNodesState<ArchNode>>[2];
  onEdgesChange: ReturnType<typeof useEdgesState<Edge>>[2];
}

/**
 * Read-only counterpart to `useCanvasSync`. Builds React Flow's `nodes`
 * and `edges` from the share-view payload and feeds them into RF's
 * internal state (via `useNodesState` / `useEdgesState`). No mutations
 * are dispatched — the caller is responsible for setting `nodesDraggable`,
 * `nodesConnectable`, and `elementsSelectable` to false at the
 * `<ReactFlow>` level so viewers can pan/zoom but cannot edit.
 */
export function useShareCanvasSync({ nodes, edges }: Args): SyncResult {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<ArchNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const derivedNodes = useMemo<ArchNode[]>(() => {
    if (!nodes) return [];
    const byId = new Map(nodes.map((n) => [n._id, n]));
    return nodes.map((n) => {
      const parent = n.parentId ? byId.get(n.parentId) : undefined;
      return shareNodeToRf(n, parent?.name ?? null);
    });
  }, [nodes]);

  const derivedEdges = useMemo<Edge[]>(() => {
    if (!edges) return [];
    return edges.map(shareEdgeToRf);
  }, [edges]);

  useEffect(() => {
    setRfNodes(derivedNodes);
  }, [derivedNodes, setRfNodes]);

  useEffect(() => {
    setRfEdges(derivedEdges);
  }, [derivedEdges, setRfEdges]);

  return { rfNodes, rfEdges, onNodesChange, onEdgesChange };
}
