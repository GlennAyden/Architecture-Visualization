import { Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';

/**
 * Delete a node together with everything that hangs off it: child nodes
 * (nested features), linked files, and kanban tasks. Recursive so deleting
 * a parent of nested features cascades cleanly.
 */
export async function deleteNodeCascade(ctx: MutationCtx, nodeId: Id<'nodes'>) {
  const node = await ctx.db.get(nodeId);
  if (!node) return;

  const children = await ctx.db
    .query('nodes')
    .withIndex('by_parent', (q) => q.eq('parentId', nodeId))
    .collect();
  for (const child of children) {
    await deleteNodeCascade(ctx, child._id);
  }

  const files = await ctx.db
    .query('nodeFiles')
    .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
    .collect();
  for (const file of files) {
    await ctx.db.delete(file._id);
  }

  const tasks = await ctx.db
    .query('kanbanTasks')
    .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
    .collect();
  for (const task of tasks) {
    await ctx.db.delete(task._id);
  }

  const activity = await ctx.db
    .query('activityLog')
    .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
    .collect();
  for (const entry of activity) {
    await ctx.db.delete(entry._id);
  }

  await ctx.db.delete(nodeId);
}
