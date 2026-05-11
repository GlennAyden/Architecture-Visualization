import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { getProjectIfOwned } from './lib/auth';
import { ensureHierarchyEdge } from './lib/edges';

/**
 * Lists every edge in a project. Lenient — returns `[]` when the caller
 * can't read the project so the canvas stays stable on stale URLs or
 * signed-out sessions.
 */
export const listByProject = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const project = await getProjectIfOwned(ctx, projectId);
    if (!project) return [];
    return await ctx.db
      .query('nodeEdges')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
  },
});

/**
 * One-shot migration: walk every node with a `parentId` and ensure a
 * hierarchy edge exists. Idempotent — re-running won't create duplicates
 * because `ensureHierarchyEdge` dedupes on (source, target, type).
 *
 * Invoked via `npx convex run nodeEdges:backfillHierarchy --prod` after
 * deploying the schema change, then again for the dev deployment. Safe to
 * leave callable in case a future seed/import process needs it.
 */
export const backfillHierarchy = internalMutation({
  args: {},
  handler: async (ctx) => {
    const nodes = await ctx.db.query('nodes').collect();
    let created = 0;
    let skipped = 0;
    for (const node of nodes) {
      if (!node.parentId) {
        skipped++;
        continue;
      }
      const before = await ctx.db
        .query('nodeEdges')
        .withIndex('by_source', (q) => q.eq('sourceNodeId', node.parentId!))
        .filter((q) =>
          q.and(
            q.eq(q.field('targetNodeId'), node._id),
            q.eq(q.field('type'), 'hierarchy'),
          ),
        )
        .first();
      if (before) {
        skipped++;
        continue;
      }
      await ensureHierarchyEdge(ctx, node.projectId, node.parentId, node._id);
      created++;
    }
    return { created, skipped, total: nodes.length };
  },
});
