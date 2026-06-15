import { v } from 'convex/values';
import { query } from './_generated/server';
import { getProjectIfAccessible } from './lib/auth';

const scanKindValidator = v.union(v.literal('orphans'), v.literal('drift'));

/**
 * Public, lenient query: returns the most recent snapshot the CLI has pushed
 * for the given (projectId, kind), or `null` when no scan has been run yet.
 *
 * Lenient (returns null on unauthorized) so the UI doesn't crash if the user
 * navigates to /canvas/<stale>/orphans after their project was deleted.
 */
export const getLatestByKind = query({
  args: {
    projectId: v.id('projects'),
    kind: scanKindValidator,
  },
  handler: async (ctx, { projectId, kind }) => {
    const project = await getProjectIfAccessible(ctx, projectId);
    if (!project) return null;

    const rows = await ctx.db
      .query('scanSnapshots')
      .withIndex('by_project_kind', (q) => q.eq('projectId', projectId).eq('kind', kind))
      .collect();
    if (rows.length === 0) return null;
    rows.sort((a, b) => b._creationTime - a._creationTime);
    const latest = rows[0]!;
    return {
      id: latest._id,
      createdAt: latest._creationTime,
      data: latest.data as unknown,
    };
  },
});
