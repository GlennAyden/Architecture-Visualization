import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { ForbiddenError, requireNodeOwnership } from './lib';

export const log = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    nodeId: v.id('nodes'),
    actor: v.string(),
    message: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const node = await requireNodeOwnership(ctx, args.userId, args.nodeId);
    if (node.projectId !== args.scopeProjectId) {
      throw new ForbiddenError('Node not in token scope');
    }
    await ctx.db.insert('activityLog', {
      nodeId: args.nodeId,
      actor: args.actor.trim(),
      message: args.message.trim(),
      metadata: args.metadata,
    });
  },
});
