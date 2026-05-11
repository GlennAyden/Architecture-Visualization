'use client';

import { useEffect, useRef } from 'react';
import { useMutation } from 'convex/react';
import type { Editor, TLShapeId } from 'tldraw';
import {
  FEATURE_NODE_DEFAULT_HEIGHT,
  FEATURE_NODE_DEFAULT_WIDTH,
  PAGE_NODE_DEFAULT_HEIGHT,
  PAGE_NODE_DEFAULT_WIDTH,
} from '@arch-viz/shared';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';

const DEBOUNCE_MS = 250;
const MANAGED_TYPES = new Set(['page-node', 'feature-node']);
const EDGE_ARROW_PREFIX = 'shape:edge:';

// Per-type styling for edge arrows. Keep keys aligned with the schema's
// `nodeEdges.type` union; tldraw 5's arrow shape rejects unknown values, so
// stick to the documented `DefaultColorStyle` / arrowhead enums.
type EdgeType = Doc<'nodeEdges'>['type'];
type EdgeArrowStyle = {
  dash: 'solid' | 'dashed' | 'dotted' | 'draw';
  color: 'grey' | 'light-blue' | 'orange';
  size: 's' | 'm' | 'l' | 'xl';
  arrowheadStart: 'arrow' | 'triangle' | 'none' | 'dot' | 'pipe';
  arrowheadEnd: 'arrow' | 'triangle' | 'none' | 'dot' | 'pipe';
};
const EDGE_STYLE_BY_TYPE: Record<EdgeType, EdgeArrowStyle> = {
  hierarchy: {
    dash: 'solid',
    color: 'grey',
    size: 'm',
    arrowheadStart: 'none',
    arrowheadEnd: 'arrow',
  },
  dependency: {
    dash: 'dashed',
    color: 'grey',
    size: 's',
    arrowheadStart: 'none',
    arrowheadEnd: 'arrow',
  },
  navigation: {
    dash: 'solid',
    color: 'light-blue',
    size: 'm',
    arrowheadStart: 'none',
    arrowheadEnd: 'triangle',
  },
  data_flow: {
    dash: 'dotted',
    color: 'orange',
    size: 'm',
    arrowheadStart: 'none',
    arrowheadEnd: 'arrow',
  },
};

function nodeIdToShapeId(nodeId: Id<'nodes'>): TLShapeId {
  return `shape:${nodeId}` as TLShapeId;
}

function shapeIdToNodeId(shapeId: TLShapeId): Id<'nodes'> | null {
  const prefix = 'shape:';
  if (!shapeId.startsWith(prefix)) return null;
  // Edge arrows live in the same `shape:` namespace but with a sub-prefix —
  // exclude them so an arrow delete doesn't trigger a node remove mutation.
  if (shapeId.startsWith(EDGE_ARROW_PREFIX)) return null;
  return shapeId.slice(prefix.length) as Id<'nodes'>;
}

function edgeIdToArrowShapeId(edgeId: Id<'nodeEdges'>): TLShapeId {
  return `${EDGE_ARROW_PREFIX}${edgeId}` as TLShapeId;
}

function shapeIdToEdgeId(shapeId: string): Id<'nodeEdges'> | null {
  if (!shapeId.startsWith(EDGE_ARROW_PREFIX)) return null;
  return shapeId.slice(EDGE_ARROW_PREFIX.length) as Id<'nodeEdges'>;
}

/**
 * Creates the arrow shape + start/end bindings for an edge. Assumes the
 * caller has set `applyingRemoteRef.current = true` so the echoing
 * editor events don't loop back into a mutation. Also assumes both
 * endpoint shapes already exist on the page.
 */
function createEdgeArrow(editor: Editor, edge: Doc<'nodeEdges'>): void {
  const arrowId = edgeIdToArrowShapeId(edge._id);
  const style = EDGE_STYLE_BY_TYPE[edge.type];
  editor.createShape({
    id: arrowId,
    type: 'arrow',
    x: 0,
    y: 0,
    props: style,
  });
  editor.createBinding({
    type: 'arrow',
    fromId: arrowId,
    toId: nodeIdToShapeId(edge.sourceNodeId),
    props: {
      terminal: 'start',
      normalizedAnchor: { x: 0.5, y: 0.5 },
      isExact: false,
      isPrecise: false,
      snap: 'none',
    },
  });
  editor.createBinding({
    type: 'arrow',
    fromId: arrowId,
    toId: nodeIdToShapeId(edge.targetNodeId),
    props: {
      terminal: 'end',
      normalizedAnchor: { x: 0.5, y: 0.5 },
      isExact: false,
      isPrecise: false,
      snap: 'none',
    },
  });
}

function shapeTypeFor(node: Doc<'nodes'>): 'page-node' | 'feature-node' {
  return node.type === 'feature' ? 'feature-node' : 'page-node';
}

function shapePropsFor(node: Doc<'nodes'>, parentName: string | null) {
  if (node.type === 'feature') {
    return {
      name: node.name,
      parentName,
      w: FEATURE_NODE_DEFAULT_WIDTH,
      h: FEATURE_NODE_DEFAULT_HEIGHT,
    };
  }
  return {
    name: node.name,
    w: PAGE_NODE_DEFAULT_WIDTH,
    h: PAGE_NODE_DEFAULT_HEIGHT,
  };
}

interface Args {
  editor: Editor | null;
  nodes: Doc<'nodes'>[] | undefined;
  edges: Doc<'nodeEdges'>[] | undefined;
}

/**
 * Reconciles Convex `nodes` state with the tldraw editor's shapes (one-way:
 * Convex → editor) and pipes user-driven editor changes back to Convex
 * (other way: editor → Convex via mutations).
 *
 * `applyingRemoteRef` guards against echo: when we mutate the editor in
 * response to a Convex change, the editor fires update events; we must
 * ignore those so we don't loop.
 */
export function useCanvasSync({ editor, nodes, edges }: Args) {
  const updateMutation = useMutation(api.nodes.update);
  const removeMutation = useMutation(api.nodes.remove);
  const removeEdgeMutation = useMutation(api.nodeEdges.remove);

  const applyingRemoteRef = useRef(false);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Latest edges snapshot, mirrored into a ref so the editor.store listener
  // (which is installed once per editor) can read the current edge map
  // without forcing a re-subscribe on every edge change.
  const edgesRef = useRef<Doc<'nodeEdges'>[] | undefined>(edges);
  edgesRef.current = edges;

  // Convex -> editor: reconcile shapes whenever `nodes` changes.
  useEffect(() => {
    if (!editor || !nodes) return;

    applyingRemoteRef.current = true;
    try {
      const desiredById = new Map(nodes.map((n) => [nodeIdToShapeId(n._id), n]));
      const nodesById = new Map(nodes.map((n) => [n._id, n]));
      const existingShapes = editor
        .getCurrentPageShapes()
        .filter((s) => MANAGED_TYPES.has(s.type));
      const existingIds = new Set(existingShapes.map((s) => s.id));

      // Remove shapes whose backing node has been deleted.
      const toDelete = existingShapes.filter((s) => !desiredById.has(s.id));
      if (toDelete.length > 0) editor.deleteShapes(toDelete.map((s) => s.id));

      // Create shapes for new nodes; patch shapes whose position / name / parent changed.
      for (const node of nodes) {
        const shapeId = nodeIdToShapeId(node._id);
        const type = shapeTypeFor(node);
        const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
        const parentName = parent?.name ?? null;
        const props = shapePropsFor(node, parentName);

        if (!existingIds.has(shapeId)) {
          editor.createShape({
            id: shapeId,
            type,
            x: node.positionX,
            y: node.positionY,
            props,
          });
        } else {
          const current = editor.getShape(shapeId);
          if (!current) continue;
          // Shape type may have changed (page <-> feature). Replace by
          // delete + create rather than trying to mutate type in place.
          if (current.type !== type) {
            editor.deleteShapes([shapeId]);
            editor.createShape({
              id: shapeId,
              type,
              x: node.positionX,
              y: node.positionY,
              props,
            });
            continue;
          }
          const curProps = current.props as Record<string, unknown>;
          const drifted =
            current.x !== node.positionX ||
            current.y !== node.positionY ||
            curProps.name !== node.name ||
            (type === 'feature-node' && curProps.parentName !== parentName);
          if (drifted) {
            editor.updateShape({
              id: shapeId,
              type,
              x: node.positionX,
              y: node.positionY,
              props,
            });
          }
        }
      }
    } finally {
      // Defer the flag flip so the synchronous tldraw events fired during
      // the calls above are still treated as remote.
      queueMicrotask(() => {
        applyingRemoteRef.current = false;
      });
    }
  }, [editor, nodes]);

  // Convex -> editor: reconcile arrow shapes for hierarchy edges. Runs AFTER
  // the nodes effect (declaration order) so source/target shapes exist before
  // bindings reference them. We render arrows with tldraw bindings so they
  // track node moves without our intervention.
  useEffect(() => {
    if (!editor || !nodes || !edges) return;
    const nodeIdSet = new Set(nodes.map((n) => n._id as string));

    applyingRemoteRef.current = true;
    try {
      const desiredArrowIds = new Set<string>();
      for (const edge of edges) {
        // Defensive: an edge that points at a node not yet in the nodes
        // snapshot (stale subscription) will produce a dangling arrow. Skip
        // and let the next reconcile retry.
        if (!nodeIdSet.has(edge.sourceNodeId as string)) continue;
        if (!nodeIdSet.has(edge.targetNodeId as string)) continue;

        const arrowId = edgeIdToArrowShapeId(edge._id);
        desiredArrowIds.add(arrowId);

        const existing = editor.getShape(arrowId);
        if (!existing) {
          createEdgeArrow(editor, edge);
          continue;
        }

        // Sprint 3: each edge type has a distinct visual. Defensive — if the
        // type swapped (or this edge was rendered before the styling map
        // existed), patch the affected props back into shape.
        const style = EDGE_STYLE_BY_TYPE[edge.type];
        const curProps = existing.props as Record<string, unknown>;
        const styleDrifted =
          curProps.dash !== style.dash ||
          curProps.color !== style.color ||
          curProps.size !== style.size ||
          curProps.arrowheadStart !== style.arrowheadStart ||
          curProps.arrowheadEnd !== style.arrowheadEnd;
        if (styleDrifted) {
          editor.updateShape({
            id: arrowId,
            type: 'arrow',
            props: style,
          });
        }
      }

      // Remove arrows whose backing edge has been deleted.
      const existingArrows = editor
        .getCurrentPageShapes()
        .filter((s) => s.type === 'arrow' && s.id.startsWith(EDGE_ARROW_PREFIX));
      const toRemove = existingArrows.filter((s) => !desiredArrowIds.has(s.id));
      if (toRemove.length > 0) editor.deleteShapes(toRemove.map((s) => s.id));
    } finally {
      queueMicrotask(() => {
        applyingRemoteRef.current = false;
      });
    }
  }, [editor, nodes, edges]);

  // Editor -> Convex: listen for user moves and deletions.
  useEffect(() => {
    if (!editor) return;

    const unsubscribe = editor.store.listen(
      (entry) => {
        if (applyingRemoteRef.current) return;

        for (const id of Object.keys(entry.changes.removed)) {
          if (!id.startsWith('shape:')) continue;
          const shape = entry.changes.removed[id as keyof typeof entry.changes.removed];
          if (!shape || !('type' in shape)) continue;
          const shapeType = shape.type as string;

          if (MANAGED_TYPES.has(shapeType)) {
            const nodeId = shapeIdToNodeId(id as TLShapeId);
            if (nodeId) removeMutation({ id: nodeId });
            continue;
          }

          // Sprint 3: arrow delete → removeEdge. Hierarchy edges are
          // auto-mirrored from `parentId`, so we un-delete the arrow on
          // the spot instead of forwarding the removal.
          if (shapeType === 'arrow' && id.startsWith(EDGE_ARROW_PREFIX)) {
            const edgeId = shapeIdToEdgeId(id);
            if (!edgeId) continue;
            const edge = edgesRef.current?.find((e) => e._id === edgeId);
            if (!edge) {
              // Edge already gone server-side; nothing to do. Avoid calling
              // the mutation since it'd be a no-op anyway.
              continue;
            }
            if (edge.type === 'hierarchy') {
              // Recreate inside the remote guard so our own createShape /
              // createBinding events don't loop back through this listener.
              applyingRemoteRef.current = true;
              try {
                createEdgeArrow(editor, edge);
              } finally {
                queueMicrotask(() => {
                  applyingRemoteRef.current = false;
                });
              }
              continue;
            }
            removeEdgeMutation({ id: edgeId });
          }
        }

        for (const [id, [from, to]] of Object.entries(entry.changes.updated)) {
          if (!id.startsWith('shape:')) continue;
          if ('type' in from && !MANAGED_TYPES.has(from.type as string)) continue;
          const fromX = (from as { x?: number }).x;
          const fromY = (from as { y?: number }).y;
          const toX = (to as { x?: number }).x;
          const toY = (to as { y?: number }).y;
          if (fromX === toX && fromY === toY) continue;

          const nodeId = shapeIdToNodeId(id as TLShapeId);
          if (!nodeId || toX === undefined || toY === undefined) continue;

          const existing = debounceTimers.current.get(id);
          if (existing) clearTimeout(existing);
          const timer = setTimeout(() => {
            debounceTimers.current.delete(id);
            updateMutation({ id: nodeId, positionX: toX, positionY: toY });
          }, DEBOUNCE_MS);
          debounceTimers.current.set(id, timer);
        }
      },
      { source: 'user', scope: 'document' },
    );

    return () => {
      unsubscribe();
      const timers = debounceTimers.current;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [editor, updateMutation, removeMutation, removeEdgeMutation]);
}
