import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';
import { ensureHierarchyEdge, upsertManualEdge } from './edges';
import { defaultNodePosition } from './layers';
import { upsertArchitectureFlow } from './architectureFlows';

export const UI_MODULE_AUTO_APPLY_CONFIDENCE = 0.88;
export const PRODUCT_CAPABILITY_AUTO_APPLY_CONFIDENCE = 0.9;

export interface SemanticNodeSuggestionInput {
  runId?: Id<'hermesMappingRuns'>;
  sourceFilePath: string;
  semanticKey: string;
  suggestedNodeName: string;
  semanticKind: NonNullable<Doc<'nodes'>['semanticKind']>;
  productArea: NonNullable<Doc<'nodes'>['productArea']>;
  capabilityKey?: string;
  routeHint?: string;
  layerId: Id<'projectLayers'>;
  parentNodeId?: Id<'nodes'>;
  confidence: number;
  reason: string;
  evidence?: string[];
  source: string;
}

function normalizePath(path: string) {
  return path.trim().replace(/\\/g, '/');
}

function normalizeKey(key: string) {
  return key.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 180);
}

function normalizeIdentityToken(value: string | undefined, fallback = 'unknown') {
  const token = (value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return token || fallback;
}

function normalizeRouteScope(value: string | undefined) {
  if (!value) return undefined;
  const route = value.trim().toLowerCase();
  if (!route) return undefined;
  if (route.startsWith('/api/')) return undefined;
  return normalizeIdentityToken(route);
}

function semanticIdentityName(value: string | undefined, fallback = 'semantic-node') {
  return normalizeIdentityToken(value, fallback);
}

export function semanticDuplicateKeyForNode(
  node: Pick<
    Doc<'nodes'>,
    'semanticKind' | 'productArea' | 'parentId' | 'capabilityKey' | 'routeHint' | 'name'
  >,
) {
  if (node.semanticKind !== 'ui_module') return null;
  const area = node.productArea ?? 'unknown';
  const capability = node.capabilityKey
    ? normalizeIdentityToken(node.capabilityKey)
    : semanticIdentityName(node.name);
  const scope = node.parentId
    ? `parent:${node.parentId as string}`
    : normalizeRouteScope(node.routeHint)
      ? `route:${normalizeRouteScope(node.routeHint)}`
      : 'top';
  return `ui:${area}:${scope}:${capability}`;
}

function semanticMergeKeyForSuggestion(
  suggestion: Pick<
    Doc<'semanticNodeSuggestions'>,
    | 'semanticKind'
    | 'productArea'
    | 'parentNodeId'
    | 'capabilityKey'
    | 'routeHint'
    | 'suggestedNodeName'
  >,
) {
  if (suggestion.semanticKind !== 'ui_module') return null;
  const area = suggestion.productArea ?? 'unknown';
  const capability = suggestion.capabilityKey
    ? normalizeIdentityToken(suggestion.capabilityKey)
    : semanticIdentityName(suggestion.suggestedNodeName);
  const scope = suggestion.parentNodeId
    ? `parent:${suggestion.parentNodeId as string}`
    : normalizeRouteScope(suggestion.routeHint)
      ? `route:${normalizeRouteScope(suggestion.routeHint)}`
      : 'top';
  return `ui:${area}:${scope}:${capability}`;
}

function normalizeOptionalText(value: string | undefined, max: number) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function normalizeText(value: string, fallback: string, max: number) {
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, max);
}

function fileRoleForSuggestion(
  suggestion: Doc<'semanticNodeSuggestions'>,
): Doc<'nodeFiles'>['role'] {
  if (suggestion.semanticKind === 'ui_module' || suggestion.semanticKind === 'surface') {
    return 'ui';
  }
  if (suggestion.semanticKind === 'api') return 'api';
  if (suggestion.semanticKind === 'storage') return 'schema';
  if (suggestion.semanticKind === 'data_logic') return 'support';
  if (suggestion.semanticKind === 'agent' || suggestion.semanticKind === 'worker') return 'worker';
  if (suggestion.semanticKind === 'config') return 'config';
  if (suggestion.semanticKind === 'test_harness') return 'test';
  return 'primary';
}

async function ensureLayerInProject(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  layerId: Id<'projectLayers'>,
) {
  const layer = await ctx.db.get(layerId);
  if (!layer || layer.projectId !== projectId) {
    throw new Error('Semantic suggestion layer must belong to the same project');
  }
  return layer;
}

async function ensureParentInProject(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  parentNodeId?: Id<'nodes'>,
) {
  if (!parentNodeId) return null;
  const parent = await ctx.db.get(parentNodeId);
  if (!parent || parent.projectId !== projectId) {
    throw new Error('Semantic suggestion parent must belong to the same project');
  }
  return parent;
}

export function shouldAutoApplySemanticNodeSuggestion(
  suggestion: Pick<Doc<'semanticNodeSuggestions'>, 'semanticKind' | 'confidence'>,
) {
  if (suggestion.semanticKind === 'ui_module') {
    return suggestion.confidence >= UI_MODULE_AUTO_APPLY_CONFIDENCE;
  }
  return suggestion.confidence >= PRODUCT_CAPABILITY_AUTO_APPLY_CONFIDENCE;
}

async function findCapabilityNode(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  capabilityKey: string | undefined,
  productArea?: NonNullable<Doc<'nodes'>['productArea']>,
) {
  if (!capabilityKey) return null;
  const matches = await ctx.db
    .query('nodes')
    .withIndex('by_project_capability', (q) =>
      q.eq('projectId', projectId).eq('capabilityKey', capabilityKey),
    )
    .take(20);
  return (
    matches.find(
      (node) => node.semanticKind === 'capability' && node.productArea === productArea,
    ) ??
    matches.find((node) => node.semanticKind === 'capability') ??
    null
  );
}

async function findLinkedNodeForSourceFile(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  sourceFilePath: string,
) {
  const links = await ctx.db
    .query('nodeFiles')
    .withIndex('by_path', (q) => q.eq('path', normalizePath(sourceFilePath)))
    .take(50);
  for (const link of links) {
    if (link.archived) continue;
    const node = await ctx.db.get(link.nodeId);
    if (node?.projectId === projectId) return node;
  }
  return null;
}

async function findRelatedCapabilityNodes(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  capabilityKey: string | undefined,
  productArea: NonNullable<Doc<'nodes'>['productArea']>,
) {
  if (!capabilityKey) return [];
  const matches = await ctx.db
    .query('nodes')
    .withIndex('by_project_capability', (q) =>
      q.eq('projectId', projectId).eq('capabilityKey', capabilityKey),
    )
    .take(50);
  return matches.filter(
    (node) => node.semanticKind === 'capability' && node.productArea === productArea,
  );
}

async function findRelatedUiModuleNodes(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  capabilityKey: string | undefined,
  productArea: NonNullable<Doc<'nodes'>['productArea']>,
) {
  if (!capabilityKey) return [];
  const matches = await ctx.db
    .query('nodes')
    .withIndex('by_project_capability', (q) =>
      q.eq('projectId', projectId).eq('capabilityKey', capabilityKey),
    )
    .take(50);
  return matches.filter(
    (node) => node.semanticKind === 'ui_module' && node.productArea === productArea,
  );
}

async function findUiModuleNodeForSuggestion(
  ctx: MutationCtx,
  suggestion: Doc<'semanticNodeSuggestions'>,
) {
  if (suggestion.semanticKind !== 'ui_module') return null;
  const suggestionKey = semanticMergeKeyForSuggestion(suggestion);
  if (!suggestionKey) return null;
  const nodes = await ctx.db
    .query('nodes')
    .withIndex('by_project', (q) => q.eq('projectId', suggestion.projectId))
    .take(1000);
  return (
    nodes.find((node) => semanticDuplicateKeyForNode(node) === suggestionKey) ??
    nodes.find(
      (node) =>
        node.semanticKind === 'ui_module' &&
        node.productArea === suggestion.productArea &&
        (node.capabilityKey ?? '') === (suggestion.capabilityKey ?? '') &&
        node.name.trim().toLowerCase() === suggestion.suggestedNodeName.trim().toLowerCase(),
    ) ??
    null
  );
}

async function linkSemanticFile(
  ctx: MutationCtx,
  nodeId: Id<'nodes'>,
  suggestion: Doc<'semanticNodeSuggestions'>,
) {
  const filePath = normalizePath(suggestion.sourceFilePath);
  const existing = await ctx.db
    .query('nodeFiles')
    .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
    .collect();
  const duplicate = existing.find((file) => file.path === filePath);
  const patch = {
    role: fileRoleForSuggestion(suggestion),
    source: suggestion.source,
    confidence: suggestion.confidence,
    reason: suggestion.reason,
    evidence: suggestion.evidence,
  };
  if (duplicate) {
    await ctx.db.patch(duplicate._id, patch);
    return duplicate._id;
  }
  return await ctx.db.insert('nodeFiles', { nodeId, path: filePath, ...patch });
}

async function patchNodeFromSuggestion(
  ctx: MutationCtx,
  nodeId: Id<'nodes'>,
  suggestion: Doc<'semanticNodeSuggestions'>,
) {
  await ctx.db.patch(nodeId, {
    semanticKind: suggestion.semanticKind,
    productArea: suggestion.productArea,
    capabilityKey: suggestion.capabilityKey,
    routeHint: suggestion.routeHint,
    mappingStatus: shouldAutoApplySemanticNodeSuggestion(suggestion) ? 'auto_mapped' : 'suggested',
    mappingConfidence: suggestion.confidence,
  });
}

async function attachUiModuleToParentIfClear(
  ctx: MutationCtx,
  nodeId: Id<'nodes'>,
  suggestion: Doc<'semanticNodeSuggestions'>,
) {
  if (suggestion.semanticKind !== 'ui_module' || !suggestion.parentNodeId) return;
  const node = await ctx.db.get(nodeId);
  if (!node || node.parentId === suggestion.parentNodeId) return;
  const parent = await ensureParentInProject(ctx, suggestion.projectId, suggestion.parentNodeId);
  if (!parent) return;
  await ctx.db.patch(nodeId, {
    parentId: parent._id,
    type: 'feature',
    layerId: parent.layerId ?? node.layerId,
  });
  await ensureHierarchyEdge(ctx, suggestion.projectId, parent._id, nodeId);
}

async function createNodeForSuggestion(
  ctx: MutationCtx,
  suggestion: Doc<'semanticNodeSuggestions'>,
) {
  const semanticParent = await ensureParentInProject(
    ctx,
    suggestion.projectId,
    suggestion.parentNodeId,
  );
  const shouldNestInParent = suggestion.semanticKind === 'ui_module' && Boolean(semanticParent);
  const parentLayer =
    shouldNestInParent && semanticParent?.layerId ? await ctx.db.get(semanticParent.layerId) : null;
  const layer =
    parentLayer ?? (await ensureLayerInProject(ctx, suggestion.projectId, suggestion.layerId));
  const type = shouldNestInParent ? 'feature' : 'page';
  const siblingCount = (
    await ctx.db
      .query('nodes')
      .withIndex('by_project', (q) => q.eq('projectId', suggestion.projectId))
      .collect()
  ).filter(
    (node) =>
      node.layerId === layer?._id &&
      node.parentId === (shouldNestInParent ? suggestion.parentNodeId : undefined),
  ).length;
  const position = defaultNodePosition({
    type,
    layer,
    parent: shouldNestInParent ? semanticParent : null,
    siblingCount,
  });

  const nodeId = await ctx.db.insert('nodes', {
    projectId: suggestion.projectId,
    layerId: layer?._id,
    parentId: shouldNestInParent ? suggestion.parentNodeId : undefined,
    type,
    name: normalizeText(suggestion.suggestedNodeName, 'Semantic node', 80),
    positionX: position.x,
    positionY: position.y,
    semanticKind: suggestion.semanticKind,
    productArea: suggestion.productArea,
    capabilityKey: suggestion.capabilityKey,
    routeHint: suggestion.routeHint,
    mappingStatus: shouldAutoApplySemanticNodeSuggestion(suggestion) ? 'auto_mapped' : 'suggested',
    mappingConfidence: suggestion.confidence,
  });

  if (shouldNestInParent && semanticParent) {
    await ensureHierarchyEdge(ctx, suggestion.projectId, semanticParent._id, nodeId);
  }
  return nodeId;
}

async function ensureSemanticEdges(
  ctx: MutationCtx,
  nodeId: Id<'nodes'>,
  suggestion: Doc<'semanticNodeSuggestions'>,
) {
  if (suggestion.parentNodeId) {
    await upsertManualEdge(ctx, {
      projectId: suggestion.projectId,
      sourceNodeId: suggestion.parentNodeId,
      targetNodeId: nodeId,
      type: 'contains',
      label: 'contains',
      confidence: suggestion.confidence,
      reason: `Surface contains ${suggestion.suggestedNodeName}.`,
      evidence: suggestion.evidence,
      sourceRunId: suggestion.runId,
    });
  }

  if (!suggestion.capabilityKey) return;

  if (suggestion.semanticKind === 'ui_module') {
    const capabilityNodes = await findRelatedCapabilityNodes(
      ctx,
      suggestion.projectId,
      suggestion.capabilityKey,
      suggestion.productArea,
    );
    for (const capability of capabilityNodes) {
      if (capability._id === nodeId) continue;
      await upsertManualEdge(ctx, {
        projectId: suggestion.projectId,
        sourceNodeId: nodeId,
        targetNodeId: capability._id,
        type: suggestion.capabilityKey === 'billing_subscription' ? 'triggers' : 'uses',
        label: suggestion.capabilityKey.replace(/_/g, ' '),
        confidence: Math.min(0.96, suggestion.confidence),
        reason: `${suggestion.suggestedNodeName} is UI evidence for ${capability.name}.`,
        evidence: suggestion.evidence,
        sourceRunId: suggestion.runId,
      });
    }
  }

  if (suggestion.semanticKind === 'capability') {
    const uiNodes = await findRelatedUiModuleNodes(
      ctx,
      suggestion.projectId,
      suggestion.capabilityKey,
      suggestion.productArea,
    );
    for (const uiNode of uiNodes) {
      if (uiNode._id === nodeId) continue;
      await upsertManualEdge(ctx, {
        projectId: suggestion.projectId,
        sourceNodeId: uiNode._id,
        targetNodeId: nodeId,
        type: suggestion.capabilityKey === 'billing_subscription' ? 'triggers' : 'uses',
        label: suggestion.capabilityKey.replace(/_/g, ' '),
        confidence: Math.min(0.96, suggestion.confidence),
        reason: `${uiNode.name} is UI evidence for ${suggestion.suggestedNodeName}.`,
        evidence: suggestion.evidence,
        sourceRunId: suggestion.runId,
      });
    }
  }
}

export async function applySemanticNodeSuggestion(
  ctx: MutationCtx,
  suggestion: Doc<'semanticNodeSuggestions'>,
) {
  let nodeId: Id<'nodes'> | undefined = suggestion.appliedNodeId;
  if (!nodeId && suggestion.semanticKind === 'surface') {
    const linkedNode = await findLinkedNodeForSourceFile(
      ctx,
      suggestion.projectId,
      suggestion.sourceFilePath,
    );
    nodeId = linkedNode?._id;
  }
  if (!nodeId && suggestion.semanticKind === 'capability') {
    const existingCapability = await findCapabilityNode(
      ctx,
      suggestion.projectId,
      suggestion.capabilityKey,
      suggestion.productArea,
    );
    nodeId = existingCapability?._id;
  }
  if (!nodeId && suggestion.semanticKind === 'ui_module') {
    const existingUiModule = await findUiModuleNodeForSuggestion(ctx, suggestion);
    nodeId = existingUiModule?._id;
  }
  if (!nodeId) nodeId = await createNodeForSuggestion(ctx, suggestion);

  await attachUiModuleToParentIfClear(ctx, nodeId, suggestion);
  await patchNodeFromSuggestion(ctx, nodeId, suggestion);
  await linkSemanticFile(ctx, nodeId, suggestion);
  await ensureSemanticEdges(ctx, nodeId, suggestion);

  await ctx.db.patch(suggestion._id, {
    status: 'applied',
    appliedNodeId: nodeId,
    updatedAt: Date.now(),
  });

  return nodeId;
}

export async function upsertSemanticNodeSuggestion(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  input: SemanticNodeSuggestionInput,
) {
  const semanticKey = normalizeKey(input.semanticKey);
  const sourceFilePath = normalizePath(input.sourceFilePath);
  await ensureLayerInProject(ctx, projectId, input.layerId);
  await ensureParentInProject(ctx, projectId, input.parentNodeId);

  const existing = await ctx.db
    .query('semanticNodeSuggestions')
    .withIndex('by_project_key', (q) => q.eq('projectId', projectId).eq('semanticKey', semanticKey))
    .unique();

  if (existing?.status === 'applied' || existing?.status === 'ignored') {
    return {
      status: 'skipped' as const,
      reason:
        existing.status === 'applied' ? ('already_applied' as const) : ('already_ignored' as const),
      suggestionId: existing._id,
      nodeId: existing.appliedNodeId,
    };
  }

  const now = Date.now();
  const patch = {
    runId: input.runId,
    sourceFilePath,
    semanticKey,
    suggestedNodeName: normalizeText(input.suggestedNodeName, 'Semantic node', 80),
    semanticKind: input.semanticKind,
    productArea: input.productArea,
    capabilityKey: normalizeOptionalText(input.capabilityKey, 120),
    routeHint: normalizeOptionalText(input.routeHint, 160),
    layerId: input.layerId,
    parentNodeId: input.parentNodeId,
    confidence: input.confidence,
    reason: normalizeText(input.reason, 'Suggested by Hermes.', 1000),
    evidence: input.evidence?.slice(0, 8),
    source: normalizeText(input.source, 'hermes', 80),
    status: 'pending' as const,
    appliedNodeId: undefined,
    updatedAt: now,
  };

  const suggestionId = existing
    ? existing._id
    : await ctx.db.insert('semanticNodeSuggestions', {
        projectId,
        createdAt: now,
        ...patch,
      });

  if (existing) await ctx.db.patch(existing._id, patch);

  const suggestion = await ctx.db.get(suggestionId);
  if (!suggestion) throw new Error('Semantic node suggestion not found after write');

  if (shouldAutoApplySemanticNodeSuggestion(suggestion)) {
    const nodeId = await applySemanticNodeSuggestion(ctx, suggestion);
    return { status: 'applied' as const, suggestionId, nodeId };
  }

  return { status: 'pending' as const, suggestionId };
}

export async function upsertProductSurfaceFlows(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  runId?: Id<'hermesMappingRuns'>,
) {
  const nodes = await ctx.db
    .query('nodes')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))
    .take(500);
  const nodeById = new Map(nodes.map((node) => [node._id, node]));
  const edges = await ctx.db
    .query('nodeEdges')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))
    .take(1000);
  const containsBySurface = new Map<Id<'nodes'>, Doc<'nodeEdges'>[]>();
  for (const edge of edges) {
    if (edge.type !== 'contains') continue;
    const list = containsBySurface.get(edge.sourceNodeId) ?? [];
    list.push(edge);
    containsBySurface.set(edge.sourceNodeId, list);
  }

  let upserted = 0;
  for (const surface of nodes) {
    if (surface.semanticKind !== 'surface') continue;
    const containsEdges = containsBySurface.get(surface._id)?.slice(0, 8) ?? [];
    if (containsEdges.length === 0) continue;

    const moduleIds = containsEdges.map((edge) => edge.targetNodeId);
    const capabilityEdges = edges
      .filter(
        (edge) =>
          moduleIds.includes(edge.sourceNodeId) &&
          ['uses', 'triggers', 'integrates'].includes(edge.type),
      )
      .slice(0, 8);
    const nodeIds = [
      surface._id,
      ...moduleIds,
      ...capabilityEdges.map((edge) => edge.targetNodeId),
    ].filter((nodeId, index, all) => all.indexOf(nodeId) === index);
    if (nodeIds.length < 3) continue;

    await upsertArchitectureFlow(ctx, projectId, {
      runId,
      title: `${surface.name} Experience`,
      shortTitle: surface.name.length > 48 ? `${surface.name.slice(0, 45)}...` : surface.name,
      goal: `Show visible UI modules and product capabilities inside ${surface.name}.`,
      importance: 0.92,
      curationKey: `surface:${surface._id}:experience`,
      description: `${surface.name} is connected to ${containsEdges.length} UI module(s) and ${
        capabilityEdges.length
      } product capability edge(s).`,
      kind: 'user_journey',
      productArea: surface.productArea ?? 'unknown',
      nodeIds,
      edgeRefs: [...containsEdges, ...capabilityEdges].map((edge) => ({ edgeId: edge._id })),
      steps: [
        {
          title: surface.name,
          description: 'Start from the user-facing surface.',
          nodeIds: [surface._id],
        },
        ...moduleIds.slice(0, 5).map((nodeId) => ({
          title: nodeById.get(nodeId)?.name ?? 'UI module',
          description: 'Review the visible module contained in this surface.',
          nodeIds: [nodeId],
        })),
        ...(capabilityEdges.length > 0
          ? [
              {
                title: 'Product capabilities',
                description: 'Follow the semantic links from UI modules into product functions.',
                nodeIds: capabilityEdges.map((edge) => edge.targetNodeId),
                edgeRefs: capabilityEdges.map((edge) => ({ edgeId: edge._id })),
              },
            ]
          : []),
      ],
      confidence: 0.91,
      reason:
        'Arch Viz grouped semantic contains/uses relationships into a reviewable surface experience flow.',
      evidence: [`${surface.name} contains ${containsEdges.length} UI module(s)`],
      source: 'arch-viz',
    });
    upserted++;
  }

  return upserted;
}
