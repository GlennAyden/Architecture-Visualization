import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { requireOwnership } from './lib';
import { upsertSuggestion } from '../lib/codebaseSuggestions';

const suggestionValidator = v.object({
  filePath: v.string(),
  runId: v.optional(v.id('hermesMappingRuns')),
  action: v.optional(
    v.union(
      v.literal('create_node'),
      v.literal('link_existing_node'),
      v.literal('group_into_node'),
      v.literal('ignore'),
    ),
  ),
  layerId: v.optional(v.id('projectLayers')),
  targetNodeId: v.optional(v.id('nodes')),
  groupKey: v.optional(v.string()),
  suggestedNodeName: v.optional(v.string()),
  confidence: v.number(),
  reason: v.string(),
  evidence: v.optional(v.array(v.string())),
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
    let ignored = 0;

    for (const suggestion of suggestions) {
      const result = await upsertSuggestion(ctx, scopeProjectId, suggestion);
      if (result.status === 'skipped') {
        skipped.push({ filePath: result.filePath, reason: result.reason });
      } else if (result.status === 'applied') {
        applied++;
      } else if (result.status === 'ignored') {
        ignored++;
      } else {
        pending++;
      }
    }

    return {
      accepted: pending + applied + ignored,
      pending,
      applied,
      ignored,
      skipped,
    };
  },
});
