import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';
import { defaultNodePosition } from './layers';

export const CREATE_NODE_AUTO_APPLY_CONFIDENCE = 0.85;
export const LINK_OR_IGNORE_AUTO_APPLY_CONFIDENCE = 0.9;

export type CodebaseSuggestionAction =
  | 'create_node'
  | 'link_existing_node'
  | 'group_into_node'
  | 'ignore';

export interface CodebaseSuggestionInput {
  filePath: string;
  runId?: Id<'hermesMappingRuns'>;
  action?: CodebaseSuggestionAction;
  layerId?: Id<'projectLayers'>;
  targetNodeId?: Id<'nodes'>;
  groupKey?: string;
  suggestedNodeName?: string;
  confidence: number;
  reason: string;
  evidence?: string[];
  semanticKind?: Doc<'nodes'>['semanticKind'];
  fileRole?: Doc<'nodeFiles'>['role'];
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

function suggestionAction(
  suggestion: Pick<Doc<'codebaseSuggestions'>, 'action'>,
): CodebaseSuggestionAction {
  return suggestion.action ?? 'create_node';
}

export function shouldAutoApplySuggestion(action: CodebaseSuggestionAction, confidence: number) {
  if (action === 'link_existing_node' || action === 'ignore') {
    return confidence >= LINK_OR_IGNORE_AUTO_APPLY_CONFIDENCE;
  }
  return confidence >= CREATE_NODE_AUTO_APPLY_CONFIDENCE;
}

export function shouldAutoApplySuggestionDoc(suggestion: Doc<'codebaseSuggestions'>) {
  return shouldAutoApplySuggestion(suggestionAction(suggestion), suggestion.confidence);
}

export async function findLinkedNodeForPath(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  filePath: string,
) {
  const links = await ctx.db
    .query('nodeFiles')
    .withIndex('by_path', (q) => q.eq('path', filePath))
    .collect();

  for (const link of links) {
    if (link.archived) continue;
    const node = await ctx.db.get(link.nodeId);
    if (node?.projectId === projectId) return node;
  }
  return null;
}

async function ensureLayerInProject(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  layerId: Id<'projectLayers'> | undefined,
) {
  if (!layerId) throw new Error('Layer is required for this suggestion action');
  const layer = await ctx.db.get(layerId);
  if (!layer || layer.projectId !== projectId) {
    throw new Error('Layer not in token scope');
  }
  return layer;
}

async function ensureTargetNodeInProject(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  nodeId: Id<'nodes'> | undefined,
) {
  if (!nodeId) throw new Error('Target node is required for link_existing_node');
  const node = await ctx.db.get(nodeId);
  if (!node || node.projectId !== projectId) {
    throw new Error('Target node not in token scope');
  }
  return node;
}

async function linkFileToNode(
  ctx: MutationCtx,
  nodeId: Id<'nodes'>,
  filePath: string,
  suggestion?: Pick<
    Doc<'codebaseSuggestions'>,
    'fileRole' | 'source' | 'confidence' | 'reason' | 'evidence'
  >,
) {
  const existing = await ctx.db
    .query('nodeFiles')
    .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
    .collect();
  const duplicate = existing.find((file) => file.path === filePath);
  const patch = suggestion
    ? {
        role: suggestion.fileRole,
        source: suggestion.source,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
        evidence: suggestion.evidence,
      }
    : {};
  if (duplicate) {
    if (Object.values(patch).some((value) => value !== undefined)) {
      await ctx.db.patch(duplicate._id, patch);
    }
    return duplicate._id;
  }
  return await ctx.db.insert('nodeFiles', { nodeId, path: filePath, ...patch });
}

async function createPageNodeForSuggestion(
  ctx: MutationCtx,
  suggestion: Doc<'codebaseSuggestions'>,
) {
  const layer = await ensureLayerInProject(ctx, suggestion.projectId, suggestion.layerId);
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

  return await ctx.db.insert('nodes', {
    projectId: suggestion.projectId,
    layerId: suggestion.layerId,
    type: 'page',
    name: trimmedName,
    positionX: position.x,
    positionY: position.y,
    semanticKind: suggestion.semanticKind,
    mappingStatus: shouldAutoApplySuggestionDoc(suggestion) ? 'auto_mapped' : 'suggested',
    mappingConfidence: suggestion.confidence,
  });
}

async function applyToExistingNode(ctx: MutationCtx, suggestion: Doc<'codebaseSuggestions'>) {
  const node = await ensureTargetNodeInProject(ctx, suggestion.projectId, suggestion.targetNodeId);
  await linkFileToNode(ctx, node._id, suggestion.filePath, suggestion);
  await patchNodeMappingFromSuggestion(ctx, node._id, suggestion);
  await ctx.db.patch(suggestion._id, {
    status: 'applied',
    appliedNodeId: node._id,
    updatedAt: Date.now(),
  });
  return node._id;
}

async function patchNodeMappingFromSuggestion(
  ctx: MutationCtx,
  nodeId: Id<'nodes'>,
  suggestion: Doc<'codebaseSuggestions'>,
) {
  const patch: Partial<Doc<'nodes'>> = {};
  if (suggestion.semanticKind) patch.semanticKind = suggestion.semanticKind;
  if (suggestion.confidence !== undefined) patch.mappingConfidence = suggestion.confidence;
  if (suggestion.status !== 'applied') {
    patch.mappingStatus = shouldAutoApplySuggestionDoc(suggestion) ? 'auto_mapped' : 'suggested';
  }
  if (Object.keys(patch).length > 0) await ctx.db.patch(nodeId, patch);
}

async function findAppliedGroupNode(ctx: MutationCtx, projectId: Id<'projects'>, groupKey: string) {
  const applied = await ctx.db
    .query('codebaseSuggestions')
    .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', 'applied'))
    .take(500);
  for (const row of applied) {
    if (suggestionAction(row) !== 'group_into_node' || row.groupKey !== groupKey) continue;
    if (!row.appliedNodeId) continue;
    const node = await ctx.db.get(row.appliedNodeId);
    if (node?.projectId === projectId) return node._id;
  }
  return null;
}

async function applyGroupedSuggestion(ctx: MutationCtx, suggestion: Doc<'codebaseSuggestions'>) {
  const groupKey = suggestion.groupKey?.trim();
  if (!groupKey) throw new Error('groupKey is required for group_into_node');

  let nodeId = await findAppliedGroupNode(ctx, suggestion.projectId, groupKey);
  if (!nodeId) {
    nodeId = await createPageNodeForSuggestion(ctx, suggestion);
  }

  const pending = await ctx.db
    .query('codebaseSuggestions')
    .withIndex('by_project_status', (q) =>
      q.eq('projectId', suggestion.projectId).eq('status', 'pending'),
    )
    .take(500);
  const groupRows = pending.filter(
    (row) => suggestionAction(row) === 'group_into_node' && row.groupKey === groupKey,
  );
  if (!groupRows.some((row) => row._id === suggestion._id)) groupRows.push(suggestion);

  const now = Date.now();
  for (const row of groupRows) {
    const linkedNode = await findLinkedNodeForPath(ctx, row.projectId, row.filePath);
    const targetNodeId = linkedNode?._id ?? nodeId;
    await linkFileToNode(ctx, targetNodeId, row.filePath, row);
    await patchNodeMappingFromSuggestion(ctx, targetNodeId, row);
    await ctx.db.patch(row._id, {
      status: 'applied',
      appliedNodeId: targetNodeId,
      updatedAt: now,
    });
  }

  return nodeId;
}

export async function applySuggestionToNode(
  ctx: MutationCtx,
  suggestion: Doc<'codebaseSuggestions'>,
) {
  const action = suggestionAction(suggestion);
  if (action === 'ignore') {
    await ctx.db.patch(suggestion._id, {
      status: 'ignored',
      updatedAt: Date.now(),
    });
    return null;
  }

  const existingNode = await findLinkedNodeForPath(ctx, suggestion.projectId, suggestion.filePath);
  if (existingNode) {
    await patchNodeMappingFromSuggestion(ctx, existingNode._id, suggestion);
    await ctx.db.patch(suggestion._id, {
      status: 'applied',
      appliedNodeId: existingNode._id,
      updatedAt: Date.now(),
    });
    return existingNode._id;
  }

  if (action === 'link_existing_node') return await applyToExistingNode(ctx, suggestion);
  if (action === 'group_into_node') return await applyGroupedSuggestion(ctx, suggestion);

  const nodeId = await createPageNodeForSuggestion(ctx, suggestion);
  await linkFileToNode(ctx, nodeId, suggestion.filePath, suggestion);
  await ctx.db.patch(suggestion._id, {
    status: 'applied',
    appliedNodeId: nodeId,
    updatedAt: Date.now(),
  });
  return nodeId;
}

async function validateSuggestionTargets(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  action: CodebaseSuggestionAction,
  input: CodebaseSuggestionInput,
) {
  if (action === 'create_node' || action === 'group_into_node') {
    await ensureLayerInProject(ctx, projectId, input.layerId);
  }
  if (action === 'link_existing_node') {
    await ensureTargetNodeInProject(ctx, projectId, input.targetNodeId);
  }
}

export async function upsertSuggestion(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  input: CodebaseSuggestionInput,
) {
  const filePath = normalizeSuggestionPath(input.filePath);
  const action = input.action ?? 'create_node';
  await validateSuggestionTargets(ctx, projectId, action, input);

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
  if (existing?.status === 'applied' || existing?.status === 'ignored') {
    return {
      status: 'skipped' as const,
      filePath,
      reason:
        existing.status === 'applied' ? ('already_applied' as const) : ('already_ignored' as const),
      nodeId: existing.appliedNodeId,
    };
  }

  const now = Date.now();
  const patch = {
    runId: input.runId,
    action,
    layerId: input.layerId,
    targetNodeId: input.targetNodeId,
    groupKey: input.groupKey?.trim() || undefined,
    suggestedNodeName: input.suggestedNodeName?.trim() || fallbackNodeName(filePath),
    confidence: input.confidence,
    reason: input.reason.trim(),
    evidence: input.evidence,
    semanticKind: input.semanticKind,
    fileRole: input.fileRole,
    source: input.source.trim() || 'hermes',
    status: 'pending' as const,
    appliedNodeId: undefined,
    updatedAt: now,
  };

  const suggestionId = existing
    ? existing._id
    : await ctx.db.insert('codebaseSuggestions', {
        projectId,
        filePath,
        createdAt: now,
        ...patch,
      });

  if (existing) {
    await ctx.db.patch(existing._id, patch);
  }

  const suggestion = await ctx.db.get(suggestionId);
  if (!suggestion) throw new Error('Suggestion not found after write');

  if (shouldAutoApplySuggestion(action, input.confidence)) {
    const nodeId = await applySuggestionToNode(ctx, suggestion);
    if (action === 'ignore') return { status: 'ignored' as const, filePath, suggestionId };
    return { status: 'applied' as const, filePath, nodeId };
  }

  return { status: 'pending' as const, filePath, suggestionId };
}
