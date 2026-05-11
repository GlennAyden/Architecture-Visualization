import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { ForbiddenError, requireNodeOwnership, requireOwnership } from './lib';

export const getProjectSummary = internalQuery({
  args: { userId: v.id('profiles'), projectId: v.id('projects') },
  handler: async (ctx, { userId, projectId }) => {
    try {
      const project = await requireOwnership(ctx, userId, projectId);
      return { name: project.name };
    } catch {
      return null;
    }
  },
});

export const listForProject = internalQuery({
  args: { userId: v.id('profiles'), projectId: v.id('projects') },
  handler: async (ctx, { userId, projectId }) => {
    await requireOwnership(ctx, userId, projectId);
    const nodes = await ctx.db
      .query('nodes')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    return nodes.map((n) => ({
      id: n._id,
      type: n.type,
      name: n.name,
      parentId: n.parentId ?? null,
      description: n.description ?? null,
      positionX: n.positionX,
      positionY: n.positionY,
    }));
  },
});

export const getDetail = internalQuery({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    nodeId: v.id('nodes'),
  },
  handler: async (ctx, { userId, scopeProjectId, nodeId }) => {
    const node = await requireNodeOwnership(ctx, userId, nodeId);
    if (node.projectId !== scopeProjectId) {
      throw new ForbiddenError('Node not in token scope');
    }
    const files = await ctx.db
      .query('nodeFiles')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
    const tasks = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
    return {
      id: node._id,
      type: node.type,
      name: node.name,
      parentId: node.parentId ?? null,
      description: node.description ?? null,
      positionX: node.positionX,
      positionY: node.positionY,
      files: files.map((f) => ({ id: f._id, path: f.path })),
      kanbanTasks: tasks
        .sort((a, b) => a.position - b.position)
        .map((t) => ({
          id: t._id,
          title: t.title,
          description: t.description ?? null,
          status: t.status,
          position: t.position,
        })),
    };
  },
});
