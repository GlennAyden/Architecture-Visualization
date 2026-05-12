import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { getProjectIfAccessible, requireProjectAccess } from './lib/auth';
import { ensureHierarchyEdge } from './lib/edges';

/**
 * Lists every edge in a project. Lenient — returns `[]` when the caller
 * can't read the project so the canvas stays stable on stale URLs or
 * signed-out sessions.
 */
export const listByProject = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const project = await getProjectIfAccessible(ctx, projectId);
    if (!project) return [];
    return await ctx.db
      .query('nodeEdges')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
  },
});

/**
 * UI-driven edge deletion. When the user deletes an arrow on the canvas,
 * `useCanvasSync` dispatches this mutation. Hierarchy edges throw because
 * they're auto-mirrored from `parentId` — deleting one would just have it
 * re-created on the next reconcile, so we surface the conflict instead of
 * silently no-op'ing.
 *
 * Idempotent for already-deleted ids (returns early on null lookup) so a
 * double-click or stale subscription doesn't error the UI.
 */
export const remove = mutation({
  args: { id: v.id('nodeEdges') },
  handler: async (ctx, { id }) => {
    const edge = await ctx.db.get(id);
    if (!edge) return; // idempotent
    await requireProjectAccess(ctx, edge.projectId);
    if (edge.type === 'hierarchy') {
      throw new Error(
        'Hierarchy edges cannot be deleted directly. Change the node parentId instead.',
      );
    }
    await ctx.db.delete(id);
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
