'use client';

import { useEffect, useMemo } from 'react';
import { useEdgesState, useNodesState, MarkerType, type Edge } from '@xyflow/react';
import { FEATURE_NODE_DEFAULT_HEIGHT, FEATURE_NODE_DEFAULT_WIDTH } from '@arch-viz/shared';

import type { ArchNode } from '@/hooks/use-canvas-sync';
import {
  CLUSTER_CHILD_SPACING,
  CLUSTER_PADDING,
  CLUSTER_TITLE_BAR_HEIGHT,
} from '@/lib/auto-layout';

// Local payload shapes — mirror what `api.shareView.get` returns. Cannot
// reuse `Doc<'nodes'>` directly: the share endpoint sanitizes fields and
// returns string ids, not branded `Id<'nodes'>` values.
export interface ShareNode {
  _id: string;
  type: 'page' | 'feature';
  name: string;
  layerId: string | null;
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

function shareEdgeToRf(edge: ShareEdge): Edge {
  const style = EDGE_STYLE_BY_TYPE[edge.type];
  return {
    id: edge._id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    type: 'smoothstep',
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

/**
 * Build cluster-aware React Flow nodes from the share payload. Mirrors
 * `buildRfNodes` in `use-canvas-sync` (cluster containers + relative
 * child positions + dynamic parent size) so the read-only viewer sees
 * the same visual the owner does, minus the editing affordances.
 */
function buildRfNodesFromShare(shareNodes: ShareNode[]): ArchNode[] {
  if (shareNodes.length === 0) return [];

  const byId = new Map(shareNodes.map((n) => [n._id, n]));
  const childrenByParent = new Map<string, ShareNode[]>();
  for (const n of shareNodes) {
    if (!n.parentId) continue;
    if (!byId.has(n.parentId)) continue;
    const list = childrenByParent.get(n.parentId) ?? [];
    list.push(n);
    childrenByParent.set(n.parentId, list);
  }

  const containerSize = new Map<string, { w: number; h: number }>();
  for (const [parentId, children] of childrenByParent.entries()) {
    const parent = byId.get(parentId);
    if (!parent) continue;
    let maxRightRel = 0;
    let maxBottomRel = 0;
    for (const child of children) {
      const relRight = child.positionX - parent.positionX + FEATURE_NODE_DEFAULT_WIDTH;
      const relBottom = child.positionY - parent.positionY + FEATURE_NODE_DEFAULT_HEIGHT;
      maxRightRel = Math.max(maxRightRel, relRight);
      maxBottomRel = Math.max(maxBottomRel, relBottom);
    }
    containerSize.set(parentId, {
      w: Math.max(maxRightRel + CLUSTER_PADDING, 200),
      h: Math.max(
        maxBottomRel + CLUSTER_PADDING - CLUSTER_CHILD_SPACING,
        CLUSTER_TITLE_BAR_HEIGHT + CLUSTER_PADDING,
      ),
    });
  }

  return shareNodes.map((n): ArchNode => {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const parentName = parent?.name ?? null;

    if (n.type === 'feature') {
      if (!parent) {
        return {
          id: n._id,
          type: 'feature-node',
          position: { x: n.positionX, y: n.positionY },
          data: { name: n.name, parentName: null, readOnly: true, insideCluster: false },
        };
      }
      return {
        id: n._id,
        type: 'feature-node',
        parentId: parent._id,
        extent: 'parent',
        position: {
          x: n.positionX - parent.positionX,
          y: n.positionY - parent.positionY,
        },
        data: { name: n.name, parentName, readOnly: true, insideCluster: true },
      };
    }

    const size = containerSize.get(n._id);
    if (size) {
      return {
        id: n._id,
        type: 'page-node',
        position: { x: n.positionX, y: n.positionY },
        width: size.w,
        height: size.h,
        data: {
          name: n.name,
          readOnly: true,
          hasChildren: true,
          containerWidth: size.w,
          containerHeight: size.h,
        },
      };
    }
    return {
      id: n._id,
      type: 'page-node',
      position: { x: n.positionX, y: n.positionY },
      data: { name: n.name, readOnly: true, hasChildren: false },
    };
  });
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
 * and `edges` from the share-view payload, applying the same cluster
 * container layout and edge-noise filtering as the editable view.
 *
 * `nodesDraggable={false}` / `nodesConnectable={false}` /
 * `elementsSelectable={false}` are the caller's responsibility at the
 * `<ReactFlow>` level — this hook only shapes the data.
 */
export function useShareCanvasSync({ nodes, edges }: Args): SyncResult {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<ArchNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const derivedNodes = useMemo<ArchNode[]>(() => {
    if (!nodes) return [];
    return buildRfNodesFromShare(nodes);
  }, [nodes]);

  const derivedEdges = useMemo<Edge[]>(() => {
    if (!nodes || !edges) return [];
    const nodesById = new Map(nodes.map((n) => [n._id, n]));
    // Drop hierarchy edges that are already shown by container nesting —
    // matches the filter in `useCanvasSync` so the viewer sees the same
    // calm starbursts-removed canvas.
    const kept = edges.filter((e) => {
      if (e.type !== 'hierarchy') return true;
      const target = nodesById.get(e.targetNodeId);
      if (!target?.parentId) return true;
      return target.parentId !== e.sourceNodeId;
    });
    return kept.map(shareEdgeToRf);
  }, [edges, nodes]);

  useEffect(() => {
    setRfNodes(derivedNodes);
  }, [derivedNodes, setRfNodes]);

  useEffect(() => {
    setRfEdges(derivedEdges);
  }, [derivedEdges, setRfEdges]);

  return { rfNodes, rfEdges, onNodesChange, onEdgesChange };
}
