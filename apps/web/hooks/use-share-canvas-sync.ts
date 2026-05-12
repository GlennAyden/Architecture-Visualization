'use client';

import { useEffect } from 'react';
import type { Editor, TLShapeId } from 'tldraw';
import {
  FEATURE_NODE_DEFAULT_HEIGHT,
  FEATURE_NODE_DEFAULT_WIDTH,
  PAGE_NODE_DEFAULT_HEIGHT,
  PAGE_NODE_DEFAULT_WIDTH,
} from '@arch-viz/shared';

// Local payload shapes — mirrors what `api.shareView.get` returns. Cannot
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

const MANAGED_TYPES = new Set(['page-node', 'feature-node']);
const EDGE_ARROW_PREFIX = 'shape:edge:';

// Per-type styling for edge arrows. Duplicated from `use-canvas-sync.ts`
// (Rule 3: surgical duplication beats a premature shared util). Keep keys
// aligned with the schema's `nodeEdges.type` union.
type EdgeType = ShareEdge['type'];
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

function nodeIdToShapeId(nodeId: string): TLShapeId {
  return `shape:${nodeId}` as TLShapeId;
}

function edgeIdToArrowShapeId(edgeId: string): TLShapeId {
  return `${EDGE_ARROW_PREFIX}${edgeId}` as TLShapeId;
}

function createEdgeArrow(editor: Editor, edge: ShareEdge): void {
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

function shapeTypeFor(node: ShareNode): 'page-node' | 'feature-node' {
  return node.type === 'feature' ? 'feature-node' : 'page-node';
}

function shapePropsFor(node: ShareNode, parentName: string | null) {
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
  nodes: ShareNode[] | undefined;
  edges: ShareEdge[] | undefined;
}

/**
 * Read-only counterpart to `use-canvas-sync.ts`. Reconciles the share-view
 * payload into the tldraw editor (one-way: payload → editor) and flips the
 * editor into read-only mode so viewers can pan/zoom but cannot move,
 * delete, draw arrows, or otherwise mutate. There is intentionally NO
 * `editor.store.listen` block — the share view dispatches zero mutations.
 */
export function useShareCanvasSync({ editor, nodes, edges }: Args) {
  // Flip the editor into read-only mode as soon as we have one. tldraw 5
  // gates input + tools off `instanceState.isReadonly`; this disables
  // shape selection bound mutations, deletes, drags, and tool-driven
  // arrow drawing while still allowing camera pan / zoom.
  useEffect(() => {
    if (!editor) return;
    editor.updateInstanceState({ isReadonly: true });
  }, [editor]);

  // Payload -> editor: reconcile node shapes whenever `nodes` changes.
  useEffect(() => {
    if (!editor || !nodes) return;

    const desiredById = new Map(nodes.map((n) => [nodeIdToShapeId(n._id), n]));
    const nodesById = new Map(nodes.map((n) => [n._id, n]));
    const existingShapes = editor
      .getCurrentPageShapes()
      .filter((s) => MANAGED_TYPES.has(s.type));
    const existingIds = new Set(existingShapes.map((s) => s.id));

    const toDelete = existingShapes.filter((s) => !desiredById.has(s.id));
    if (toDelete.length > 0) editor.deleteShapes(toDelete.map((s) => s.id));

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
  }, [editor, nodes]);

  // Payload -> editor: reconcile arrows for edges. Runs after the nodes
  // effect (declaration order) so source/target shapes already exist when
  // bindings reference them.
  useEffect(() => {
    if (!editor || !nodes || !edges) return;
    const nodeIdSet = new Set(nodes.map((n) => n._id));

    const desiredArrowIds = new Set<string>();
    for (const edge of edges) {
      if (!nodeIdSet.has(edge.sourceNodeId)) continue;
      if (!nodeIdSet.has(edge.targetNodeId)) continue;

      const arrowId = edgeIdToArrowShapeId(edge._id);
      desiredArrowIds.add(arrowId);

      const existing = editor.getShape(arrowId);
      if (!existing) {
        createEdgeArrow(editor, edge);
        continue;
      }

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

    const existingArrows = editor
      .getCurrentPageShapes()
      .filter((s) => s.type === 'arrow' && s.id.startsWith(EDGE_ARROW_PREFIX));
    const toRemove = existingArrows.filter((s) => !desiredArrowIds.has(s.id));
    if (toRemove.length > 0) editor.deleteShapes(toRemove.map((s) => s.id));
  }, [editor, nodes, edges]);
}
