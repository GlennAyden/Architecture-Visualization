import { v } from 'convex/values';
import { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { getProjectIfAccessible, requireProjectAccess } from './lib/auth';
import { applySuggestionToNode } from './lib/codebaseSuggestions';

const suggestionStatus = v.union(v.literal('pending'), v.literal('applied'), v.literal('rejected'));

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
      .collect();

    const withLayers = await Promise.all(
      suggestions.map(async (suggestion) => {
        const layer = await ctx.db.get(suggestion.layerId);
        return {
          ...suggestion,
          layerName: layer?.name ?? 'Unknown layer',
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
