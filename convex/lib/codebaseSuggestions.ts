import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';
import { defaultNodePosition } from './layers';

export const CODEBASE_SUGGESTION_AUTO_APPLY_CONFIDENCE = 0.85;

export interface CodebaseSuggestionInput {
  filePath: string;
  layerId: Id<'projectLayers'>;
  suggestedNodeName: string;
  confidence: number;
  reason: string;
  source: string;
}

export function normalizeSuggestionPath(path: string): string {
  return path.trim().replace(/\\/g, '/');
}

function fallbackNodeName(path: string): string {
  const fileName = path.split('/').at(-1) ?? path;
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  const words = withoutExtension.replace(/[-_.]+/g, ' ').trim();
  return words.length > 0 ? words : fileName;
}

export async function findLinkedNodeForPath(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  filePath: string,
) {
  const links = await ctx.db
    .query('nodeFiles')
    .filter((q) => q.eq(q.field('path'), filePath))
    .collect();

  for (const link of links) {
    if (link.archived) continue;
    const node = await ctx.db.get(link.nodeId);
    if (node?.projectId === projectId) return node;
  }
  return null;
}

export async function applySuggestionToNode(
  ctx: MutationCtx,
  suggestion: Doc<'codebaseSuggestions'>,
) {
  const existingNode = await findLinkedNodeForPath(ctx, suggestion.projectId, suggestion.filePath);
  if (existingNode) {
    await ctx.db.patch(suggestion._id, {
      status: 'applied',
      appliedNodeId: existingNode._id,
      updatedAt: Date.now(),
    });
    return existingNode._id;
  }

  const layer = await ctx.db.get(suggestion.layerId);
  if (!layer || layer.projectId !== suggestion.projectId) {
    throw new Error('Layer must belong to the same project');
  }

  const nodes = await ctx.db
    .query('nodes')
    .withIndex('by_project', (q) => q.eq('projectId', suggestion.projectId))
    .collect();
  const siblingCount = nodes.filter(
    (node) => !node.parentId && node.layerId === suggestion.layerId,
  ).length;
  const position = defaultNodePosition({
    type: 'page',
    layer,
    siblingCount,
  });
  const trimmedName = suggestion.suggestedNodeName.trim() || fallbackNodeName(suggestion.filePath);

  const nodeId = await ctx.db.insert('nodes', {
    projectId: suggestion.projectId,
    layerId: suggestion.layerId,
    type: 'page',
    name: trimmedName,
    positionX: position.x,
    positionY: position.y,
  });
  await ctx.db.insert('nodeFiles', {
    nodeId,
    path: suggestion.filePath,
  });
  await ctx.db.patch(suggestion._id, {
    status: 'applied',
    appliedNodeId: nodeId,
    updatedAt: Date.now(),
  });
  return nodeId;
}

export async function upsertSuggestion(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  input: CodebaseSuggestionInput,
) {
  const filePath = normalizeSuggestionPath(input.filePath);
  const layer = await ctx.db.get(input.layerId);
  if (!layer || layer.projectId !== projectId) {
    throw new Error('Layer not in token scope');
  }

  const linkedNode = await findLinkedNodeForPath(ctx, projectId, filePath);
  if (linkedNode) {
    return {
      status: 'skipped' as const,
      filePath,
      reason: 'already_linked' as const,
      nodeId: linkedNode._id,
    };
  }

  const existing = await ctx.db
    .query('codebaseSuggestions')
    .withIndex('by_project_file', (q) => q.eq('projectId', projectId).eq('filePath', filePath))
    .unique();
  if (existing?.status === 'applied') {
    return {
      status: 'skipped' as const,
      filePath,
      reason: 'already_applied' as const,
      nodeId: existing.appliedNodeId,
    };
  }

  const now = Date.now();
  const patch = {
    layerId: input.layerId,
    suggestedNodeName: input.suggestedNodeName.trim() || fallbackNodeName(filePath),
    confidence: input.confidence,
    reason: input.reason.trim(),
    source: input.source.trim() || 'hermes',
    status: 'pending' as const,
    updatedAt: now,
  };

  const suggestionId = existing
    ? existing._id
    : await ctx.db.insert('codebaseSuggestions', {
        projectId,
        filePath,
        ...patch,
      });

  if (existing) {
    await ctx.db.patch(existing._id, patch);
  }

  const suggestion = await ctx.db.get(suggestionId);
  if (!suggestion) throw new Error('Suggestion not found after write');

  if (input.confidence >= CODEBASE_SUGGESTION_AUTO_APPLY_CONFIDENCE) {
    const nodeId = await applySuggestionToNode(ctx, suggestion);
    return { status: 'applied' as const, filePath, nodeId };
  }

  return { status: 'pending' as const, filePath, suggestionId };
}
