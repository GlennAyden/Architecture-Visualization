import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { ForbiddenError, requireNodeOwnership } from './lib';

const statusValidator = v.union(v.literal('todo'), v.literal('doing'), v.literal('done'));

export const addTask = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    nodeId: v.id('nodes'),
    title: v.string(),
    description: v.optional(v.string()),
    status: statusValidator,
  },
  handler: async (ctx, args) => {
    const node = await requireNodeOwnership(ctx, args.userId, args.nodeId);
    if (node.projectId !== args.scopeProjectId) {
      throw new ForbiddenError('Node not in token scope');
    }

    const trimmed = args.title.trim();
    if (trimmed.length === 0) throw new Error('Task title is required');
    if (trimmed.length > 200) throw new Error('Task title must be 200 characters or fewer');

    const tasksInColumn = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_node_status', (q) => q.eq('nodeId', args.nodeId).eq('status', args.status))
      .collect();
    const nextPosition =
      tasksInColumn.length === 0 ? 0 : Math.max(...tasksInColumn.map((t) => t.position)) + 1;

    const taskId = await ctx.db.insert('kanbanTasks', {
      nodeId: args.nodeId,
      title: trimmed,
      description: args.description?.trim() || undefined,
      status: args.status,
      position: nextPosition,
    });

    return { taskId };
  },
});

export const updateStatus = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    taskId: v.id('kanbanTasks'),
    status: statusValidator,
  },
  handler: async (ctx, { userId, scopeProjectId, taskId, status }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error('Not found: task');
    const node = await requireNodeOwnership(ctx, userId, task.nodeId);
    if (node.projectId !== scopeProjectId) {
      throw new ForbiddenError('Task not in token scope');
    }

    if (task.status === status) return; // no-op

    const tasksInNewCol = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_node_status', (q) => q.eq('nodeId', task.nodeId).eq('status', status))
      .collect();
    const nextPosition =
      tasksInNewCol.length === 0 ? 0 : Math.max(...tasksInNewCol.map((t) => t.position)) + 1;

    await ctx.db.patch(taskId, { status, position: nextPosition });
  },
});
