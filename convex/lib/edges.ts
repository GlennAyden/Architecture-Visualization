import { Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';

/**
 * Insert a hierarchy edge (sourceNodeId is the parent, targetNodeId is the
 * child) iff one doesn't already exist. Both nodes are assumed to live in
 * the same project — callers validate that. The dedupe here is a safety net,
 * not the primary contract.
 */
export async function ensureHierarchyEdge(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  parentId: Id<'nodes'>,
  childId: Id<'nodes'>,
) {
  const existing = await ctx.db
    .query('nodeEdges')
    .withIndex('by_source', (q) => q.eq('sourceNodeId', parentId))
    .filter((q) =>
      q.and(
        q.eq(q.field('targetNodeId'), childId),
        q.eq(q.field('type'), 'hierarchy'),
      ),
    )
    .first();
  if (existing) return existing._id;

  return await ctx.db.insert('nodeEdges', {
    projectId,
    sourceNodeId: parentId,
    targetNodeId: childId,
    type: 'hierarchy',
  });
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
