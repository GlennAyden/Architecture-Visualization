import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { requireOwnership } from './lib';

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
