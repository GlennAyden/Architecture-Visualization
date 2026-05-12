import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { getNodeIfAccessible, getProjectIfAccessible } from './lib/auth';

const DEFAULT_LIMIT = 50;
const PROJECT_DEFAULT_LIMIT = 100;
const PROJECT_MAX_LIMIT = 500;
const RETENTION_DAYS = 90;
const CLEANUP_BATCH_LIMIT = 500;

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
    const node = await getNodeIfAccessible(ctx, nodeId);
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

/**
 * Lists activity log entries across every node in a project, newest first.
 * Strategy: fetch latest entries per node and merge-sort. Acceptable for
 * personal-tool scale (tens of nodes). Each entry is enriched with the
 * owning node's name so the UI can render a clickable link without a
 * second round-trip.
 *
 * Lenient query: returns `[]` if the user can't read the project so the
 * UI stays stable on stale URLs / signed-out clients.
 */
export const listByProject = query({
  args: {
    projectId: v.id('projects'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { projectId, limit }) => {
    const project = await getProjectIfAccessible(ctx, projectId);
    if (!project) return [];

    const nodes = await ctx.db
      .query('nodes')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    const nodeNameById = new Map<string, string>(
      nodes.map((n) => [n._id as string, n.name]),
    );

    const cap = Math.min(
      Math.max(limit ?? PROJECT_DEFAULT_LIMIT, 1),
      PROJECT_MAX_LIMIT,
    );

    const perNode = await Promise.all(
      nodes.map((n) =>
        ctx.db
          .query('activityLog')
          .withIndex('by_node', (q) => q.eq('nodeId', n._id))
          .order('desc')
          .take(cap),
      ),
    );

    return perNode
      .flat()
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, cap)
      .map((entry) => ({
        _id: entry._id,
        _creationTime: entry._creationTime,
        actor: entry.actor,
        message: entry.message,
        metadata: entry.metadata,
        nodeId: entry.nodeId,
        nodeName: nodeNameById.get(entry.nodeId as string) ?? '(deleted node)',
      }));
  },
});

/**
 * Daily cron target. Deletes activity entries older than RETENTION_DAYS.
 *
 * Personal-tool scale: a full table scan via `.collect()` would be cheapest
 * at current row counts, but we cap each run at CLEANUP_BATCH_LIMIT so a
 * long-untouched deployment doesn't get hit with a multi-second delete on
 * the first run. Subsequent days catch up.
 */
export const cleanup = internalMutation({
  args: {
    retentionDays: v.optional(v.number()),
    batchLimit: v.optional(v.number()),
  },
  handler: async (ctx, { retentionDays, batchLimit }) => {
    const days = retentionDays ?? RETENTION_DAYS;
    const limit = Math.min(batchLimit ?? CLEANUP_BATCH_LIMIT, 5000);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    const stale = await ctx.db
      .query('activityLog')
      .filter((q) => q.lt(q.field('_creationTime'), cutoff))
      .take(limit);

    for (const entry of stale) await ctx.db.delete(entry._id);

    return { deleted: stale.length, cutoff, retentionDays: days };
  },
});
