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

function nodeIdToShapeId(nodeId: Id<'nodes'>): TLShapeId {
  return `shape:${nodeId}` as TLShapeId;
}

function shapeIdToNodeId(shapeId: TLShapeId): Id<'nodes'> | null {
  const prefix = 'shape:';
  if (!shapeId.startsWith(prefix)) return null;
  return shapeId.slice(prefix.length) as Id<'nodes'>;
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
export function useCanvasSync({ editor, nodes }: Args) {
  const updateMutation = useMutation(api.nodes.update);
  const removeMutation = useMutation(api.nodes.remove);

  const applyingRemoteRef = useRef(false);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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

  // Editor -> Convex: listen for user moves and deletions.
  useEffect(() => {
    if (!editor) return;

    const unsubscribe = editor.store.listen(
      (entry) => {
        if (applyingRemoteRef.current) return;

        for (const id of Object.keys(entry.changes.removed)) {
          if (!id.startsWith('shape:')) continue;
          const shape = entry.changes.removed[id as keyof typeof entry.changes.removed];
          if (shape && 'type' in shape && MANAGED_TYPES.has(shape.type as string)) {
            const nodeId = shapeIdToNodeId(id as TLShapeId);
            if (nodeId) removeMutation({ id: nodeId });
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
  }, [editor, updateMutation, removeMutation]);
}
