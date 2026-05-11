import { v } from 'convex/values';
import { query } from './_generated/server';
import { getNodeIfOwned } from './lib/auth';

const DEFAULT_LIMIT = 50;

/**
 * Lists activity log entries for a node, newest first.
 * Lenient query: returns `[]` if the user can't read the node so the UI
 * stays stable on stale URLs / signed-out clients.
 */
export const listByNode = query({
  args: {
    nodeId: v.id('nodes'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { nodeId, limit }) => {
    const node = await getNodeIfOwned(ctx, nodeId);
    if (!node) return [];
    const cap = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), 200);
    const entries = await ctx.db
      .query('activityLog')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .order('desc')
      .take(cap);
    return entries;
  },
});
