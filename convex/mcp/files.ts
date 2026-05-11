import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { ForbiddenError, requireNodeOwnership, requireOwnership } from './lib';

function normalizePath(raw: string): string {
  return raw.trim().replace(/\\/g, '/');
}

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
      const p = normalizePath(raw);
      if (p.length === 0 || p.length > 500) continue;
      if (seen.has(p) || existingPaths.has(p)) continue;
      seen.add(p);
      await ctx.db.insert('nodeFiles', { nodeId, path: p });
      linked++;
    }

    return { linked };
  },
});

/**
 * Auto-link counterpart of `linkMany` driven by import analysis.
 *
 * The origin (importer) may be linked to 0..N nodes. For each node owning
 * the origin, we attach every imported file to that same node, deduped
 * against what's already there. When the origin is unlinked, this is a
 * no-op (linked = 0) so the hook can fire freely on files that aren't
 * tracked yet without erroring.
 *
 * Returns `{ linked, alreadyLinked, skipped }` to give the hook visibility
 * into what happened without surfacing a separate query.
 */
export const autoLinkByOrigin = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    originFilePath: v.string(),
    importedFilePaths: v.array(v.string()),
  },
  handler: async (
    ctx,
    { userId, scopeProjectId, originFilePath, importedFilePaths },
  ) => {
    await requireOwnership(ctx, userId, scopeProjectId);

    const normalizedOrigin = normalizePath(originFilePath);
    if (normalizedOrigin.length === 0) {
      return { linked: 0, alreadyLinked: 0, skipped: 0, matchedNodes: 0 };
    }

    // Find every node in scope that owns the origin file. `nodeFiles` doesn't
    // have a (projectId, path) index — we filter by path then verify project
    // scope on each candidate. Volume is low (most files belong to ≤1 node).
    const originLinks = await ctx.db
      .query('nodeFiles')
      .filter((q) => q.eq(q.field('path'), normalizedOrigin))
      .collect();

    const scopedNodeIds: string[] = [];
    for (const link of originLinks) {
      const node = await ctx.db.get(link.nodeId);
      if (!node) continue;
      if (node.projectId !== scopeProjectId) continue;
      scopedNodeIds.push(link.nodeId);
    }

    if (scopedNodeIds.length === 0) {
      return {
        linked: 0,
        alreadyLinked: 0,
        skipped: importedFilePaths.length,
        matchedNodes: 0,
      };
    }

    // Pre-normalize and dedup the imported paths once, then for each owning
    // node compute existing-set and insert the diff.
    const candidates: string[] = [];
    const seenInput = new Set<string>();
    let skipped = 0;
    for (const raw of importedFilePaths) {
      const p = normalizePath(raw);
      if (p.length === 0 || p.length > 500) {
        skipped++;
        continue;
      }
      if (p === normalizedOrigin) {
        skipped++;
        continue;
      }
      if (seenInput.has(p)) continue;
      seenInput.add(p);
      candidates.push(p);
    }

    let linked = 0;
    let alreadyLinked = 0;
    for (const nodeId of scopedNodeIds) {
      const existing = await ctx.db
        .query('nodeFiles')
        .withIndex('by_node', (q) =>
          q.eq('nodeId', nodeId as typeof originLinks[number]['nodeId']),
        )
        .collect();
      const existingPaths = new Set(existing.map((f) => f.path));
      for (const path of candidates) {
        if (existingPaths.has(path)) {
          alreadyLinked++;
          continue;
        }
        await ctx.db.insert('nodeFiles', {
          nodeId: nodeId as typeof originLinks[number]['nodeId'],
          path,
        });
        linked++;
      }
    }

    return {
      linked,
      alreadyLinked,
      skipped,
      matchedNodes: scopedNodeIds.length,
    };
  },
});
