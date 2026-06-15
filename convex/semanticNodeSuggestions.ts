import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getProjectIfAccessible, requireProjectAccess } from './lib/auth';
import {
  applySemanticNodeSuggestion,
  shouldAutoApplySemanticNodeSuggestion,
} from './lib/semanticNodeSuggestions';
import {
  nodeSemanticKindValidator,
  productAreaValidator,
  relationshipSuggestionStatusValidator,
} from './lib/semantic';

export const listByProject = query({
  args: {
    projectId: v.id('projects'),
    status: relationshipSuggestionStatusValidator,
  },
  handler: async (ctx, { projectId, status }) => {
    const project = await getProjectIfAccessible(ctx, projectId);
    if (!project) return [];

    const suggestions = await ctx.db
      .query('semanticNodeSuggestions')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', status))
      .take(100);

    const rows = await Promise.all(
      suggestions.map(async (suggestion) => {
        const layer = await ctx.db.get(suggestion.layerId);
        const parent = suggestion.parentNodeId ? await ctx.db.get(suggestion.parentNodeId) : null;
        const applied = suggestion.appliedNodeId
          ? await ctx.db.get(suggestion.appliedNodeId)
          : null;
        return {
          ...suggestion,
          layerName: layer?.name ?? null,
          parentNodeName: parent?.name ?? null,
          appliedNodeName: applied?.name ?? null,
        };
      }),
    );
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const apply = mutation({
  args: { id: v.id('semanticNodeSuggestions') },
  handler: async (ctx, { id }) => {
    const suggestion = await ctx.db.get(id);
    if (!suggestion) throw new Error('Semantic node suggestion not found');
    await requireProjectAccess(ctx, suggestion.projectId);
    if (suggestion.status === 'rejected') {
      throw new Error('Rejected semantic node suggestion cannot be applied');
    }
    if (suggestion.status === 'ignored') {
      throw new Error('Ignored semantic node suggestion cannot be applied');
    }
    if (suggestion.appliedNodeId) return suggestion.appliedNodeId;
    return await applySemanticNodeSuggestion(ctx, suggestion);
  },
});

export const reject = mutation({
  args: { id: v.id('semanticNodeSuggestions') },
  handler: async (ctx, { id }) => {
    const suggestion = await ctx.db.get(id);
    if (!suggestion) return;
    await requireProjectAccess(ctx, suggestion.projectId);
    if (suggestion.status === 'applied') {
      throw new Error('Applied semantic node suggestion cannot be rejected');
    }
    await ctx.db.patch(id, { status: 'rejected', updatedAt: Date.now() });
  },
});

export const ignore = mutation({
  args: { id: v.id('semanticNodeSuggestions') },
  handler: async (ctx, { id }) => {
    const suggestion = await ctx.db.get(id);
    if (!suggestion) return;
    await requireProjectAccess(ctx, suggestion.projectId);
    if (suggestion.status === 'applied') {
      throw new Error('Applied semantic node suggestion cannot be ignored');
    }
    await ctx.db.patch(id, { status: 'ignored', updatedAt: Date.now() });
  },
});

export const updateReview = mutation({
  args: {
    id: v.id('semanticNodeSuggestions'),
    suggestedNodeName: v.optional(v.string()),
    semanticKind: v.optional(nodeSemanticKindValidator),
    productArea: v.optional(productAreaValidator),
    capabilityKey: v.optional(v.string()),
    routeHint: v.optional(v.string()),
    layerId: v.optional(v.id('projectLayers')),
    parentNodeId: v.optional(v.id('nodes')),
  },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.id);
    if (!suggestion) throw new Error('Semantic node suggestion not found');
    await requireProjectAccess(ctx, suggestion.projectId);
    if (suggestion.status === 'applied') {
      throw new Error('Applied semantic node suggestion cannot be edited');
    }

    const layerId = args.layerId ?? suggestion.layerId;
    const layer = await ctx.db.get(layerId);
    if (!layer || layer.projectId !== suggestion.projectId) {
      throw new Error('Layer must belong to the same project');
    }

    if (args.parentNodeId) {
      const parent = await ctx.db.get(args.parentNodeId);
      if (!parent || parent.projectId !== suggestion.projectId) {
        throw new Error('Parent node must belong to the same project');
      }
    }

    await ctx.db.patch(args.id, {
      suggestedNodeName:
        args.suggestedNodeName !== undefined
          ? args.suggestedNodeName.trim()
          : suggestion.suggestedNodeName,
      semanticKind: args.semanticKind ?? suggestion.semanticKind,
      productArea: args.productArea ?? suggestion.productArea,
      capabilityKey:
        args.capabilityKey !== undefined
          ? args.capabilityKey.trim() || undefined
          : suggestion.capabilityKey,
      routeHint:
        args.routeHint !== undefined ? args.routeHint.trim() || undefined : suggestion.routeHint,
      layerId,
      parentNodeId: args.parentNodeId ?? suggestion.parentNodeId,
      status: 'pending',
      updatedAt: Date.now(),
    });
  },
});

export const applyHighConfidence = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await requireProjectAccess(ctx, projectId);
    const pending = await ctx.db
      .query('semanticNodeSuggestions')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', 'pending'))
      .take(100);

    let applied = 0;
    for (const row of pending) {
      if (!shouldAutoApplySemanticNodeSuggestion(row)) continue;
      const fresh = await ctx.db.get(row._id);
      if (!fresh || fresh.status !== 'pending') continue;
      await applySemanticNodeSuggestion(ctx, fresh);
      applied++;
    }
    return { applied };
  },
});

export const applyAllPending = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await requireProjectAccess(ctx, projectId);
    const pending = await ctx.db
      .query('semanticNodeSuggestions')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', 'pending'))
      .take(500);

    let applied = 0;
    let failed = 0;
    for (const row of pending) {
      try {
        const fresh = await ctx.db.get(row._id);
        if (!fresh || fresh.status !== 'pending') continue;
        await applySemanticNodeSuggestion(ctx, fresh);
        applied++;
      } catch {
        failed++;
      }
    }
    return { applied, ignored: 0, rejected: 0, failed };
  },
});

export const ignoreAllPending = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await requireProjectAccess(ctx, projectId);
    const pending = await ctx.db
      .query('semanticNodeSuggestions')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', 'pending'))
      .take(500);

    let ignored = 0;
    for (const row of pending) {
      await ctx.db.patch(row._id, { status: 'ignored', updatedAt: Date.now() });
      ignored++;
    }
    return { applied: 0, ignored, rejected: 0, failed: 0 };
  },
});

export const rejectAllPending = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await requireProjectAccess(ctx, projectId);
    const pending = await ctx.db
      .query('semanticNodeSuggestions')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', 'pending'))
      .take(500);

    let rejected = 0;
    for (const row of pending) {
      await ctx.db.patch(row._id, { status: 'rejected', updatedAt: Date.now() });
      rejected++;
    }
    return { applied: 0, ignored: 0, rejected, failed: 0 };
  },
});
