import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { getNodeIfAccessible, getProjectIfAccessible, requireProjectAccess } from './lib/auth';
import { deleteNodeCascade } from './lib/cascade';
import { ensureHierarchyEdge } from './lib/edges';
import { resolveNodeLayer } from './lib/layers';
import {
  mappingStatusValidator,
  nodeSemanticKindValidator,
  productAreaValidator,
} from './lib/semantic';

export const listByProject = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const project = await getProjectIfAccessible(ctx, projectId);
    if (!project) return [];
    return ctx.db
      .query('nodes')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id('nodes') },
  handler: async (ctx, { id }) => {
    return await getNodeIfAccessible(ctx, id);
  },
});

export const create = mutation({
  args: {
    projectId: v.id('projects'),
    layerId: v.optional(v.id('projectLayers')),
    type: v.union(v.literal('page'), v.literal('feature')),
    name: v.string(),
    parentId: v.optional(v.id('nodes')),
    positionX: v.number(),
    positionY: v.number(),
    semanticKind: v.optional(nodeSemanticKindValidator),
    productArea: v.optional(productAreaValidator),
    capabilityKey: v.optional(v.string()),
    routeHint: v.optional(v.string()),
    mappingStatus: v.optional(mappingStatusValidator),
    mappingConfidence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const trimmed = args.name.trim();
    if (trimmed.length === 0) throw new Error('Node name is required');
    if (trimmed.length > 80) throw new Error('Node name must be 80 characters or fewer');

    await requireProjectAccess(ctx, args.projectId);

    let parent = null;
    if (args.parentId) {
      parent = await ctx.db.get(args.parentId);
      if (!parent || parent.projectId !== args.projectId) {
        throw new Error('Parent node must belong to the same project');
      }
    }
    const layerId = await resolveNodeLayer(ctx, {
      projectId: args.projectId,
      type: args.type,
      layerId: args.layerId,
      parent,
    });

    const nodeId = await ctx.db.insert('nodes', {
      projectId: args.projectId,
      layerId,
      parentId: args.parentId,
      type: args.type,
      name: trimmed,
      positionX: args.positionX,
      positionY: args.positionY,
      semanticKind: args.semanticKind,
      productArea: args.productArea,
      capabilityKey: args.capabilityKey,
      routeHint: args.routeHint,
      mappingStatus: args.mappingStatus ?? 'manual',
      mappingConfidence: args.mappingConfidence,
    });

    if (args.parentId) {
      await ensureHierarchyEdge(ctx, args.projectId, args.parentId, nodeId);
    }

    return nodeId;
  },
});

export const update = mutation({
  args: {
    id: v.id('nodes'),
    name: v.optional(v.string()),
    positionX: v.optional(v.number()),
    positionY: v.optional(v.number()),
    description: v.optional(v.string()),
    semanticKind: v.optional(nodeSemanticKindValidator),
    productArea: v.optional(productAreaValidator),
    capabilityKey: v.optional(v.string()),
    routeHint: v.optional(v.string()),
    mappingStatus: v.optional(mappingStatusValidator),
    mappingConfidence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const node = await ctx.db.get(args.id);
    // Idempotent: silently no-op if the node was already deleted by another
    // session or by a cascade (e.g. project removal).
    if (!node) return;
    await requireProjectAccess(ctx, node.projectId);

    const patch: Partial<typeof node> = {};

    if (args.name !== undefined) {
      const trimmed = args.name.trim();
      if (trimmed.length === 0) throw new Error('Node name is required');
      if (trimmed.length > 80) throw new Error('Node name must be 80 characters or fewer');
      patch.name = trimmed;
    }
    if (args.positionX !== undefined) patch.positionX = args.positionX;
    if (args.positionY !== undefined) patch.positionY = args.positionY;
    if (args.description !== undefined) patch.description = args.description;
    if (args.semanticKind !== undefined) patch.semanticKind = args.semanticKind;
    if (args.productArea !== undefined) patch.productArea = args.productArea;
    if (args.capabilityKey !== undefined) patch.capabilityKey = args.capabilityKey;
    if (args.routeHint !== undefined) patch.routeHint = args.routeHint;
    if (args.mappingStatus !== undefined) patch.mappingStatus = args.mappingStatus;
    if (args.mappingConfidence !== undefined) patch.mappingConfidence = args.mappingConfidence;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.id, patch);
    }
  },
});

export const updatePositions = mutation({
  args: {
    updates: v.array(
      v.object({
        id: v.id('nodes'),
        positionX: v.number(),
        positionY: v.number(),
      }),
    ),
  },
  handler: async (ctx, { updates }) => {
    if (updates.length === 0) return { updated: 0 };
    if (updates.length > 500) throw new Error('Too many node positions to update at once');

    const seen = new Set<string>();
    const rows: Array<{
      id: (typeof updates)[number]['id'];
      positionX: number;
      positionY: number;
    }> = [];
    let projectId: Id<'projects'> | null = null;

    for (const update of updates) {
      if (seen.has(update.id)) continue;
      seen.add(update.id);

      const node = await ctx.db.get(update.id);
      if (!node) throw new Error('Node not found');
      if (projectId && node.projectId !== projectId) {
        throw new Error('All node positions must belong to the same project');
      }
      projectId = node.projectId;
      rows.push({
        id: update.id,
        positionX: update.positionX,
        positionY: update.positionY,
      });
    }

    if (!projectId) return { updated: 0 };
    await requireProjectAccess(ctx, projectId);

    let updated = 0;
    for (const row of rows) {
      await ctx.db.patch(row.id, {
        positionX: row.positionX,
        positionY: row.positionY,
      });
      updated++;
    }

    return { updated };
  },
});

export const markVerified = mutation({
  args: { id: v.id('nodes') },
  handler: async (ctx, { id }) => {
    const node = await ctx.db.get(id);
    if (!node) return;
    await requireProjectAccess(ctx, node.projectId);
    await ctx.db.patch(id, {
      mappingStatus: 'verified',
      mappingConfidence: 1,
    });

    const files = await ctx.db
      .query('nodeFiles')
      .withIndex('by_node', (q) => q.eq('nodeId', id))
      .collect();
    const now = Date.now();
    for (const file of files) {
      if (file.archived) continue;
      await ctx.db.patch(file._id, { verifiedAt: now });
    }
  },
});

export const remove = mutation({
  args: { id: v.id('nodes') },
  handler: async (ctx, { id }) => {
    const node = await ctx.db.get(id);
    if (!node) return;
    await requireProjectAccess(ctx, node.projectId);
    await deleteNodeCascade(ctx, id);
  },
});
