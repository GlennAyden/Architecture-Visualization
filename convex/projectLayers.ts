import { v } from 'convex/values';
import { Id } from './_generated/dataModel';
import { MutationCtx, mutation, query } from './_generated/server';
import { getProjectIfAccessible, requireProjectAccess } from './lib/auth';
import { layerPurposeValidator } from './lib/semantic';

const DEFAULT_LAYERS = [
  {
    name: 'Surfaces',
    purpose: 'surfaces',
    description: 'User-facing pages, routes, and interaction surfaces.',
  },
  {
    name: 'UI Modules',
    purpose: 'ui_modules',
    description: 'Visible page sections, header controls, widgets, panels, and CTAs.',
  },
  {
    name: 'Product Capabilities',
    purpose: 'capabilities',
    description: 'Business functions such as onboarding, billing, notifications, and profile.',
  },
  {
    name: 'Application / API',
    purpose: 'application',
    description: 'Route handlers, server actions, app services, and product orchestration.',
  },
  {
    name: 'Data & State',
    purpose: 'data',
    description: 'Convex schema, queries, mutations, and persistence logic.',
  },
  {
    name: 'Agents / Automation',
    purpose: 'agents',
    description: 'Hermes, MCP, scanners, workers, and automation flows.',
  },
  {
    name: 'External Services',
    purpose: 'external',
    description: 'External services and third-party integration boundaries.',
  },
  {
    name: 'Infra / Delivery',
    purpose: 'infra',
    description: 'Deployment, configuration, VPS, Vercel, and delivery glue.',
  },
] as const;

function matchesLayer(
  layer: { name: string; purpose?: string },
  desired: (typeof DEFAULT_LAYERS)[number],
) {
  return (
    layer.purpose === desired.purpose ||
    layer.name.toLowerCase() === desired.name.toLowerCase() ||
    (desired.purpose === 'application' && layer.name.toLowerCase() === 'application') ||
    (desired.purpose === 'data' && layer.name.toLowerCase() === 'data') ||
    (desired.purpose === 'agents' && layer.name.toLowerCase() === 'agents') ||
    (desired.purpose === 'external' && layer.name.toLowerCase() === 'external') ||
    (desired.purpose === 'infra' && layer.name.toLowerCase() === 'infra')
  );
}

export async function seedDefaultLayers(ctx: MutationCtx, projectId: Id<'projects'>) {
  const existing = await ctx.db
    .query('projectLayers')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))
    .take(1);
  if (existing.length > 0) return;

  for (const [position, layer] of DEFAULT_LAYERS.entries()) {
    await ctx.db.insert('projectLayers', {
      projectId,
      name: layer.name,
      position,
      purpose: layer.purpose,
      description: layer.description,
    });
  }
}

export async function ensureProductLayers(ctx: MutationCtx, projectId: Id<'projects'>) {
  await seedDefaultLayers(ctx, projectId);
  let layers = (
    await ctx.db
      .query('projectLayers')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect()
  ).sort((a, b) => a.position - b.position);

  for (const [targetPosition, desired] of DEFAULT_LAYERS.entries()) {
    if (layers.some((layer) => matchesLayer(layer, desired))) continue;

    for (const layer of layers) {
      if (layer.position >= targetPosition) {
        await ctx.db.patch(layer._id, { position: layer.position + 1 });
      }
    }

    await ctx.db.insert('projectLayers', {
      projectId,
      name: desired.name,
      position: targetPosition,
      purpose: desired.purpose,
      description: desired.description,
    });

    layers = (
      await ctx.db
        .query('projectLayers')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    ).sort((a, b) => a.position - b.position);
  }
}

export async function backfillMissingNodeLayers(ctx: MutationCtx, projectId: Id<'projects'>) {
  const layers = (
    await ctx.db
      .query('projectLayers')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect()
  ).sort((a, b) => a.position - b.position);
  if (layers.length === 0) return;

  const surfaceLayer = layers.find((layer) => layer.name === 'Surfaces') ?? layers[0]!;
  const featureLayer =
    layers.find((layer) => layer.name === 'Application') ??
    layers.find((layer) => layer.name === 'Features') ??
    surfaceLayer;
  const nodes = await ctx.db
    .query('nodes')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))
    .collect();
  const layerByNode = new Map(nodes.map((node) => [node._id, node.layerId]));

  for (const node of nodes) {
    if (node.parentId || node.layerId) continue;
    const layerId = node.type === 'feature' ? featureLayer._id : surfaceLayer._id;
    await ctx.db.patch(node._id, { layerId });
    layerByNode.set(node._id, layerId);
  }

  for (const node of nodes) {
    if (node.layerId) continue;
    const inheritedLayerId = node.parentId ? layerByNode.get(node.parentId) : undefined;
    const layerId =
      inheritedLayerId ?? (node.type === 'feature' ? featureLayer._id : surfaceLayer._id);
    await ctx.db.patch(node._id, { layerId });
    layerByNode.set(node._id, layerId);
  }
}

export const listByProject = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const project = await getProjectIfAccessible(ctx, projectId);
    if (!project) return [];
    const layers = await ctx.db
      .query('projectLayers')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    return layers.sort((a, b) => a.position - b.position);
  },
});

export const ensureDefaults = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await requireProjectAccess(ctx, projectId);
    await ensureProductLayers(ctx, projectId);
    await backfillMissingNodeLayers(ctx, projectId);
  },
});

export const create = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
    purpose: v.optional(layerPurposeValidator),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, name, purpose, description }) => {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('Layer name is required');
    if (trimmed.length > 80) throw new Error('Layer name must be 80 characters or fewer');
    const trimmedDescription = description?.trim();
    if (trimmedDescription && trimmedDescription.length > 240) {
      throw new Error('Layer description must be 240 characters or fewer');
    }

    await requireProjectAccess(ctx, projectId);

    const existing = await ctx.db
      .query('projectLayers')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    const maxPosition = existing.reduce((max, layer) => Math.max(max, layer.position), -1);

    return await ctx.db.insert('projectLayers', {
      projectId,
      name: trimmed,
      position: maxPosition + 1,
      purpose: purpose ?? 'custom',
      description: trimmedDescription || undefined,
    });
  },
});
