import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getNodeIfOwned, requireProjectAccess } from './lib/auth';

export const listByNode = query({
  args: { nodeId: v.id('nodes') },
  handler: async (ctx, { nodeId }) => {
    const node = await getNodeIfOwned(ctx, nodeId);
    if (!node) return [];
    return ctx.db
      .query('nodeFiles')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
  },
});

export const add = mutation({
  args: { nodeId: v.id('nodes'), path: v.string() },
  handler: async (ctx, { nodeId, path }) => {
    const trimmed = path.trim();
    if (trimmed.length === 0) throw new Error('File path is required');
    if (trimmed.length > 500) throw new Error('File path must be 500 characters or fewer');

    const node = await ctx.db.get(nodeId);
    if (!node) throw new Error('Node not found');
    await requireProjectAccess(ctx, node.projectId);

    const existing = await ctx.db
      .query('nodeFiles')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
    const dupe = existing.find((f) => f.path === trimmed);
    if (dupe) return dupe._id;

    return await ctx.db.insert('nodeFiles', { nodeId, path: trimmed });
  },
});

export const remove = mutation({
  args: { id: v.id('nodeFiles') },
  handler: async (ctx, { id }) => {
    const file = await ctx.db.get(id);
    if (!file) return;
    const node = await ctx.db.get(file.nodeId);
    if (!node) {
      await ctx.db.delete(id);
      return;
    }
    await requireProjectAccess(ctx, node.projectId);
    await ctx.db.delete(id);
  },
});

/**
 * Marks a linked file as archived (or un-archives it). Archived rows are kept
 * for historical breadcrumb but are never surfaced as drift again — the user
 * is saying "yes, this file is gone on disk and that's intentional".
 *
 * Idempotent: setting the same value twice is a no-op.
 */
export const setArchived = mutation({
  args: { id: v.id('nodeFiles'), archived: v.boolean() },
  handler: async (ctx, { id, archived }) => {
    const file = await ctx.db.get(id);
    if (!file) return; // idempotent on cascade-deleted rows
    const node = await ctx.db.get(file.nodeId);
    if (!node) return;
    await requireProjectAccess(ctx, node.projectId);
    if ((file.archived ?? false) === archived) return;
    await ctx.db.patch(id, { archived });
  },
});
