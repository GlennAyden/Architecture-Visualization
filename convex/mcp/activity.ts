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

/**
 * Hook-friendly variant: caller supplies a repo-relative file path; we look
 * up the (single) node that has it linked via `nodeFiles` and append the
 * activity entry there. Returns `{ matched: false }` when no node is linked
 * to the path so the hook can silently no-op without surfacing an error.
 *
 * Constraints:
 *   - Only matches nodes inside the token's project scope.
 *   - If multiple nodes link the same path (allowed by schema), we pick the
 *     oldest link — usually the most "canonical" one. Re-linking elsewhere
 *     won't accidentally redirect existing hooks.
 */
export const logByFile = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    filePath: v.string(),
    actor: v.string(),
    message: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const normalized = args.filePath.trim().replace(/\\/g, '/');

    const links = await ctx.db
      .query('nodeFiles')
      .filter((q) => q.eq(q.field('path'), normalized))
      .collect();

    for (const link of links.sort((a, b) => a._creationTime - b._creationTime)) {
      const node = await ctx.db.get(link.nodeId);
      if (!node) continue;
      if (node.projectId !== args.scopeProjectId) continue;
      const project = await ctx.db.get(node.projectId);
      if (!project || project.userId !== args.userId) continue;

      await ctx.db.insert('activityLog', {
        nodeId: node._id,
        actor: args.actor.trim(),
        message: args.message.trim(),
        metadata: args.metadata,
      });
      return { matched: true, nodeId: node._id, nodeName: node.name };
    }

    return { matched: false };
  },
});
