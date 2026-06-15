import {
  FEATURE_NODE_DEFAULT_HEIGHT,
  FEATURE_NODE_DEFAULT_WIDTH,
  PAGE_NODE_DEFAULT_WIDTH,
} from './nodes';

export const ARCH_LAYER_WIDTH = 280;
export const ARCH_LAYER_COMPACT_WIDTH = 112;
export const ARCH_LAYER_GAP = 28;
export const ARCH_LAYER_PADDING_X = 30;
export const ARCH_LAYER_HEADER_HEIGHT = 72;
export const ARCH_LAYER_NODE_TOP = 120;
export const ARCH_LAYER_NODE_SPACING = 150;
export const ARCH_LAYER_PARENT_GAP_Y = 92;
export const ARCH_LAYER_FEATURE_OFFSET_X = 42;
export const ARCH_LAYER_FEATURE_OFFSET_Y = 66;
export const ARCH_LAYER_FEATURE_GAP_Y = 18;

export type ArchLayerLike = {
  _id: string;
  position: number;
};

export type ArchLayerUsage = {
  nodeCount: number;
  topLevelCount: number;
  semanticKinds: string[];
  isEmpty: boolean;
};

export type ArchLayerGeometry<TLayer extends ArchLayerLike = ArchLayerLike> = {
  layer: TLayer;
  index: number;
  left: number;
  width: number;
  nodeCount: number;
  isCompact: boolean;
};

export type ArchLayoutNodeLike = {
  _id: string;
  type: 'page' | 'feature';
  parentId?: string | null;
  layerId?: string;
  positionX: number;
  positionY: number;
  _creationTime?: number;
};

export function sortArchLayers<T extends ArchLayerLike>(layers: readonly T[] | undefined): T[] {
  return [...(layers ?? [])].sort((a, b) => a.position - b.position);
}

export function getArchLayerX(index: number) {
  return index * (ARCH_LAYER_WIDTH + ARCH_LAYER_GAP);
}

export function getArchLayerNodeX(index: number) {
  return getArchLayerX(index) + ARCH_LAYER_PADDING_X;
}

export function computeArchLayerUsage<
  TLayer extends ArchLayerLike,
  TNode extends ArchLayoutNodeLike & { semanticKind?: string },
>(layers: readonly TLayer[] | undefined, nodes: readonly TNode[] | undefined) {
  const sortedLayers = sortArchLayers(layers);
  const usage = new Map<string, ArchLayerUsage>();
  for (const layer of sortedLayers) {
    usage.set(layer._id, {
      nodeCount: 0,
      topLevelCount: 0,
      semanticKinds: [],
      isEmpty: true,
    });
  }
  if (sortedLayers.length === 0) return usage;

  const semanticKindsByLayer = new Map<string, Set<string>>();
  for (const node of nodes ?? []) {
    const layerIndex = getArchLayerIndex(sortedLayers, node.layerId);
    const layer = sortedLayers[layerIndex] ?? sortedLayers[0]!;
    const row = usage.get(layer._id);
    if (!row) continue;
    row.nodeCount += 1;
    if (!node.parentId) row.topLevelCount += 1;
    if (node.semanticKind) {
      const kinds = semanticKindsByLayer.get(layer._id) ?? new Set<string>();
      kinds.add(node.semanticKind);
      semanticKindsByLayer.set(layer._id, kinds);
    }
  }

  for (const [layerId, row] of usage.entries()) {
    row.semanticKinds = [...(semanticKindsByLayer.get(layerId) ?? [])].sort();
    row.isEmpty = row.nodeCount === 0;
  }

  return usage;
}

export function computeArchLayerGeometry<TLayer extends ArchLayerLike>({
  layers,
  usage,
  compactEmpty = false,
}: {
  layers: readonly TLayer[] | undefined;
  usage?: ReadonlyMap<string, Pick<ArchLayerUsage, 'nodeCount' | 'isEmpty'>>;
  compactEmpty?: boolean;
}) {
  const sortedLayers = sortArchLayers(layers);
  const geometry: ArchLayerGeometry<TLayer>[] = [];
  let left = 0;

  sortedLayers.forEach((layer, index) => {
    const row = usage?.get(layer._id);
    const nodeCount = row?.nodeCount ?? 0;
    const isEmpty = row?.isEmpty ?? nodeCount === 0;
    const isCompact = compactEmpty && isEmpty;
    const width = isCompact ? ARCH_LAYER_COMPACT_WIDTH : ARCH_LAYER_WIDTH;
    geometry.push({
      layer,
      index,
      left,
      width,
      nodeCount,
      isCompact,
    });
    left += width + ARCH_LAYER_GAP;
  });

  return geometry;
}

export function getArchLayerCanvasWidth<TLayer extends ArchLayerLike>(
  geometry: readonly ArchLayerGeometry<TLayer>[],
) {
  if (geometry.length === 0) return 0;
  const last = geometry[geometry.length - 1]!;
  return last.left + last.width;
}

export function getArchLayerIndex<T extends ArchLayerLike>(
  layers: readonly T[],
  layerId: string | undefined,
) {
  const index = layers.findIndex((layer) => layer._id === layerId);
  return index >= 0 ? index : 0;
}

export function getLayerFeaturePosition(
  parentPosition: {
    positionX: number;
    positionY: number;
  },
  index: number,
) {
  return {
    positionX: Math.round(parentPosition.positionX + ARCH_LAYER_FEATURE_OFFSET_X),
    positionY: Math.round(
      parentPosition.positionY +
        ARCH_LAYER_FEATURE_OFFSET_Y +
        index * (FEATURE_NODE_DEFAULT_HEIGHT + ARCH_LAYER_FEATURE_GAP_Y),
    ),
  };
}

export function estimateLayerClusterHeight(childCount: number) {
  if (childCount <= 0) return ARCH_LAYER_NODE_SPACING;
  return (
    ARCH_LAYER_FEATURE_OFFSET_Y +
    childCount * FEATURE_NODE_DEFAULT_HEIGHT +
    Math.max(0, childCount - 1) * ARCH_LAYER_FEATURE_GAP_Y +
    ARCH_LAYER_PARENT_GAP_Y
  );
}

export function getLayerNodePosition<
  TLayer extends ArchLayerLike,
  TNode extends ArchLayoutNodeLike & { semanticKind?: string },
>({
  layers,
  nodes,
  layerId,
  compactEmpty = true,
}: {
  layers: readonly TLayer[];
  nodes: readonly TNode[];
  layerId: string;
  compactEmpty?: boolean;
}) {
  const sortedLayers = sortArchLayers(layers);
  const layerIndex = getArchLayerIndex(sortedLayers, layerId);
  const siblingCount = nodes.filter((node) => !node.parentId && node.layerId === layerId).length;
  const usage = computeArchLayerUsage(sortedLayers, nodes);
  const geometry = computeArchLayerGeometry({ layers: sortedLayers, usage, compactEmpty });
  const layerLeft = geometry[layerIndex]?.left ?? getArchLayerX(layerIndex);

  return {
    positionX: Math.round(layerLeft + ARCH_LAYER_PADDING_X),
    positionY: Math.round(ARCH_LAYER_NODE_TOP + siblingCount * ARCH_LAYER_NODE_SPACING),
  };
}

export function computeArchLayerLayout<
  TLayer extends ArchLayerLike,
  TNode extends ArchLayoutNodeLike & { semanticKind?: string },
>(layers: readonly TLayer[], nodes: readonly TNode[], options?: { compactEmpty?: boolean }) {
  const sortedLayers = sortArchLayers(layers);
  if (sortedLayers.length === 0) return [];
  const compactEmpty = options?.compactEmpty ?? true;
  const usage = computeArchLayerUsage(sortedLayers, nodes);
  const geometry = computeArchLayerGeometry({ layers: sortedLayers, usage, compactEmpty });

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
    const layerIndex = getArchLayerIndex(sortedLayers, node.layerId);
    const layer = sortedLayers[layerIndex] ?? sortedLayers[0]!;
    const nextY = nextYByLayer.get(layer._id) ?? ARCH_LAYER_NODE_TOP;
    const layerLeft = geometry[layerIndex]?.left ?? getArchLayerX(layerIndex);
    const position = {
      positionX: Math.round(layerLeft + ARCH_LAYER_PADDING_X),
      positionY: Math.round(nextY),
    };
    placed.set(node._id, position);
    nextYByLayer.set(
      layer._id,
      nextY +
        Math.max(
          ARCH_LAYER_NODE_SPACING,
          estimateLayerClusterHeight(childrenByParent.get(node._id)?.length ?? 0),
        ),
    );
  }

  for (const [parentId, children] of childrenByParent.entries()) {
    const parent = parentById.get(parentId);
    const parentPosition = placed.get(parentId) ?? {
      positionX: parent?.positionX ?? getArchLayerNodeX(0),
      positionY: parent?.positionY ?? ARCH_LAYER_NODE_TOP,
    };

    const sortedChildren = [...children].sort(
      (a, b) => (a._creationTime ?? 0) - (b._creationTime ?? 0) || a._id.localeCompare(b._id),
    );
    sortedChildren.forEach((child, index) => {
      placed.set(child._id, getLayerFeaturePosition(parentPosition, index));
    });
  }

  return [...placed.entries()].map(([id, position]) => ({ id, ...position }));
}

export const ARCH_LAYER_CANVAS_HEIGHT = 2200;
export const ARCH_LAYER_CANVAS_TOP = -120;
export const ARCH_LAYER_CONTENT_WIDTH = PAGE_NODE_DEFAULT_WIDTH + ARCH_LAYER_PADDING_X * 2;
export const ARCH_LAYER_MAX_CLUSTER_WIDTH =
  ARCH_LAYER_FEATURE_OFFSET_X + FEATURE_NODE_DEFAULT_WIDTH + ARCH_LAYER_PADDING_X;
