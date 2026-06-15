import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { ensureEdge, type EdgeType } from '../lib/edges';
import { ForbiddenError, requireNodeOwnership, requireOwnership } from './lib';

const manualEdgeType = v.union(
  v.literal('dependency'),
  v.literal('navigation'),
  v.literal('data_flow'),
);

/**
 * AI / user-driven manual classification: "these two nodes are related in
 * way X, even though the import graph doesn't show it". Marks the new edge
 * as source='manual' so the next reconcile pass won't wipe it.
 *
 * Idempotent: re-calling with the same triple is a no-op (but does upgrade
 * an existing auto edge to manual — once a human has asserted the relation,
 * the scanner should not be the source of truth for it any longer).
 */
export const linkNodes = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    sourceNodeId: v.id('nodes'),
    targetNodeId: v.id('nodes'),
    type: manualEdgeType,
  },
  handler: async (ctx, { userId, scopeProjectId, sourceNodeId, targetNodeId, type }) => {
    if (sourceNodeId === targetNodeId) {
      throw new Error('source and target must differ');
    }

    const sourceNode = await requireNodeOwnership(ctx, userId, sourceNodeId);
    const targetNode = await requireNodeOwnership(ctx, userId, targetNodeId);
    if (sourceNode.projectId !== scopeProjectId || targetNode.projectId !== scopeProjectId) {
      throw new ForbiddenError('Edge endpoints not in token scope');
    }

    const edgeId = await ensureEdge(
      ctx,
      scopeProjectId,
      sourceNodeId,
      targetNodeId,
      type,
      'manual',
    );
    return { edgeId };
  },
});

/**
 * Remove a manually-classified edge. Hierarchy edges aren't reachable here
 * because the validator rejects them — those are derived from `parentId`
 * and managed by the node-create / cascade-delete path.
 *
 * Idempotent: removing a non-existent edge returns `{removed: 0}`.
 */
export const unlinkNodes = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    sourceNodeId: v.id('nodes'),
    targetNodeId: v.id('nodes'),
    type: manualEdgeType,
  },
  handler: async (ctx, { userId, scopeProjectId, sourceNodeId, targetNodeId, type }) => {
    await requireOwnership(ctx, userId, scopeProjectId);

    const matches = await ctx.db
      .query('nodeEdges')
      .withIndex('by_source', (q) => q.eq('sourceNodeId', sourceNodeId))
      .filter((q) =>
        q.and(
          q.eq(q.field('targetNodeId'), targetNodeId),
          q.eq(q.field('type'), type),
          q.eq(q.field('projectId'), scopeProjectId),
        ),
      )
      .collect();

    for (const edge of matches) {
      await ctx.db.delete(edge._id);
    }
    return { removed: matches.length };
  },
});

/**
 * Batch reconciliation called by `arch-viz-mcp scan-imports` after a full
 * scan of the repo. For each non-hierarchy type present in the incoming
 * `edges` array, we:
 *   1. Insert any (source, target, type) triple that isn't already there.
 *   2. Delete `source='auto'` rows for the same type that the scan did NOT
 *      re-emit — these represent dependencies / nav / data-flow that no
 *      longer exist in the code.
 *
 * Manual rows (`source='manual'`) are preserved across reconcile passes so
 * AI-classified cross-language relations don't get wiped on every scan.
 *
 * Returns counts so the CLI can print a one-line summary.
 */
export const reconcileEdges = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    edges: v.array(
      v.object({
        sourceNodeId: v.id('nodes'),
        targetNodeId: v.id('nodes'),
        type: manualEdgeType,
      }),
    ),
  },
  handler: async (ctx, { userId, scopeProjectId, edges }) => {
    await requireOwnership(ctx, userId, scopeProjectId);

    // Group incoming by type so reconcile is per-(projectId,type) — the
    // CLI must always emit ALL discovered edges for any type it covers,
    // otherwise the diff would delete edges it just doesn't know about
    // in this run.
    const incomingByType = new Map<EdgeType, Set<string>>();
    const dedup = new Set<string>();
    for (const edge of edges) {
      const key = `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`;
      if (dedup.has(key)) continue;
      dedup.add(key);
      const set = incomingByType.get(edge.type) ?? new Set<string>();
      set.add(`${edge.sourceNodeId}|${edge.targetNodeId}`);
      incomingByType.set(edge.type, set);
    }

    let inserted = 0;
    let deleted = 0;
    let manualKept = 0;

    for (const [type, incomingPairs] of incomingByType.entries()) {
      // Pre-existing rows of this type in the project.
      const existing = await ctx.db
        .query('nodeEdges')
        .withIndex('by_project_type', (q) => q.eq('projectId', scopeProjectId).eq('type', type))
        .collect();

      const existingAutoPairs = new Map<string, (typeof existing)[number]>();
      for (const row of existing) {
        const src = row.source ?? 'auto';
        const key = `${row.sourceNodeId}|${row.targetNodeId}`;
        if (src === 'auto') {
          existingAutoPairs.set(key, row);
        } else {
          manualKept++;
          // Manual edges are also in incomingPairs if the scan happened to
          // re-discover them — that's fine, no duplicate insert because
          // ensureEdge dedups by triple.
        }
      }

      // Insertions: pairs in incoming but not in any existing row of this
      // type (auto or manual).
      const existingAllPairs = new Set(existing.map((r) => `${r.sourceNodeId}|${r.targetNodeId}`));
      for (const pair of incomingPairs) {
        if (existingAllPairs.has(pair)) continue;
        const [source, target] = pair.split('|') as [string, string];
        await ctx.db.insert('nodeEdges', {
          projectId: scopeProjectId,
          sourceNodeId: source as (typeof existing)[number]['sourceNodeId'],
          targetNodeId: target as (typeof existing)[number]['targetNodeId'],
          type,
          source: 'auto',
        });
        inserted++;
      }

      // Deletions: auto rows the scan didn't re-emit. Manual rows are
      // explicitly skipped by branching on `source` above.
      for (const [pair, row] of existingAutoPairs.entries()) {
        if (incomingPairs.has(pair)) continue;
        await ctx.db.delete(row._id);
        deleted++;
      }
    }

    return { inserted, deleted, manualKept };
  },
});
