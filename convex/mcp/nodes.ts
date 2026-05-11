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
