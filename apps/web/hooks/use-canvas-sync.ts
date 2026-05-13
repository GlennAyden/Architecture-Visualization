'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMutation } from 'convex/react';
import {
  useNodesState,
  useEdgesState,
  MarkerType,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type OnEdgesChange,
  type OnNodesChange,
  type Connection,
} from '@xyflow/react';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';
import { useDrillStore } from '@/store/drill-store';
import type { PageNodeType } from '@/components/canvas/page-node';
import type { FeatureNodeType } from '@/components/canvas/feature-node';

export type ArchNode = PageNodeType | FeatureNodeType;

type EdgeType = Doc<'nodeEdges'>['type'];
type EdgeVariantStyle = {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  markerEnd: 'arrow' | 'arrowclosed';
};

// Per-type edge styling. Keep keys aligned with the schema's `nodeEdges.type`
// union. Picks colors so each variant reads as a distinct relationship at a
// glance: grey for structural/dep edges, blue for navigation, orange for
// data-flow (matches the tldraw-era palette so existing screenshots still
// read the same).
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

function convexNodeToRf(node: Doc<'nodes'>, parentName: string | null): ArchNode {
  if (node.type === 'feature') {
    return {
      id: node._id as string,
      type: 'feature-node',
      position: { x: node.positionX, y: node.positionY },
      data: { name: node.name, parentName },
    } satisfies FeatureNodeType;
  }
  return {
    id: node._id as string,
    type: 'page-node',
    position: { x: node.positionX, y: node.positionY },
    data: { name: node.name },
  } satisfies PageNodeType;
}

function convexEdgeToRf(edge: Doc<'nodeEdges'>): Edge {
  const style = EDGE_STYLE_BY_TYPE[edge.type];
  return {
    id: edge._id as string,
    source: edge.sourceNodeId as string,
    target: edge.targetNodeId as string,
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

/**
 * Filters the nodes list down to a drill scope: the drill root plus every
 * transitive descendant via `parentId`. Identical semantics to the previous
 * tldraw-era implementation — only the input/output types changed (we walk
 * `Doc<'nodes'>` here, then map to React Flow nodes after filtering).
 */
function filterToDescendants(
  nodes: Doc<'nodes'>[],
  drillNodeId: Id<'nodes'>,
): Doc<'nodes'>[] {
  const childrenByParent = new Map<string, Doc<'nodes'>[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = childrenByParent.get(n.parentId as string);
    if (list) list.push(n);
    else childrenByParent.set(n.parentId as string, [n]);
  }
  const visible: Doc<'nodes'>[] = [];
  const seen = new Set<string>();
  const stack: string[] = [drillNodeId as string];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodes.find((n) => (n._id as string) === id);
    if (!node) continue;
    visible.push(node);
    const kids = childrenByParent.get(id);
    if (kids) for (const k of kids) stack.push(k._id as string);
  }
  return visible;
}

interface Args {
  nodes: Doc<'nodes'>[] | undefined;
  edges: Doc<'nodeEdges'>[] | undefined;
}

interface SyncResult {
  rfNodes: ArchNode[];
  rfEdges: Edge[];
  onNodesChange: OnNodesChange<ArchNode>;
  onEdgesChange: OnEdgesChange;
  onNodeDragStop: (event: React.MouseEvent, node: ArchNode) => void;
  // No-op: we don't allow user-drawn connections — edges come from Convex.
  onConnect: (connection: Connection) => void;
}

// `nodes.listByProject` and `nodeEdges.listByProject` are lenient — they
// return `[]` while Clerk's JWT is mid-refresh. Without a grace period,
// `setRfNodes([])` would wipe the visible canvas. Defer the wipe so a
// recovered auth tick can restore content before the canvas blanks.
const SUSPICIOUS_EMPTY_GRACE_MS = 1500;

/**
 * React Flow sync hook. Convex docs are the source of truth; React Flow
 * holds the live editable state (positions during drag, etc.) and is
 * resynced from Convex whenever the query emits.
 *
 * Differs from the tldraw-era implementation in three places worth
 * remembering:
 *
 *  1. State ownership: React Flow's `useNodesState` / `useEdgesState`
 *     keep the live state; we push Convex updates in via `setRfNodes`.
 *     This replaces tldraw's `editor.store.listen` + `applyingRemoteRef`
 *     echo-guard dance (~150 lines deleted).
 *
 *  2. Drag dispatch: `onNodeDragStop` fires once at drag end, so we no
 *     longer need the 250ms debounce ref the old reconcile used.
 *
 *  3. Hierarchy edge un-delete: same idea (parentId mirrors the edge,
 *     deleting the arrow would just resurrect on next reconcile), but
 *     implemented by *skipping* the 'remove' change in `onEdgesChange`
 *     before forwarding to React Flow's state — RF keeps showing it.
 */
export function useCanvasSync({ nodes, edges }: Args): SyncResult {
  const updateMutation = useMutation(api.nodes.update);
  const removeEdgeMutation = useMutation(api.nodeEdges.remove);

  const drillNodeId = useDrillStore((s) => s.drillNodeId);

  const visibleNodes = useMemo(() => {
    if (!nodes) return undefined;
    if (drillNodeId === null) return nodes;
    return filterToDescendants(nodes, drillNodeId);
  }, [nodes, drillNodeId]);

  const visibleEdges = useMemo(() => {
    if (!edges) return undefined;
    if (drillNodeId === null || !visibleNodes) return edges;
    const visibleIds = new Set(visibleNodes.map((n) => n._id as string));
    return edges.filter(
      (e) =>
        visibleIds.has(e.sourceNodeId as string) && visibleIds.has(e.targetNodeId as string),
    );
  }, [edges, visibleNodes, drillNodeId]);

  const [rfNodes, setRfNodes, onNodesChangeInternal] = useNodesState<ArchNode>([]);
  const [rfEdges, setRfEdges, onEdgesChangeInternal] = useEdgesState<Edge>([]);

  // Mirror of visibleEdges in a ref so the edges-change handler (which
  // captures its closure once per render) can resolve an edge's `type`
  // when the user tries to delete it — used for the hierarchy un-delete
  // guard below.
  const edgesRef = useRef<Doc<'nodeEdges'>[] | undefined>(visibleEdges);
  edgesRef.current = visibleEdges;

  // Track in-progress drag so a Convex re-emit mid-drag can't snap the
  // node back to its server position. We resume Convex syncs when the
  // drag ends (and the mutation has been dispatched).
  const draggingRef = useRef(false);

  // Wipe-deferral state. See SUSPICIOUS_EMPTY_GRACE_MS above.
  const prevNodeCountRef = useRef<number | null>(null);
  const prevEdgeCountRef = useRef<number | null>(null);
  const nodesWipeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgesWipeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Convex → RF nodes sync. Re-derives whenever the upstream Convex
  // snapshot or the drill scope changes.
  useEffect(() => {
    if (!visibleNodes) return;
    if (draggingRef.current) return;

    if (nodesWipeTimerRef.current) {
      clearTimeout(nodesWipeTimerRef.current);
      nodesWipeTimerRef.current = null;
    }

    // Suspicious empty (had nodes, now zero) — defer; if the next emit
    // is also empty the timer fires and clears state, otherwise it's
    // cancelled before it gets the chance.
    if (
      visibleNodes.length === 0 &&
      prevNodeCountRef.current !== null &&
      prevNodeCountRef.current > 0
    ) {
      nodesWipeTimerRef.current = setTimeout(() => {
        nodesWipeTimerRef.current = null;
        setRfNodes([]);
        prevNodeCountRef.current = 0;
      }, SUSPICIOUS_EMPTY_GRACE_MS);
      return;
    }

    prevNodeCountRef.current = visibleNodes.length;
    const byId = new Map(visibleNodes.map((n) => [n._id as string, n]));
    const next: ArchNode[] = visibleNodes.map((n) => {
      const parent = n.parentId ? byId.get(n.parentId as string) : undefined;
      return convexNodeToRf(n, parent?.name ?? null);
    });
    setRfNodes(next);
  }, [visibleNodes, setRfNodes]);

  // Convex → RF edges sync.
  useEffect(() => {
    if (!visibleEdges) return;

    if (edgesWipeTimerRef.current) {
      clearTimeout(edgesWipeTimerRef.current);
      edgesWipeTimerRef.current = null;
    }

    if (
      visibleEdges.length === 0 &&
      prevEdgeCountRef.current !== null &&
      prevEdgeCountRef.current > 0
    ) {
      edgesWipeTimerRef.current = setTimeout(() => {
        edgesWipeTimerRef.current = null;
        setRfEdges([]);
        prevEdgeCountRef.current = 0;
      }, SUSPICIOUS_EMPTY_GRACE_MS);
      return;
    }

    prevEdgeCountRef.current = visibleEdges.length;
    setRfEdges(visibleEdges.map(convexEdgeToRf));
  }, [visibleEdges, setRfEdges]);

  // Clean up pending wipe timers on unmount.
  useEffect(() => {
    return () => {
      if (nodesWipeTimerRef.current) clearTimeout(nodesWipeTimerRef.current);
      if (edgesWipeTimerRef.current) clearTimeout(edgesWipeTimerRef.current);
    };
  }, []);

  // Filter `onNodesChange` — drop `remove` events so the Delete key in
  // tldraw-style "click + Delete → wipe" never trickles through. Node
  // deletion lives in the modal/toolbar where it's intentional. The
  // dragging detection flips on the first 'position' change with
  // `dragging: true` and back off when the last drag change reports
  // `dragging: false` (RF guarantees this terminal change).
  const onNodesChange = useCallback<OnNodesChange<ArchNode>>(
    (changes) => {
      let nextDragging = draggingRef.current;
      const filtered: NodeChange<ArchNode>[] = [];
      for (const change of changes) {
        if (change.type === 'remove') continue;
        if (change.type === 'position' && 'dragging' in change) {
          if (change.dragging) nextDragging = true;
          else if (change.dragging === false) nextDragging = false;
        }
        filtered.push(change);
      }
      draggingRef.current = nextDragging;
      onNodesChangeInternal(filtered);
    },
    [onNodesChangeInternal],
  );

  // Filter `onEdgesChange` — hierarchy edge removal is no-op'd at the
  // change level (we don't forward it to RF state); other types dispatch
  // a Convex mutation, and we let the change through so the visual
  // disappears immediately. Convex's re-emit will confirm it's gone.
  const onEdgesChange = useCallback<OnEdgesChange>(
    (changes) => {
      const filtered: EdgeChange<Edge>[] = [];
      for (const change of changes) {
        if (change.type !== 'remove') {
          filtered.push(change);
          continue;
        }
        const backing = edgesRef.current?.find((e) => (e._id as string) === change.id);
        if (!backing) continue;
        if (backing.type === 'hierarchy') {
          // Swallow the change so RF state keeps showing the arrow.
          continue;
        }
        removeEdgeMutation({ id: backing._id });
        filtered.push(change);
      }
      onEdgesChangeInternal(filtered);
    },
    [onEdgesChangeInternal, removeEdgeMutation],
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: ArchNode) => {
      const nodeId = node.id as Id<'nodes'>;
      updateMutation({
        id: nodeId,
        positionX: Math.round(node.position.x),
        positionY: Math.round(node.position.y),
      });
    },
    [updateMutation],
  );

  const onConnect = useCallback(() => {
    // No-op. Edges are derived from Convex (hierarchy from parentId,
    // dependency/navigation/data_flow from scanners). User-drawn arrows
    // would orphan from that pipeline, so this interaction is inert.
  }, []);

  return {
    rfNodes,
    rfEdges,
    onNodesChange,
    onEdgesChange,
    onNodeDragStop,
    onConnect,
  };
}
