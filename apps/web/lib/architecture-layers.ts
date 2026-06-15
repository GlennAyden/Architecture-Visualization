import {
  ARCH_LAYER_CANVAS_HEIGHT,
  ARCH_LAYER_CANVAS_TOP,
  ARCH_LAYER_CONTENT_WIDTH,
  ARCH_LAYER_FEATURE_GAP_Y,
  ARCH_LAYER_FEATURE_OFFSET_X,
  ARCH_LAYER_FEATURE_OFFSET_Y,
  ARCH_LAYER_GAP,
  ARCH_LAYER_HEADER_HEIGHT,
  ARCH_LAYER_NODE_SPACING,
  ARCH_LAYER_NODE_TOP,
  ARCH_LAYER_PADDING_X,
  ARCH_LAYER_PARENT_GAP_Y,
  ARCH_LAYER_WIDTH,
  computeArchLayerLayout,
  estimateLayerClusterHeight,
  getArchLayerIndex,
  getArchLayerNodeX,
  getArchLayerX,
  getLayerFeaturePosition,
  getLayerNodePosition,
  sortArchLayers,
  type ArchLayerLike,
  type ArchLayoutNodeLike,
} from '@arch-viz/shared';

export const LAYER_WIDTH = ARCH_LAYER_WIDTH;
export const LAYER_GAP = ARCH_LAYER_GAP;
export const LAYER_PADDING_X = ARCH_LAYER_PADDING_X;
export const LAYER_HEADER_HEIGHT = ARCH_LAYER_HEADER_HEIGHT;
export const LAYER_NODE_TOP = ARCH_LAYER_NODE_TOP;
export const LAYER_NODE_SPACING = ARCH_LAYER_NODE_SPACING;
export const LAYER_PARENT_GAP_Y = ARCH_LAYER_PARENT_GAP_Y;
export const LAYER_FEATURE_OFFSET_X = ARCH_LAYER_FEATURE_OFFSET_X;
export const LAYER_FEATURE_OFFSET_Y = ARCH_LAYER_FEATURE_OFFSET_Y;
export const LAYER_FEATURE_GAP_Y = ARCH_LAYER_FEATURE_GAP_Y;
export const LAYER_CANVAS_HEIGHT = ARCH_LAYER_CANVAS_HEIGHT;
export const LAYER_CANVAS_TOP = ARCH_LAYER_CANVAS_TOP;
export const LAYER_CONTENT_WIDTH = ARCH_LAYER_CONTENT_WIDTH;

type LayerLike = ArchLayerLike;
type NodeLike = ArchLayoutNodeLike;

export function sortLayers<T extends LayerLike>(layers: readonly T[] | undefined): T[] {
  return sortArchLayers(layers);
}

export function getLayerX(index: number) {
  return getArchLayerX(index);
}

export function getLayerNodeX(index: number) {
  return getArchLayerNodeX(index);
}

export function getLayerIndex<T extends LayerLike>(
  layers: readonly T[],
  layerId: string | undefined,
) {
  return getArchLayerIndex(layers, layerId);
}

export function getNextNodePosition<TLayer extends LayerLike, TNode extends NodeLike>(args: {
  layers: readonly TLayer[];
  nodes: readonly TNode[];
  layerId: string;
}) {
  return getLayerNodePosition(args);
}

export function getNextFeaturePosition<TNode extends NodeLike>({
  nodes,
  parent,
}: {
  nodes: readonly TNode[];
  parent: TNode;
}) {
  const siblingCount = nodes.filter((node) => node.parentId === parent._id).length;
  return getLayerFeaturePosition(parent, siblingCount);
}

export function computeLayerLayout<TLayer extends LayerLike, TNode extends NodeLike>(
  layers: readonly TLayer[],
  nodes: readonly TNode[],
) {
  return computeArchLayerLayout(layers, nodes);
}

export { estimateLayerClusterHeight };
