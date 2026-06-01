import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { seedDefaultLayers } from '../projectLayers';
import { requireOwnership } from './lib';

export const listForProject = internalMutation({
  args: { userId: v.id('profiles'), projectId: v.id('projects') },
  handler: async (ctx, { userId, projectId }) => {
    await requireOwnership(ctx, userId, projectId);
    await seedDefaultLayers(ctx, projectId);
    const layers = await ctx.db
      .query('projectLayers')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();

    return layers
      .sort((a, b) => a.position - b.position)
      .map((layer) => ({
        id: layer._id,
        name: layer.name,
        position: layer.position,
      }));
  },
});
