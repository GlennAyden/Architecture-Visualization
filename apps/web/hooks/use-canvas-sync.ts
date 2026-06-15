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
import { FEATURE_NODE_DEFAULT_HEIGHT, FEATURE_NODE_DEFAULT_WIDTH } from '@arch-viz/shared';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';
import { useDrillStore } from '@/store/drill-store';
import type { PageNodeType } from '@/components/canvas/page-node';
import type { FeatureNodeType } from '@/components/canvas/feature-node';
import {
  CLUSTER_CHILD_SPACING,
  CLUSTER_PADDING,
  CLUSTER_TITLE_BAR_HEIGHT,
} from '@/lib/auto-layout';
import {
  getCanvasEdgePresentation,
  type CanvasEdgeMode,
  type CanvasFlowSelection,
} from '@/lib/canvas-edge-presentation';
import {
  buildCollapsedGraph,
  type CollapsedNodeStats,
  type RenderEdge,
} from '@/lib/canvas-collapse';

export type ArchNode = PageNodeType | FeatureNodeType;

type EdgeType = Doc<'nodeEdges'>['type'];
export type NodeSummary = {
  nodeId: string;
  fileCount: number;
  verifiedCount: number;
  roles: Record<string, number>;
};
type HighlightMode = { edgeIds: ReadonlySet<string>; hasFocus: boolean };
type EdgeVariantStyle = {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  markerEnd: 'arrow' | 'arrowclosed';
};

// Per-type edge styling. Keep keys aligned with `nodeEdges.type` union.
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
  contains: { stroke: '#22d3ee', strokeWidth: 2, markerEnd: 'arrow' },
  uses: { stroke: '#a78bfa', strokeWidth: 2, markerEnd: 'arrowclosed' },
  triggers: { stroke: '#facc15', strokeWidth: 2.2, markerEnd: 'arrowclosed' },
  reads: {
    stroke: '#34d399',
    strokeWidth: 2,
    strokeDasharray: '2 4',
    markerEnd: 'arrow',
  },
  writes: { stroke: '#fb7185', strokeWidth: 2.2, markerEnd: 'arrowclosed' },
  integrates: {
    stroke: '#38bdf8',
    strokeWidth: 2,
    strokeDasharray: '8 4',
    markerEnd: 'arrowclosed',
  },
};

function convexEdgeToRf(edge: RenderEdge, highlightMode: HighlightMode | undefined): Edge {
  const style = EDGE_STYLE_BY_TYPE[edge.type];
  const active = highlightMode?.edgeIds.has(edge._id as string) ?? false;
  const dimmed = highlightMode?.hasFocus ? !active : false;
  const stroke = active ? '#facc15' : style.stroke;
  const strokeWidth = active ? Math.max(style.strokeWidth, 2.5) : style.strokeWidth;
  return {
    id: edge._id as string,
    source: edge.sourceNodeId as string,
    target: edge.targetNodeId as string,
    // `smoothstep` routes around nodes with rounded right-angles — much
    // calmer to read than the default bezier that wiggles through
    // children. React Flow's default corner radius (5px) is fine.
    type: 'smoothstep',
    data: { edgeType: edge.type },
    label: edge.aggregateCount && edge.aggregateCount > 1 ? `${edge.aggregateCount}` : undefined,
    labelStyle: { fill: '#fef3c7', fontSize: 10, fontWeight: 700 },
    labelBgStyle: {
      fill: 'rgba(24, 24, 27, 0.92)',
      stroke: 'rgba(250, 204, 21, 0.35)',
    },
    style: {
      stroke,
      strokeWidth,
      strokeDasharray: style.strokeDasharray,
      opacity: dimmed ? 0.22 : 1,
    },
    markerEnd: {
      type: style.markerEnd === 'arrowclosed' ? MarkerType.ArrowClosed : MarkerType.Arrow,
      color: stroke,
      width: active ? 22 : 18,
      height: active ? 22 : 18,
    },
  };
}

/**
 * Builds the React Flow node list with cluster (parent-child container)
 * semantics. Two passes:
 *
 *   Pass 1 — for every page with visible children: compute the bounding
 *     box of its children (in absolute coords from Convex), then derive
 *     a container size (bbox + padding + title bar). This sizes the
 *     parent so its body wraps the children regardless of where the
 *     children landed (auto-layout result or user-dragged).
 *
 *   Pass 2 — emit the RF nodes. A child node sets `parentId` + an
 *     extent='parent' constraint so it visually lives inside the parent
 *     box. Its `position` becomes (childAbs - parentAbs) — React Flow
 *     expects parent-relative coordinates whenever `parentId` is set,
 *     not absolute. Top-level nodes keep absolute positions.
 *
 * Why the abs↔rel dance: Convex stores positions as plain numbers; we
 * don't want to fork the schema for a UI concern. Keeping the storage
 * absolute lets export, share view, and the activity log all read the
 * same field. The relative conversion is the renderer's job.
 */
function buildRfNodes(
  projectId: Id<'projects'>,
  visibleNodes: Doc<'nodes'>[],
  highlightedNodeIds: ReadonlySet<string> | undefined,
  nodeSummaries: ReadonlyMap<string, NodeSummary>,
  edgeCounts: ReadonlyMap<string, number>,
  collapsedStats: ReadonlyMap<string, CollapsedNodeStats>,
  collapsedNodeIds: ReadonlySet<string>,
  relatedFlowCounts: ReadonlyMap<string, number>,
): ArchNode[] {
  if (visibleNodes.length === 0) return [];
  const hasHighlight = highlightedNodeIds !== undefined;

  const byId = new Map(visibleNodes.map((n) => [n._id as string, n]));
  const originalIndex = new Map(visibleNodes.map((n, index) => [n._id as string, index]));
  const depthById = new Map<string, number>();
  const getParentDepth = (node: Doc<'nodes'>): number => {
    const nodeId = node._id as string;
    const cached = depthById.get(nodeId);
    if (cached !== undefined) return cached;
    const seen = new Set<string>([nodeId]);
    let depth = 0;
    let parentId = node.parentId as string | undefined;
    while (parentId && !seen.has(parentId)) {
      const parent = byId.get(parentId);
      if (!parent) break;
      seen.add(parentId);
      depth += 1;
      parentId = parent.parentId as string | undefined;
    }
    depthById.set(nodeId, depth);
    return depth;
  };
  const childrenByParent = new Map<string, Doc<'nodes'>[]>();
  for (const n of visibleNodes) {
    if (!n.parentId) continue;
    const pid = n.parentId as string;
    if (pid === (n._id as string)) continue;
    if (!byId.has(pid)) continue;
    const list = childrenByParent.get(pid) ?? [];
    list.push(n);
    childrenByParent.set(pid, list);
  }

  // Pass 1: compute container dimensions for every parent with children.
  // We take the max extent reached by any child + a generous margin so
  // dragged children don't visually clip the container edge.
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
    const w = maxRightRel + CLUSTER_PADDING;
    // The title bar sits above the children — add it on top of the body
    // height we computed. CLUSTER_CHILD_SPACING shaves any rounding slack
    // off the bottom so the box hugs the last row.
    const h = maxBottomRel + CLUSTER_PADDING - CLUSTER_CHILD_SPACING;
    containerSize.set(parentId, {
      w: Math.max(w, 200),
      h: Math.max(h, CLUSTER_TITLE_BAR_HEIGHT + CLUSTER_PADDING),
    });
  }

  // Pass 2: emit RF nodes.
  const orderedNodes = [...visibleNodes].sort((a, b) => {
    const byDepth = getParentDepth(a) - getParentDepth(b);
    if (byDepth !== 0) return byDepth;
    return (originalIndex.get(a._id as string) ?? 0) - (originalIndex.get(b._id as string) ?? 0);
  });

  return orderedNodes.map((n): ArchNode => {
    const id = n._id as string;
    const parentInVisibleSet =
      n.parentId && (n.parentId as string) !== id && byId.has(n.parentId as string);
    const parent = parentInVisibleSet ? byId.get(n.parentId as string) : undefined;
    const parentName = parent?.name ?? null;
    const highlighted = highlightedNodeIds?.has(id) ?? false;
    const dimmed = hasHighlight && !highlighted;
    const summary = nodeSummaries.get(id);
    const collapseStats = collapsedStats.get(id);
    const commonData = {
      projectId,
      semanticKind: n.semanticKind ?? 'unknown',
      productArea: n.productArea ?? 'unknown',
      mappingStatus: n.mappingStatus ?? 'manual',
      mappingConfidence: n.mappingConfidence,
      fileCount: summary?.fileCount ?? 0,
      verifiedCount: summary?.verifiedCount ?? 0,
      edgeCount: edgeCounts.get(id) ?? 0,
      collapsed: collapsedNodeIds.has(id),
      childCount: collapseStats?.directChildCount ?? 0,
      hiddenNodeCount: collapseStats?.hiddenNodeCount ?? 0,
      hiddenFileCount: collapseStats?.hiddenFileCount ?? 0,
      hiddenEdgeCount: collapseStats?.hiddenEdgeCount ?? 0,
      relatedFlowCount: relatedFlowCounts.get(id) ?? 0,
      memberNodeIds: collapseStats?.memberNodeIds,
    };

    if (n.type === 'feature') {
      // A feature with no in-scope parent (e.g. drilled into the feature
      // itself) renders standalone at absolute coords AND keeps its
      // "↳ parent" subtitle so the user still has context.
      if (!parent) {
        return {
          id,
          type: 'feature-node',
          position: { x: n.positionX, y: n.positionY },
          data: {
            name: n.name,
            parentName: null,
            insideCluster: false,
            highlighted,
            dimmed,
            ...commonData,
          },
        } satisfies FeatureNodeType;
      }
      // Inside a visible parent cluster the subtitle is redundant — the
      // container already shows the parent. `insideCluster: true` tells
      // the renderer to hide it.
      return {
        id,
        type: 'feature-node',
        parentId: parent._id as string,
        extent: 'parent',
        position: {
          x: n.positionX - parent.positionX,
          y: n.positionY - parent.positionY,
        },
        data: { name: n.name, parentName, insideCluster: true, highlighted, dimmed, ...commonData },
      } satisfies FeatureNodeType;
    }

    // Page node — container mode if it has any visible children.
    const size = containerSize.get(id);
    if (size) {
      return {
        id,
        type: 'page-node',
        position: { x: n.positionX, y: n.positionY },
        // Explicit width / height lets React Flow correctly route edges
        // to the container's bounding box rather than guessing from
        // children. Children inside a parent are rendered "above" the
        // parent in stacking order; no extra z-index work needed.
        width: size.w,
        height: size.h,
        data: {
          name: n.name,
          hasChildren: true,
          containerWidth: size.w,
          containerHeight: size.h,
          highlighted,
          dimmed,
          ...commonData,
        },
      } satisfies PageNodeType;
    }

    return {
      id,
      type: 'page-node',
      position: { x: n.positionX, y: n.positionY },
      data: { name: n.name, hasChildren: false, highlighted, dimmed, ...commonData },
    } satisfies PageNodeType;
  });
}

/**
 * Filters the nodes list down to a drill scope: the drill root plus every
 * transitive descendant via `parentId`. Identical semantics to the
 * tldraw-era implementation.
 */
function filterToDescendants(nodes: Doc<'nodes'>[], drillNodeId: Id<'nodes'>): Doc<'nodes'>[] {
  const childrenByParent = new Map<string, Doc<'nodes'>[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    if ((n.parentId as string) === (n._id as string)) continue;
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
  projectId: Id<'projects'>;
  nodes: Doc<'nodes'>[] | undefined;
  edges: Doc<'nodeEdges'>[] | undefined;
  nodeSummaries?: NodeSummary[] | undefined;
  edgeMode?: CanvasEdgeMode;
  selectedFlow?: CanvasFlowSelection | null;
  collapsedNodeIds?: ReadonlySet<string>;
  relatedFlowCounts?: ReadonlyMap<string, number>;
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
// return `[]` while the auth token is mid-refresh. Without a grace period,
// the empty-set replacement below would wipe the canvas. Defer the wipe
// so an auth-recovered tick can restore content first.
const SUSPICIOUS_EMPTY_GRACE_MS = 1500;

export function useCanvasSync({
  projectId,
  nodes,
  edges,
  nodeSummaries,
  edgeMode = 'overview',
  selectedFlow,
  collapsedNodeIds = new Set(),
  relatedFlowCounts = new Map(),
}: Args): SyncResult {
  const updateMutation = useMutation(api.nodes.update);
  const removeEdgeMutation = useMutation(api.nodeEdges.remove);

  const drillNodeId = useDrillStore((s) => s.drillNodeId);
  const scopedNodes = useMemo(() => {
    if (!nodes) return undefined;
    if (drillNodeId === null) return nodes;
    return filterToDescendants(nodes, drillNodeId);
  }, [nodes, drillNodeId]);

  const scopedEdges = useMemo(() => {
    if (!edges) return undefined;
    // Filter pipeline:
    //   1. Drill-scope: drop edges that point at nodes outside the visible set.
    //   2. Cluster-redundancy: drop the hierarchy arrow when its target's
    //      parentId equals the source — the cluster-view container already
    //      shows that relationship visually, so the arrow is just noise.
    //      Cross-cluster hierarchy (e.g. a feature promoted to page) keeps
    //      its arrow.
    const scoped =
      drillNodeId === null || !scopedNodes
        ? edges
        : (() => {
            const visibleIds = new Set(scopedNodes.map((n) => n._id as string));
            return edges.filter(
              (e) =>
                visibleIds.has(e.sourceNodeId as string) &&
                visibleIds.has(e.targetNodeId as string),
            );
          })();

    if (!scopedNodes) return scoped;
    const nodesById = new Map(scopedNodes.map((n) => [n._id as string, n]));
    return scoped.filter((e) => {
      if (e.type !== 'hierarchy') return true;
      const target = nodesById.get(e.targetNodeId as string);
      if (!target?.parentId) return true;
      return (target.parentId as string) !== (e.sourceNodeId as string);
    });
  }, [edges, scopedNodes, drillNodeId]);

  const collapsedGraph = useMemo(() => {
    if (!scopedNodes || !scopedEdges) return undefined;
    return buildCollapsedGraph({
      nodes: scopedNodes,
      edges: scopedEdges,
      nodeSummaries: nodeSummaries ?? [],
      collapsedNodeIds,
    });
  }, [collapsedNodeIds, nodeSummaries, scopedEdges, scopedNodes]);

  const visibleNodes = collapsedGraph?.visibleNodes;
  const visibleEdges = collapsedGraph?.renderEdges;

  const edgePresentation = useMemo(() => {
    if (!visibleEdges) return undefined;
    const visibleFlow =
      selectedFlow && collapsedGraph
        ? {
            ...selectedFlow,
            nodeIds: Array.from(
              new Set(
                selectedFlow.nodeIds.map(
                  (nodeId) =>
                    (collapsedGraph.visibleNodeIdForNodeId.get(nodeId as string) ??
                      (nodeId as string)) as Id<'nodes'>,
                ),
              ),
            ),
            edgeRefs: selectedFlow.edgeRefs
              ?.map((ref) => {
                const sourceNodeId = ref.sourceNodeId
                  ? ((collapsedGraph.visibleNodeIdForNodeId.get(ref.sourceNodeId as string) ??
                      (ref.sourceNodeId as string)) as Id<'nodes'>)
                  : undefined;
                const targetNodeId = ref.targetNodeId
                  ? ((collapsedGraph.visibleNodeIdForNodeId.get(ref.targetNodeId as string) ??
                      (ref.targetNodeId as string)) as Id<'nodes'>)
                  : undefined;
                return { ...ref, sourceNodeId, targetNodeId };
              })
              .filter(
                (ref) =>
                  !ref.sourceNodeId || !ref.targetNodeId || ref.sourceNodeId !== ref.targetNodeId,
              ),
          }
        : selectedFlow;
    return getCanvasEdgePresentation(visibleEdges, edgeMode, visibleFlow);
  }, [collapsedGraph, edgeMode, selectedFlow, visibleEdges]);

  const highlightMode = useMemo<HighlightMode | undefined>(() => {
    if (!edgePresentation?.hasFocus || !edgePresentation.highlightedEdgeIds) return undefined;
    return {
      edgeIds: edgePresentation.highlightedEdgeIds,
      hasFocus: edgePresentation.hasFocus,
    };
  }, [edgePresentation]);

  const highlightedNodeIds = useMemo<Set<string> | undefined>(() => {
    if (!edgePresentation?.hasFocus || !edgePresentation.highlightedNodeIds) return undefined;
    const out = new Set<string>();
    for (const nodeId of edgePresentation.highlightedNodeIds) {
      out.add(collapsedGraph?.visibleNodeIdForNodeId.get(nodeId) ?? nodeId);
    }
    return out;
  }, [collapsedGraph?.visibleNodeIdForNodeId, edgePresentation]);

  const summaryByNode = useMemo(() => {
    return new Map((nodeSummaries ?? []).map((summary) => [summary.nodeId, summary]));
  }, [nodeSummaries]);

  const edgeCountByNode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of edges ?? []) {
      const source = edge.sourceNodeId as string;
      const target = edge.targetNodeId as string;
      counts.set(source, (counts.get(source) ?? 0) + 1);
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    return counts;
  }, [edges]);

  const [rfNodes, setRfNodes, onNodesChangeInternal] = useNodesState<ArchNode>([]);
  const [rfEdges, setRfEdges, onEdgesChangeInternal] = useEdgesState<Edge>([]);

  const edgesRef = useRef<RenderEdge[] | undefined>(visibleEdges);
  edgesRef.current = visibleEdges;
  // Mirror of visibleNodes so the drag-stop handler can convert a child's
  // relative position back to absolute by looking up its parent's
  // current Convex position. Reading from `rfNodes` would couple the
  // callback to its own re-render cycle; the ref keeps it stable.
  const nodesRef = useRef<Doc<'nodes'>[] | undefined>(visibleNodes);
  nodesRef.current = visibleNodes;

  const draggingRef = useRef(false);

  const prevNodeCountRef = useRef<number | null>(null);
  const prevEdgeCountRef = useRef<number | null>(null);
  const nodesWipeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgesWipeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visibleNodes) return;
    if (draggingRef.current) return;

    if (nodesWipeTimerRef.current) {
      clearTimeout(nodesWipeTimerRef.current);
      nodesWipeTimerRef.current = null;
    }

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
    setRfNodes(
      buildRfNodes(
        projectId,
        visibleNodes,
        highlightedNodeIds,
        summaryByNode,
        edgeCountByNode,
        collapsedGraph?.collapsedStats ?? new Map(),
        collapsedNodeIds,
        relatedFlowCounts,
      ),
    );
  }, [
    collapsedGraph?.collapsedStats,
    collapsedNodeIds,
    edgeCountByNode,
    highlightedNodeIds,
    projectId,
    relatedFlowCounts,
    setRfNodes,
    summaryByNode,
    visibleNodes,
  ]);

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

    const presentedEdges = edgePresentation?.edges ?? visibleEdges;
    prevEdgeCountRef.current = presentedEdges.length;
    setRfEdges(presentedEdges.map((edge) => convexEdgeToRf(edge, highlightMode)));
  }, [edgePresentation, visibleEdges, highlightMode, setRfEdges]);

  useEffect(() => {
    return () => {
      if (nodesWipeTimerRef.current) clearTimeout(nodesWipeTimerRef.current);
      if (edgesWipeTimerRef.current) clearTimeout(edgesWipeTimerRef.current);
    };
  }, []);

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
          continue;
        }
        if ((backing._id as string).startsWith('aggregate:')) continue;
        removeEdgeMutation({ id: backing._id as Id<'nodeEdges'> });
        filtered.push(change);
      }
      onEdgesChangeInternal(filtered);
    },
    [onEdgesChangeInternal, removeEdgeMutation],
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: ArchNode) => {
      const nodeId = node.id as Id<'nodes'>;
      // For child nodes (rendered with a parentId), `node.position` is
      // relative to the parent. Convex stores absolutes — convert back
      // using the parent's current server position.
      let absX = node.position.x;
      let absY = node.position.y;
      if (node.parentId) {
        const parent = nodesRef.current?.find((n) => (n._id as string) === node.parentId);
        if (parent) {
          absX += parent.positionX;
          absY += parent.positionY;
        }
      }
      updateMutation({
        id: nodeId,
        positionX: Math.round(absX),
        positionY: Math.round(absY),
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
