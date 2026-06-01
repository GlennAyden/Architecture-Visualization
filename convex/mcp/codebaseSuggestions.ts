import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { requireOwnership } from './lib';
import { upsertSuggestion } from '../lib/codebaseSuggestions';

const suggestionValidator = v.object({
  filePath: v.string(),
  layerId: v.id('projectLayers'),
  suggestedNodeName: v.string(),
  confidence: v.number(),
  reason: v.string(),
  source: v.string(),
});

export const pushForProject = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    suggestions: v.array(suggestionValidator),
  },
  handler: async (ctx, { userId, scopeProjectId, suggestions }) => {
    await requireOwnership(ctx, userId, scopeProjectId);

    const skipped: Array<{ filePath: string; reason: string }> = [];
    let pending = 0;
    let applied = 0;

    for (const suggestion of suggestions) {
      const result = await upsertSuggestion(ctx, scopeProjectId, suggestion);
      if (result.status === 'skipped') {
        skipped.push({ filePath: result.filePath, reason: result.reason });
      } else if (result.status === 'applied') {
        applied++;
      } else {
        pending++;
      }
    }

    return {
      accepted: pending + applied,
      pending,
      applied,
      skipped,
    };
  },
});
