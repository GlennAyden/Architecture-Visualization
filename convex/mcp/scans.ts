import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { requireOwnership } from './lib';

const scanKindValidator = v.union(v.literal('orphans'), v.literal('drift'));

/**
 * Stores a scan snapshot pushed by the `arch-viz-mcp scan-*` CLI subcommands.
 *
 * Behaviour: keep the most recent snapshot per (projectId, kind). Older rows
 * for the same kind get deleted in the same transaction so the UI never has
 * to "find the latest" — there's always exactly one current.
 *
 * Token scope is verified before any write to prevent a token issued for
 * project A from poisoning project B's snapshot row.
 */
export const pushSnapshot = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    kind: scanKindValidator,
    data: v.any(),
  },
  handler: async (ctx, { userId, scopeProjectId, kind, data }) => {
    await requireOwnership(ctx, userId, scopeProjectId);

    const existing = await ctx.db
      .query('scanSnapshots')
      .withIndex('by_project_kind', (q) => q.eq('projectId', scopeProjectId).eq('kind', kind))
      .collect();

    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    const snapshotId = await ctx.db.insert('scanSnapshots', {
      projectId: scopeProjectId,
      kind,
      data,
    });

    return { snapshotId, replaced: existing.length };
  },
});

/**
 * Internal counterpart for the UI — used by `convex/scans.ts` public query.
 * Returns the most recent (single) snapshot row or null when the project
 * has never been scanned for the requested kind.
 */
export const getLatestSnapshot = internalQuery({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    kind: scanKindValidator,
  },
  handler: async (ctx, { userId, scopeProjectId, kind }) => {
    try {
      await requireOwnership(ctx, userId, scopeProjectId);
    } catch {
      return null;
    }

    const rows = await ctx.db
      .query('scanSnapshots')
      .withIndex('by_project_kind', (q) => q.eq('projectId', scopeProjectId).eq('kind', kind))
      .collect();

    if (rows.length === 0) return null;
    // We delete-on-push so there should only be one row; defensive sort
    // by creation time in case a stray duplicate slipped through.
    rows.sort((a, b) => b._creationTime - a._creationTime);
    const latest = rows[0]!;
    return {
      id: latest._id,
      createdAt: latest._creationTime,
      data: latest.data as unknown,
    };
  },
});
