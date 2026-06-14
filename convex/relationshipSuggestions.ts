import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getProjectIfAccessible, requireProjectAccess } from './lib/auth';
import {
  applyRelationshipSuggestion,
  shouldAutoApplyRelationshipSuggestion,
} from './lib/relationshipSuggestions';
import { relationshipSuggestionStatusValidator } from './lib/semantic';

export const listByProject = query({
  args: {
    projectId: v.id('projects'),
    status: relationshipSuggestionStatusValidator,
  },
  handler: async (ctx, { projectId, status }) => {
    const project = await getProjectIfAccessible(ctx, projectId);
    if (!project) return [];

    const suggestions = await ctx.db
      .query('relationshipSuggestions')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', status))
      .take(100);

    const withNames = await Promise.all(
      suggestions.map(async (suggestion) => {
        const source = await ctx.db.get(suggestion.sourceNodeId);
        const target = await ctx.db.get(suggestion.targetNodeId);
        return {
          ...suggestion,
          sourceNodeName: source?.name ?? null,
          targetNodeName: target?.name ?? null,
        };
      }),
    );
    return withNames.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const apply = mutation({
  args: { id: v.id('relationshipSuggestions') },
  handler: async (ctx, { id }) => {
    const suggestion = await ctx.db.get(id);
    if (!suggestion) throw new Error('Relationship suggestion not found');
    await requireProjectAccess(ctx, suggestion.projectId);
    if (suggestion.status === 'rejected') {
      throw new Error('Rejected relationship suggestion cannot be applied');
    }
    if (suggestion.status === 'ignored') {
      throw new Error('Ignored relationship suggestion cannot be applied');
    }
    if (suggestion.appliedEdgeId) return suggestion.appliedEdgeId;
    return await applyRelationshipSuggestion(ctx, suggestion);
  },
});

export const reject = mutation({
  args: { id: v.id('relationshipSuggestions') },
  handler: async (ctx, { id }) => {
    const suggestion = await ctx.db.get(id);
    if (!suggestion) return;
    await requireProjectAccess(ctx, suggestion.projectId);
    if (suggestion.status === 'applied') {
      throw new Error('Applied relationship suggestion cannot be rejected');
    }
    await ctx.db.patch(id, {
      status: 'rejected',
      updatedAt: Date.now(),
    });
  },
});

export const ignore = mutation({
  args: { id: v.id('relationshipSuggestions') },
  handler: async (ctx, { id }) => {
    const suggestion = await ctx.db.get(id);
    if (!suggestion) return;
    await requireProjectAccess(ctx, suggestion.projectId);
    if (suggestion.status === 'applied') {
      throw new Error('Applied relationship suggestion cannot be ignored');
    }
    await ctx.db.patch(id, {
      status: 'ignored',
      updatedAt: Date.now(),
    });
  },
});

export const applyHighConfidence = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await requireProjectAccess(ctx, projectId);
    const pending = await ctx.db
      .query('relationshipSuggestions')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', 'pending'))
      .take(100);

    let applied = 0;
    for (const row of pending) {
      if (!shouldAutoApplyRelationshipSuggestion(row)) continue;
      const fresh = await ctx.db.get(row._id);
      if (!fresh || fresh.status !== 'pending') continue;
      await applyRelationshipSuggestion(ctx, fresh);
      applied++;
    }

    return { applied };
  },
});
