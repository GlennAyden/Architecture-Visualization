import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { ForbiddenError, requireNodeOwnership } from './lib';

export const linkMany = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    nodeId: v.id('nodes'),
    paths: v.array(v.string()),
  },
  handler: async (ctx, { userId, scopeProjectId, nodeId, paths }) => {
    const node = await requireNodeOwnership(ctx, userId, nodeId);
    if (node.projectId !== scopeProjectId) {
      throw new ForbiddenError('Node not in token scope');
    }

    const existing = await ctx.db
      .query('nodeFiles')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
    const existingPaths = new Set(existing.map((f) => f.path));

    let linked = 0;
    const seen = new Set<string>();
    for (const raw of paths) {
      const p = raw.trim();
      if (p.length === 0 || p.length > 500) continue;
      if (seen.has(p) || existingPaths.has(p)) continue;
      seen.add(p);
      await ctx.db.insert('nodeFiles', { nodeId, path: p });
      linked++;
    }

    return { linked };
  },
});
