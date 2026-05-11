import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';

export type EdgeType = Doc<'nodeEdges'>['type'];
export type EdgeSource = NonNullable<Doc<'nodeEdges'>['source']>;

/**
 * Insert an edge of `type` from source→target if one doesn't already exist
 * (dedup by triple {source, target, type}). When the row already exists and
 * the caller supplies a `source` field stronger than the existing one,
 * upgrade it: a manual `link_nodes` call should "win" over a prior auto
 * scan, so reconcile-after-manual won't wipe the user's intent.
 *
 * Returns the edge id (existing or newly inserted).
 */
export async function ensureEdge(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  sourceNodeId: Id<'nodes'>,
  targetNodeId: Id<'nodes'>,
  type: EdgeType,
  source: EdgeSource = 'auto',
): Promise<Id<'nodeEdges'>> {
  const existing = await ctx.db
    .query('nodeEdges')
    .withIndex('by_source', (q) => q.eq('sourceNodeId', sourceNodeId))
    .filter((q) =>
      q.and(
        q.eq(q.field('targetNodeId'), targetNodeId),
        q.eq(q.field('type'), type),
      ),
    )
    .first();

  if (existing) {
    // Upgrade auto → manual when a human/AI re-asserts the edge.
    if (source === 'manual' && (existing.source ?? 'auto') === 'auto') {
      await ctx.db.patch(existing._id, { source: 'manual' });
    }
    return existing._id;
  }

  return await ctx.db.insert('nodeEdges', {
    projectId,
    sourceNodeId,
    targetNodeId,
    type,
    source,
  });
}

/**
 * Convenience wrapper kept for Sprint 1 call sites. Hierarchy edges are
 * always auto-managed by the parentId mirror, never inserted manually.
 */
export async function ensureHierarchyEdge(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  parentId: Id<'nodes'>,
  childId: Id<'nodes'>,
) {
  return ensureEdge(ctx, projectId, parentId, childId, 'hierarchy', 'auto');
}

/**
 * Delete every edge that touches the node (as source or as target). Called
 * from the cascade-delete path so deletions don't leave dangling edges.
 */
export async function removeEdgesForNode(ctx: MutationCtx, nodeId: Id<'nodes'>) {
  const outgoing = await ctx.db
    .query('nodeEdges')
    .withIndex('by_source', (q) => q.eq('sourceNodeId', nodeId))
    .collect();
  for (const edge of outgoing) await ctx.db.delete(edge._id);

  const incoming = await ctx.db
    .query('nodeEdges')
    .withIndex('by_target', (q) => q.eq('targetNodeId', nodeId))
    .collect();
  for (const edge of incoming) await ctx.db.delete(edge._id);
}
