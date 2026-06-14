import {
  FEATURE_NODE_DEFAULT_HEIGHT,
  FEATURE_NODE_DEFAULT_WIDTH,
  PAGE_NODE_DEFAULT_WIDTH,
} from '@arch-viz/shared';

export const LAYER_WIDTH = 280;
export const LAYER_GAP = 28;
export const LAYER_PADDING_X = 30;
export const LAYER_HEADER_HEIGHT = 72;
export const LAYER_NODE_TOP = 120;
export const LAYER_NODE_SPACING = 150;
export const LAYER_PARENT_GAP_Y = 92;
export const LAYER_FEATURE_OFFSET_X = 42;
export const LAYER_FEATURE_OFFSET_Y = 66;
export const LAYER_FEATURE_GAP_X = 22;
export const LAYER_FEATURE_GAP_Y = 18;

type LayerLike = {
  _id: string;
  position: number;
};

type NodeLike = {
  _id: string;
  type: 'page' | 'feature';
  parentId?: string | null;
  layerId?: string;
  positionX: number;
  positionY: number;
  _creationTime?: number;
};

export function sortLayers<T extends LayerLike>(layers: readonly T[] | undefined): T[] {
  return [...(layers ?? [])].sort((a, b) => a.position - b.position);
}

export function getLayerX(index: number) {
  return index * (LAYER_WIDTH + LAYER_GAP);
}

export function getLayerNodeX(index: number) {
  return getLayerX(index) + LAYER_PADDING_X;
}

export function getLayerIndex<T extends LayerLike>(
  layers: readonly T[],
  layerId: string | undefined,
) {
  const index = layers.findIndex((layer) => layer._id === layerId);
  return index >= 0 ? index : 0;
}

export function getNextNodePosition<TLayer extends LayerLike, TNode extends NodeLike>({
  layers,
  nodes,
  layerId,
}: {
  layers: readonly TLayer[];
  nodes: readonly TNode[];
  layerId: string;
}) {
  const sortedLayers = sortLayers(layers);
  const layerIndex = getLayerIndex(sortedLayers, layerId);
  const siblingCount = nodes.filter((node) => !node.parentId && node.layerId === layerId).length;

  return {
    positionX: Math.round(getLayerNodeX(layerIndex)),
    positionY: Math.round(LAYER_NODE_TOP + siblingCount * LAYER_NODE_SPACING),
  };
}

function estimateClusterHeight(childCount: number) {
  if (childCount <= 0) return LAYER_NODE_SPACING;
  const columns = 2;
  const rows = Math.ceil(childCount / columns);
  return (
    LAYER_FEATURE_OFFSET_Y +
    rows * FEATURE_NODE_DEFAULT_HEIGHT +
    Math.max(0, rows - 1) * LAYER_FEATURE_GAP_Y +
    LAYER_PARENT_GAP_Y
  );
}

export function getNextFeaturePosition<TNode extends NodeLike>({
  nodes,
  parent,
}: {
  nodes: readonly TNode[];
  parent: TNode;
}) {
  const siblingCount = nodes.filter((node) => node.parentId === parent._id).length;
  const col = siblingCount % 2;
  const row = Math.floor(siblingCount / 2);

  return {
    positionX: Math.round(
      parent.positionX +
        LAYER_FEATURE_OFFSET_X +
        col * (FEATURE_NODE_DEFAULT_WIDTH + LAYER_FEATURE_GAP_X),
    ),
    positionY: Math.round(
      parent.positionY +
        LAYER_FEATURE_OFFSET_Y +
        row * (FEATURE_NODE_DEFAULT_HEIGHT + LAYER_FEATURE_GAP_Y),
    ),
  };
}

export function computeLayerLayout<TLayer extends LayerLike, TNode extends NodeLike>(
  layers: readonly TLayer[],
  nodes: readonly TNode[],
) {
  const sortedLayers = sortLayers(layers);
  if (sortedLayers.length === 0) return [];

  const parentById = new Map(nodes.map((node) => [node._id, node]));
  const childrenByParent = new Map<string, TNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = childrenByParent.get(node.parentId) ?? [];
    list.push(node);
    childrenByParent.set(node.parentId, list);
  }

  const topLevel = nodes
    .filter((node) => !node.parentId)
    .sort(
      (a, b) =>
        (a.layerId ?? '').localeCompare(b.layerId ?? '') ||
        (a._creationTime ?? 0) - (b._creationTime ?? 0) ||
        a._id.localeCompare(b._id),
    );

  const placed = new Map<string, { positionX: number; positionY: number }>();
  const nextYByLayer = new Map<string, number>();

  for (const node of topLevel) {
    const layerIndex = getLayerIndex(sortedLayers, node.layerId);
    const layer = sortedLayers[layerIndex] ?? sortedLayers[0]!;
    const nextY = nextYByLayer.get(layer._id) ?? LAYER_NODE_TOP;
    const position = {
      positionX: Math.round(getLayerNodeX(layerIndex)),
      positionY: Math.round(nextY),
    };
    placed.set(node._id, position);
    nextYByLayer.set(
      layer._id,
      nextY +
        Math.max(
          LAYER_NODE_SPACING,
          estimateClusterHeight(childrenByParent.get(node._id)?.length ?? 0),
        ),
    );
  }

  for (const [parentId, children] of childrenByParent.entries()) {
    const parent = parentById.get(parentId);
    const parentPosition = placed.get(parentId) ?? {
      positionX: parent?.positionX ?? getLayerNodeX(0),
      positionY: parent?.positionY ?? LAYER_NODE_TOP,
    };

    const sortedChildren = [...children].sort(
      (a, b) => (a._creationTime ?? 0) - (b._creationTime ?? 0) || a._id.localeCompare(b._id),
    );
    sortedChildren.forEach((child, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      placed.set(child._id, {
        positionX: Math.round(
          parentPosition.positionX +
            LAYER_FEATURE_OFFSET_X +
            col * (FEATURE_NODE_DEFAULT_WIDTH + LAYER_FEATURE_GAP_X),
        ),
        positionY: Math.round(
          parentPosition.positionY +
            LAYER_FEATURE_OFFSET_Y +
            row * (FEATURE_NODE_DEFAULT_HEIGHT + LAYER_FEATURE_GAP_Y),
        ),
      });
    });
  }

  return [...placed.entries()].map(([id, position]) => ({ id, ...position }));
}

export const LAYER_CANVAS_HEIGHT = 2200;
export const LAYER_CANVAS_TOP = -120;
export const LAYER_CONTENT_WIDTH = PAGE_NODE_DEFAULT_WIDTH + LAYER_PADDING_X * 2;
