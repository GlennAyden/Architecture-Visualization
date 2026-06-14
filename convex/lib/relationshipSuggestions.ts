import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';
import { upsertManualEdge } from './edges';

export const RELATIONSHIP_AUTO_APPLY_CONFIDENCE = 0.9;

export type RelationshipSuggestionType = 'dependency' | 'navigation' | 'data_flow';

export interface RelationshipSuggestionInput {
  runId?: Id<'hermesMappingRuns'>;
  sourceNodeId: Id<'nodes'>;
  targetNodeId: Id<'nodes'>;
  type: RelationshipSuggestionType;
  label?: string;
  confidence: number;
  reason: string;
  evidence?: string[];
  source: string;
}

function normalizeLabel(label: string | undefined) {
  const trimmed = label?.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

async function ensureNodeInProject(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  nodeId: Id<'nodes'>,
) {
  const node = await ctx.db.get(nodeId);
  if (!node || node.projectId !== projectId) {
    throw new Error('Relationship node must belong to the same project');
  }
  return node;
}

export function shouldAutoApplyRelationshipSuggestion(
  suggestion: Pick<Doc<'relationshipSuggestions'>, 'confidence'>,
) {
  return suggestion.confidence >= RELATIONSHIP_AUTO_APPLY_CONFIDENCE;
}

export async function applyRelationshipSuggestion(
  ctx: MutationCtx,
  suggestion: Doc<'relationshipSuggestions'>,
) {
  await ensureNodeInProject(ctx, suggestion.projectId, suggestion.sourceNodeId);
  await ensureNodeInProject(ctx, suggestion.projectId, suggestion.targetNodeId);

  const edgeId = await upsertManualEdge(ctx, {
    projectId: suggestion.projectId,
    sourceNodeId: suggestion.sourceNodeId,
    targetNodeId: suggestion.targetNodeId,
    type: suggestion.type,
    label: suggestion.label,
    confidence: suggestion.confidence,
    reason: suggestion.reason,
    evidence: suggestion.evidence,
    sourceRunId: suggestion.runId,
  });

  await ctx.db.patch(suggestion._id, {
    status: 'applied',
    appliedEdgeId: edgeId,
    updatedAt: Date.now(),
  });
  return edgeId;
}

export async function upsertRelationshipSuggestion(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  input: RelationshipSuggestionInput,
) {
  if (input.sourceNodeId === input.targetNodeId) {
    throw new Error('Relationship source and target must differ');
  }
  await ensureNodeInProject(ctx, projectId, input.sourceNodeId);
  await ensureNodeInProject(ctx, projectId, input.targetNodeId);

  const existing = await ctx.db
    .query('relationshipSuggestions')
    .withIndex('by_project_nodes_type', (q) =>
      q
        .eq('projectId', projectId)
        .eq('sourceNodeId', input.sourceNodeId)
        .eq('targetNodeId', input.targetNodeId)
        .eq('type', input.type),
    )
    .unique();

  if (existing?.status === 'applied' || existing?.status === 'ignored') {
    return {
      status: 'skipped' as const,
      reason:
        existing.status === 'applied' ? ('already_applied' as const) : ('already_ignored' as const),
      suggestionId: existing._id,
      edgeId: existing.appliedEdgeId,
    };
  }

  const now = Date.now();
  const patch = {
    runId: input.runId,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    type: input.type,
    label: normalizeLabel(input.label),
    confidence: input.confidence,
    reason: input.reason.trim(),
    evidence: input.evidence,
    source: input.source.trim() || 'hermes',
    status: 'pending' as const,
    appliedEdgeId: undefined,
    updatedAt: now,
  };

  const suggestionId = existing
    ? existing._id
    : await ctx.db.insert('relationshipSuggestions', {
        projectId,
        createdAt: now,
        ...patch,
      });

  if (existing) await ctx.db.patch(existing._id, patch);

  const suggestion = await ctx.db.get(suggestionId);
  if (!suggestion) throw new Error('Relationship suggestion not found after write');

  if (shouldAutoApplyRelationshipSuggestion(suggestion)) {
    const edgeId = await applyRelationshipSuggestion(ctx, suggestion);
    return { status: 'applied' as const, suggestionId, edgeId };
  }

  return { status: 'pending' as const, suggestionId };
}
