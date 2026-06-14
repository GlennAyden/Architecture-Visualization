import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getProjectIfAccessible, requireProjectAccess } from './lib/auth';
import { shouldAutoApplyArchitectureFlow } from './lib/architectureFlows';
import { architectureFlowStatusValidator } from './lib/semantic';

export const listByProject = query({
  args: {
    projectId: v.id('projects'),
    status: architectureFlowStatusValidator,
  },
  handler: async (ctx, { projectId, status }) => {
    const project = await getProjectIfAccessible(ctx, projectId);
    if (!project) return [];

    const flows = await ctx.db
      .query('architectureFlows')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', status))
      .take(100);

    const withNames = await Promise.all(
      flows.map(async (flow) => {
        const nodePairs = await Promise.all(
          flow.nodeIds.map(async (nodeId) => {
            const node = await ctx.db.get(nodeId);
            return [nodeId as string, node?.name ?? 'Unknown node'] as const;
          }),
        );
        return {
          ...flow,
          nodeNames: Object.fromEntries(nodePairs),
        };
      }),
    );

    return withNames.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const apply = mutation({
  args: { id: v.id('architectureFlows') },
  handler: async (ctx, { id }) => {
    const flow = await ctx.db.get(id);
    if (!flow) throw new Error('Architecture flow not found');
    await requireProjectAccess(ctx, flow.projectId);
    if (flow.status === 'rejected') throw new Error('Rejected flow cannot be applied');
    if (flow.status === 'ignored') throw new Error('Ignored flow cannot be applied');
    await ctx.db.patch(id, { status: 'applied', updatedAt: Date.now() });
    return id;
  },
});

export const reject = mutation({
  args: { id: v.id('architectureFlows') },
  handler: async (ctx, { id }) => {
    const flow = await ctx.db.get(id);
    if (!flow) return;
    await requireProjectAccess(ctx, flow.projectId);
    if (flow.status === 'applied') throw new Error('Applied flow cannot be rejected');
    await ctx.db.patch(id, { status: 'rejected', updatedAt: Date.now() });
  },
});

export const ignore = mutation({
  args: { id: v.id('architectureFlows') },
  handler: async (ctx, { id }) => {
    const flow = await ctx.db.get(id);
    if (!flow) return;
    await requireProjectAccess(ctx, flow.projectId);
    if (flow.status === 'applied') throw new Error('Applied flow cannot be ignored');
    await ctx.db.patch(id, { status: 'ignored', updatedAt: Date.now() });
  },
});

export const applyHighConfidence = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await requireProjectAccess(ctx, projectId);
    const pending = await ctx.db
      .query('architectureFlows')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', 'pending'))
      .take(100);

    let applied = 0;
    for (const row of pending) {
      if (!shouldAutoApplyArchitectureFlow(row)) continue;
      await ctx.db.patch(row._id, { status: 'applied', updatedAt: Date.now() });
      applied++;
    }
    return { applied };
  },
});
