import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getNodeIfOwned, getProjectIfOwned, requireProjectAccess } from './lib/auth';
import { deleteNodeCascade } from './lib/cascade';

export const listByProject = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const project = await getProjectIfOwned(ctx, projectId);
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
    return await getNodeIfOwned(ctx, id);
  },
});

export const create = mutation({
  args: {
    projectId: v.id('projects'),
    type: v.union(v.literal('page'), v.literal('feature')),
    name: v.string(),
    parentId: v.optional(v.id('nodes')),
    positionX: v.number(),
    positionY: v.number(),
  },
  handler: async (ctx, args) => {
    const trimmed = args.name.trim();
    if (trimmed.length === 0) throw new Error('Node name is required');
    if (trimmed.length > 80) throw new Error('Node name must be 80 characters or fewer');

    await requireProjectAccess(ctx, args.projectId);

    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.projectId !== args.projectId) {
        throw new Error('Parent node must belong to the same project');
      }
    }

    return await ctx.db.insert('nodes', {
      projectId: args.projectId,
      parentId: args.parentId,
      type: args.type,
      name: trimmed,
      positionX: args.positionX,
      positionY: args.positionY,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id('nodes'),
    name: v.optional(v.string()),
    positionX: v.optional(v.number()),
    positionY: v.optional(v.number()),
    description: v.optional(v.string()),
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

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.id, patch);
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
