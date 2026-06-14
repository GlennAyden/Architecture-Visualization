import { FEATURE_NODE_DEFAULT_HEIGHT, FEATURE_NODE_DEFAULT_WIDTH } from '@arch-viz/shared';
import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';
import { backfillMissingNodeLayers, seedDefaultLayers } from '../projectLayers';

type LayerError = (message: string) => Error;

const LAYER_WIDTH = 280;
const LAYER_GAP = 28;
const LAYER_PADDING_X = 30;
const LAYER_NODE_TOP = 120;
const LAYER_NODE_SPACING = 150;
const LAYER_FEATURE_OFFSET_X = 42;
const LAYER_FEATURE_OFFSET_Y = 66;
const LAYER_FEATURE_GAP_X = 22;
const LAYER_FEATURE_GAP_Y = 18;

export async function getProjectLayers(ctx: MutationCtx, projectId: Id<'projects'>) {
  await seedDefaultLayers(ctx, projectId);
  await backfillMissingNodeLayers(ctx, projectId);
  return (
    await ctx.db
      .query('projectLayers')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect()
  ).sort((a, b) => a.position - b.position);
}

export async function resolveNodeLayer(
  ctx: MutationCtx,
  args: {
    projectId: Id<'projects'>;
    type: 'page' | 'feature';
    layerId?: Id<'projectLayers'>;
    parent?: Doc<'nodes'> | null;
    makeError?: LayerError;
  },
) {
  const makeError = args.makeError ?? ((message: string) => new Error(message));
  const layers = await getProjectLayers(ctx, args.projectId);
  const parent =
    args.parent && !args.parent.layerId ? await ctx.db.get(args.parent._id) : args.parent;
  const requestedLayer = args.layerId ? await ctx.db.get(args.layerId) : null;

  if (args.layerId && (!requestedLayer || requestedLayer.projectId !== args.projectId)) {
    throw makeError('Layer must belong to the same project');
  }

  if (parent?.layerId && args.layerId && parent.layerId !== args.layerId) {
    throw makeError('Feature must use the same layer as its parent');
  }

  if (parent?.layerId) return parent.layerId;
  if (requestedLayer) return requestedLayer._id;

  const surfaceLayer = layers.find((layer) => layer.name === 'Surfaces') ?? layers[0];
  const featureLayer =
    layers.find((layer) => layer.name === 'Application') ??
    layers.find((layer) => layer.name === 'Features') ??
    surfaceLayer;
  return (args.type === 'feature' ? featureLayer : surfaceLayer)?._id;
}

export function defaultNodePosition(args: {
  type: 'page' | 'feature';
  layer?: Doc<'projectLayers'> | null;
  parent?: Doc<'nodes'> | null;
  siblingCount: number;
}) {
  if (args.type === 'feature' && args.parent) {
    const col = args.siblingCount % 2;
    const row = Math.floor(args.siblingCount / 2);
    return {
      x:
        args.parent.positionX +
        LAYER_FEATURE_OFFSET_X +
        col * (FEATURE_NODE_DEFAULT_WIDTH + LAYER_FEATURE_GAP_X),
      y:
        args.parent.positionY +
        LAYER_FEATURE_OFFSET_Y +
        row * (FEATURE_NODE_DEFAULT_HEIGHT + LAYER_FEATURE_GAP_Y),
    };
  }

  const layerPosition = args.layer?.position ?? 0;
  return {
    x: layerPosition * (LAYER_WIDTH + LAYER_GAP) + LAYER_PADDING_X,
    y: LAYER_NODE_TOP + args.siblingCount * LAYER_NODE_SPACING,
  };
}
