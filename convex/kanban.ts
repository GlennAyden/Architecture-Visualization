import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireProjectAccess } from './lib/auth';

const statusValidator = v.union(v.literal('todo'), v.literal('doing'), v.literal('done'));

export const listByNode = query({
  args: { nodeId: v.id('nodes') },
  handler: async (ctx, { nodeId }) => {
    const node = await ctx.db.get(nodeId);
    if (!node) return [];
    await requireProjectAccess(ctx, node.projectId);
    const tasks = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
    return tasks.sort((a, b) => a.position - b.position);
  },
});

export const create = mutation({
  args: {
    nodeId: v.id('nodes'),
    title: v.string(),
    description: v.optional(v.string()),
    status: statusValidator,
  },
  handler: async (ctx, args) => {
    const trimmed = args.title.trim();
    if (trimmed.length === 0) throw new Error('Task title is required');
    if (trimmed.length > 200) throw new Error('Task title must be 200 characters or fewer');

    const node = await ctx.db.get(args.nodeId);
    if (!node) throw new Error('Node not found');
    await requireProjectAccess(ctx, node.projectId);

    const tasksInColumn = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_node_status', (q) => q.eq('nodeId', args.nodeId).eq('status', args.status))
      .collect();
    const nextPosition =
      tasksInColumn.length === 0 ? 0 : Math.max(...tasksInColumn.map((t) => t.position)) + 1;

    return await ctx.db.insert('kanbanTasks', {
      nodeId: args.nodeId,
      title: trimmed,
      description: args.description?.trim() || undefined,
      status: args.status,
      position: nextPosition,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id('kanbanTasks'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(statusValidator),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task) return;
    const node = await ctx.db.get(task.nodeId);
    if (!node) {
      await ctx.db.delete(args.id);
      return;
    }
    await requireProjectAccess(ctx, node.projectId);

    const patch: Partial<typeof task> = {};
    if (args.title !== undefined) {
      const trimmed = args.title.trim();
      if (trimmed.length === 0) throw new Error('Task title is required');
      if (trimmed.length > 200) throw new Error('Task title must be 200 characters or fewer');
      patch.title = trimmed;
    }
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    if (args.status !== undefined && args.status !== task.status) {
      const newStatus = args.status;
      patch.status = newStatus;
      const tasksInNewCol = await ctx.db
        .query('kanbanTasks')
        .withIndex('by_node_status', (q) => q.eq('nodeId', task.nodeId).eq('status', newStatus))
        .collect();
      patch.position =
        tasksInNewCol.length === 0 ? 0 : Math.max(...tasksInNewCol.map((t) => t.position)) + 1;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.id, patch);
    }
  },
});

export const remove = mutation({
  args: { id: v.id('kanbanTasks') },
  handler: async (ctx, { id }) => {
    const task = await ctx.db.get(id);
    if (!task) return;
    const node = await ctx.db.get(task.nodeId);
    if (!node) {
      await ctx.db.delete(id);
      return;
    }
    await requireProjectAccess(ctx, node.projectId);
    await ctx.db.delete(id);
  },
});
