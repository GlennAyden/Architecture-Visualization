import { v } from 'convex/values';
import { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { getProjectIfAccessible, requireProjectAccess } from './lib/auth';
import { applySuggestionToNode, shouldAutoApplySuggestionDoc } from './lib/codebaseSuggestions';
import { linkedFileRoleValidator, nodeSemanticKindValidator } from './lib/semantic';

const suggestionStatus = v.union(
  v.literal('pending'),
  v.literal('applied'),
  v.literal('rejected'),
  v.literal('ignored'),
);
const suggestionAction = v.union(
  v.literal('create_node'),
  v.literal('link_existing_node'),
  v.literal('group_into_node'),
  v.literal('ignore'),
);

export const listByProject = query({
  args: {
    projectId: v.id('projects'),
    status: suggestionStatus,
  },
  handler: async (ctx, { projectId, status }) => {
    const project = await getProjectIfAccessible(ctx, projectId);
    if (!project) return [];

    const suggestions = await ctx.db
      .query('codebaseSuggestions')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', status))
      .take(100);

    const withLayers = await Promise.all(
      suggestions.map(async (suggestion) => {
        const layer = suggestion.layerId ? await ctx.db.get(suggestion.layerId) : null;
        const targetNode = suggestion.targetNodeId
          ? await ctx.db.get(suggestion.targetNodeId)
          : null;
        return {
          ...suggestion,
          action: suggestion.action ?? 'create_node',
          layerName: layer?.name ?? null,
          targetNodeName: targetNode?.name ?? null,
        };
      }),
    );
    return withLayers.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const apply = mutation({
  args: { id: v.id('codebaseSuggestions') },
  handler: async (ctx, { id }) => {
    const suggestion = await ctx.db.get(id);
    if (!suggestion) throw new Error('Suggestion not found');
    await requireProjectAccess(ctx, suggestion.projectId);
    if (suggestion.status === 'rejected') {
      throw new Error('Rejected suggestion cannot be applied');
    }
    if (suggestion.status === 'ignored') {
      throw new Error('Ignored suggestion cannot be applied');
    }
    if (suggestion.appliedNodeId) {
      return suggestion.appliedNodeId as Id<'nodes'>;
    }
    return await applySuggestionToNode(ctx, suggestion);
  },
});

export const reject = mutation({
  args: { id: v.id('codebaseSuggestions') },
  handler: async (ctx, { id }) => {
    const suggestion = await ctx.db.get(id);
    if (!suggestion) return;
    await requireProjectAccess(ctx, suggestion.projectId);
    if (suggestion.status === 'applied') {
      throw new Error('Applied suggestion cannot be rejected');
    }
    await ctx.db.patch(id, {
      status: 'rejected',
      updatedAt: Date.now(),
    });
  },
});

export const ignore = mutation({
  args: { id: v.id('codebaseSuggestions') },
  handler: async (ctx, { id }) => {
    const suggestion = await ctx.db.get(id);
    if (!suggestion) return;
    await requireProjectAccess(ctx, suggestion.projectId);
    if (suggestion.status === 'applied') {
      throw new Error('Applied suggestion cannot be ignored');
    }
    await ctx.db.patch(id, {
      status: 'ignored',
      updatedAt: Date.now(),
    });
  },
});

export const updateReview = mutation({
  args: {
    id: v.id('codebaseSuggestions'),
    action: v.optional(suggestionAction),
    layerId: v.optional(v.id('projectLayers')),
    targetNodeId: v.optional(v.id('nodes')),
    groupKey: v.optional(v.string()),
    suggestedNodeName: v.optional(v.string()),
    semanticKind: v.optional(nodeSemanticKindValidator),
    fileRole: v.optional(linkedFileRoleValidator),
  },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.id);
    if (!suggestion) throw new Error('Suggestion not found');
    await requireProjectAccess(ctx, suggestion.projectId);
    if (suggestion.status === 'applied') {
      throw new Error('Applied suggestion cannot be edited');
    }

    const nextAction = args.action ?? suggestion.action ?? 'create_node';
    const nextLayerId = args.layerId ?? suggestion.layerId;
    const nextTargetNodeId = args.targetNodeId ?? suggestion.targetNodeId;
    const nextGroupKey = args.groupKey?.trim() || suggestion.groupKey;

    if ((nextAction === 'create_node' || nextAction === 'group_into_node') && !nextLayerId) {
      throw new Error('Layer is required for this suggestion action');
    }
    if (nextAction === 'group_into_node' && !nextGroupKey) {
      throw new Error('Group key is required for group_into_node');
    }
    if (nextAction === 'link_existing_node' && !nextTargetNodeId) {
      throw new Error('Target node is required for link_existing_node');
    }

    if (nextLayerId) {
      const layer = await ctx.db.get(nextLayerId);
      if (!layer || layer.projectId !== suggestion.projectId) {
        throw new Error('Layer must belong to the same project');
      }
    }
    if (nextTargetNodeId) {
      const node = await ctx.db.get(nextTargetNodeId);
      if (!node || node.projectId !== suggestion.projectId) {
        throw new Error('Target node must belong to the same project');
      }
    }

    await ctx.db.patch(args.id, {
      action: nextAction,
      layerId: nextLayerId,
      targetNodeId: nextTargetNodeId,
      groupKey: nextAction === 'group_into_node' ? nextGroupKey : undefined,
      suggestedNodeName:
        args.suggestedNodeName !== undefined
          ? args.suggestedNodeName.trim()
          : suggestion.suggestedNodeName,
      semanticKind: args.semanticKind ?? suggestion.semanticKind,
      fileRole: args.fileRole ?? suggestion.fileRole,
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
      .query('codebaseSuggestions')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', 'pending'))
      .take(100);

    let applied = 0;
    let ignored = 0;
    for (const row of pending) {
      if (!shouldAutoApplySuggestionDoc(row)) continue;
      const fresh = await ctx.db.get(row._id);
      if (!fresh || fresh.status !== 'pending') continue;
      const nodeId = await applySuggestionToNode(ctx, fresh);
      if (nodeId) applied++;
      else ignored++;
    }

    return { applied, ignored };
  },
});

export const applyAllPending = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await requireProjectAccess(ctx, projectId);
    const pending = await ctx.db
      .query('codebaseSuggestions')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', 'pending'))
      .take(500);

    let applied = 0;
    let ignored = 0;
    let failed = 0;
    for (const row of pending) {
      try {
        const fresh = await ctx.db.get(row._id);
        if (!fresh || fresh.status !== 'pending') continue;
        const nodeId = await applySuggestionToNode(ctx, fresh);
        if (nodeId) applied++;
        else ignored++;
      } catch {
        failed++;
      }
    }

    return { applied, ignored, rejected: 0, failed };
  },
});

export const ignoreAllPending = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await requireProjectAccess(ctx, projectId);
    const pending = await ctx.db
      .query('codebaseSuggestions')
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
      .query('codebaseSuggestions')
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
