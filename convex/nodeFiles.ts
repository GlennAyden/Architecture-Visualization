import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getNodeIfAccessible, getProjectIfAccessible, requireProjectAccess } from './lib/auth';
import { linkedFileRoleValidator } from './lib/semantic';

export const listByNode = query({
  args: { nodeId: v.id('nodes') },
  handler: async (ctx, { nodeId }) => {
    const node = await getNodeIfAccessible(ctx, nodeId);
    if (!node) return [];
    return ctx.db
      .query('nodeFiles')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
  },
});

export const add = mutation({
  args: { nodeId: v.id('nodes'), path: v.string(), role: v.optional(linkedFileRoleValidator) },
  handler: async (ctx, { nodeId, path, role }) => {
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
    if (dupe) {
      if (role && dupe.role !== role) await ctx.db.patch(dupe._id, { role });
      return dupe._id;
    }

    return await ctx.db.insert('nodeFiles', { nodeId, path: trimmed, role });
  },
});

export const summaryByProject = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const project = await getProjectIfAccessible(ctx, projectId);
    if (!project) return [];

    const nodes = await ctx.db
      .query('nodes')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    const summaries = [];
    for (const node of nodes) {
      const files = await ctx.db
        .query('nodeFiles')
        .withIndex('by_node', (q) => q.eq('nodeId', node._id))
        .collect();
      const active = files.filter((file) => !file.archived);
      summaries.push({
        nodeId: node._id,
        fileCount: active.length,
        verifiedCount: active.filter((file) => file.verifiedAt).length,
        roles: active.reduce<Record<string, number>>((acc, file) => {
          const role = file.role ?? 'support';
          acc[role] = (acc[role] ?? 0) + 1;
          return acc;
        }, {}),
      });
    }
    return summaries;
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
