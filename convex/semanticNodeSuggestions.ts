import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { getProjectIfAccessible, requireProjectAccess } from './lib/auth';
import { deleteNodeCascade } from './lib/cascade';
import { ensureHierarchyEdge } from './lib/edges';
import {
  applySemanticNodeSuggestion,
  semanticDuplicateKeyForNode,
  shouldAutoApplySemanticNodeSuggestion,
} from './lib/semanticNodeSuggestions';
import {
  nodeSemanticKindValidator,
  productAreaValidator,
  relationshipSuggestionStatusValidator,
} from './lib/semantic';

function normalizeNodeName(value: string) {
  return value.trim().toLowerCase();
}

async function fileCountForNode(ctx: QueryCtx | MutationCtx, nodeId: Id<'nodes'>) {
  const files = await ctx.db
    .query('nodeFiles')
    .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
    .collect();
  return files.filter((file) => !file.archived).length;
}

async function findDuplicateGroups(ctx: QueryCtx | MutationCtx, projectId: Id<'projects'>) {
  const nodes = await ctx.db
    .query('nodes')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))
    .take(1000);
  const groups = new Map<string, Doc<'nodes'>[]>();
  for (const node of nodes) {
    const key = semanticDuplicateKeyForNode(node);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(node);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, groupNodes]) => ({ key, nodes: groupNodes }))
    .filter((group) => group.nodes.length > 1)
    .sort(
      (a, b) =>
        b.nodes.length - a.nodes.length ||
        normalizeNodeName(a.nodes[0]?.name ?? '').localeCompare(
          normalizeNodeName(b.nodes[0]?.name ?? ''),
        ),
    );
}

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

export const duplicateReport = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const project = await getProjectIfAccessible(ctx, projectId);
    if (!project) return [];

    const groups = await findDuplicateGroups(ctx, projectId);
    return await Promise.all(
      groups.slice(0, 50).map(async (group) => {
        const members = await Promise.all(
          group.nodes.map(async (node) => ({
            nodeId: node._id,
            name: node.name,
            parentId: node.parentId,
            productArea: node.productArea,
            capabilityKey: node.capabilityKey,
            routeHint: node.routeHint,
            fileCount: await fileCountForNode(ctx, node._id),
          })),
        );
        const uniqueFiles = new Set<string>();
        for (const member of members) {
          const files = await ctx.db
            .query('nodeFiles')
            .withIndex('by_node', (q) => q.eq('nodeId', member.nodeId))
            .collect();
          for (const file of files) {
            if (!file.archived) uniqueFiles.add(file.path);
          }
        }
        return {
          groupKey: group.key,
          name: group.nodes[0]?.name ?? 'UI module',
          semanticKind: 'ui_module' as const,
          productArea: group.nodes[0]?.productArea ?? 'unknown',
          capabilityKey: group.nodes[0]?.capabilityKey,
          nodeCount: group.nodes.length,
          uniqueFileCount: uniqueFiles.size,
          members,
        };
      }),
    );
  },
});

async function hasEquivalentEdge(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  sourceNodeId: Id<'nodes'>,
  targetNodeId: Id<'nodes'>,
  type: Doc<'nodeEdges'>['type'],
) {
  return await ctx.db
    .query('nodeEdges')
    .withIndex('by_source', (q) => q.eq('sourceNodeId', sourceNodeId))
    .filter((q) =>
      q.and(
        q.eq(q.field('projectId'), projectId),
        q.eq(q.field('targetNodeId'), targetNodeId),
        q.eq(q.field('type'), type),
      ),
    )
    .first();
}

async function moveNodeFiles(ctx: MutationCtx, fromNodeId: Id<'nodes'>, toNodeId: Id<'nodes'>) {
  const targetFiles = await ctx.db
    .query('nodeFiles')
    .withIndex('by_node', (q) => q.eq('nodeId', toNodeId))
    .collect();
  const targetPaths = new Set(targetFiles.map((file) => file.path));
  const files = await ctx.db
    .query('nodeFiles')
    .withIndex('by_node', (q) => q.eq('nodeId', fromNodeId))
    .collect();
  let movedFiles = 0;
  let skippedFiles = 0;
  for (const file of files) {
    if (targetPaths.has(file.path)) {
      await ctx.db.delete(file._id);
      skippedFiles++;
      continue;
    }
    await ctx.db.patch(file._id, { nodeId: toNodeId });
    targetPaths.add(file.path);
    movedFiles++;
  }
  return { movedFiles, skippedFiles };
}

async function redirectEdgesForNode(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  fromNodeId: Id<'nodes'>,
  toNodeId: Id<'nodes'>,
) {
  let redirectedEdges = 0;
  let removedDuplicateEdges = 0;
  const outgoing = await ctx.db
    .query('nodeEdges')
    .withIndex('by_source', (q) => q.eq('sourceNodeId', fromNodeId))
    .collect();
  for (const edge of outgoing) {
    const targetNodeId = edge.targetNodeId === fromNodeId ? toNodeId : edge.targetNodeId;
    if (targetNodeId === toNodeId) {
      await ctx.db.delete(edge._id);
      removedDuplicateEdges++;
      continue;
    }
    const existing = await hasEquivalentEdge(ctx, projectId, toNodeId, targetNodeId, edge.type);
    if (existing) {
      await ctx.db.delete(edge._id);
      removedDuplicateEdges++;
      continue;
    }
    await ctx.db.patch(edge._id, { sourceNodeId: toNodeId, targetNodeId });
    redirectedEdges++;
  }

  const incoming = await ctx.db
    .query('nodeEdges')
    .withIndex('by_target', (q) => q.eq('targetNodeId', fromNodeId))
    .collect();
  for (const edge of incoming) {
    const sourceNodeId = edge.sourceNodeId === fromNodeId ? toNodeId : edge.sourceNodeId;
    if (sourceNodeId === toNodeId) {
      await ctx.db.delete(edge._id);
      removedDuplicateEdges++;
      continue;
    }
    const existing = await hasEquivalentEdge(ctx, projectId, sourceNodeId, toNodeId, edge.type);
    if (existing) {
      await ctx.db.delete(edge._id);
      removedDuplicateEdges++;
      continue;
    }
    await ctx.db.patch(edge._id, { sourceNodeId, targetNodeId: toNodeId });
    redirectedEdges++;
  }

  return { redirectedEdges, removedDuplicateEdges };
}

async function reparentChildren(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  fromNodeId: Id<'nodes'>,
  toNodeId: Id<'nodes'>,
) {
  const children = await ctx.db
    .query('nodes')
    .withIndex('by_parent', (q) => q.eq('parentId', fromNodeId))
    .collect();
  let reparentedChildren = 0;
  for (const child of children) {
    await ctx.db.patch(child._id, { parentId: toNodeId });
    await ensureHierarchyEdge(ctx, projectId, toNodeId, child._id);
    reparentedChildren++;
  }
  return reparentedChildren;
}

async function redirectAppliedSuggestions(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  fromNodeId: Id<'nodes'>,
  toNodeId: Id<'nodes'>,
) {
  const suggestions = await ctx.db
    .query('semanticNodeSuggestions')
    .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', 'applied'))
    .take(1000);
  let redirectedSuggestions = 0;
  for (const suggestion of suggestions) {
    if (suggestion.appliedNodeId !== fromNodeId) continue;
    await ctx.db.patch(suggestion._id, { appliedNodeId: toNodeId, updatedAt: Date.now() });
    redirectedSuggestions++;
  }
  return redirectedSuggestions;
}

export const consolidateSemanticDuplicateGroup = mutation({
  args: {
    projectId: v.id('projects'),
    groupKey: v.string(),
    canonicalNodeId: v.optional(v.id('nodes')),
    maxMerge: v.optional(v.number()),
  },
  handler: async (ctx, { projectId, groupKey, canonicalNodeId, maxMerge }) => {
    await requireProjectAccess(ctx, projectId);
    const groups = await findDuplicateGroups(ctx, projectId);
    const group = groups.find((candidate) => candidate.key === groupKey);
    if (!group || group.nodes.length < 2) {
      return {
        merged: 0,
        movedFiles: 0,
        skippedFiles: 0,
        redirectedEdges: 0,
        removedDuplicateEdges: 0,
        reparentedChildren: 0,
        redirectedSuggestions: 0,
        failed: 0,
      };
    }

    const counts = new Map<Id<'nodes'>, number>();
    for (const node of group.nodes) {
      counts.set(node._id, await fileCountForNode(ctx, node._id));
    }
    const canonical =
      (canonicalNodeId ? group.nodes.find((node) => node._id === canonicalNodeId) : undefined) ??
      [...group.nodes].sort(
        (a, b) =>
          Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)) ||
          (counts.get(b._id) ?? 0) - (counts.get(a._id) ?? 0) ||
          a._creationTime - b._creationTime,
      )[0]!;

    let merged = 0;
    let movedFiles = 0;
    let skippedFiles = 0;
    let redirectedEdges = 0;
    let removedDuplicateEdges = 0;
    let reparentedChildren = 0;
    let redirectedSuggestions = 0;
    let failed = 0;
    const failedSamples: Array<{ nodeId: Id<'nodes'>; name: string; message: string }> = [];
    const mergeLimit =
      maxMerge === undefined
        ? group.nodes.length - 1
        : Math.max(1, Math.min(100, Math.floor(maxMerge)));

    for (const node of group.nodes) {
      if (node._id === canonical._id) continue;
      if (merged >= mergeLimit) break;
      try {
        const fileResult = await moveNodeFiles(ctx, node._id, canonical._id);
        movedFiles += fileResult.movedFiles;
        skippedFiles += fileResult.skippedFiles;
        const edgeResult = await redirectEdgesForNode(ctx, projectId, node._id, canonical._id);
        redirectedEdges += edgeResult.redirectedEdges;
        removedDuplicateEdges += edgeResult.removedDuplicateEdges;
        reparentedChildren += await reparentChildren(ctx, projectId, node._id, canonical._id);
        redirectedSuggestions += await redirectAppliedSuggestions(
          ctx,
          projectId,
          node._id,
          canonical._id,
        );
        await deleteNodeCascade(ctx, node._id);
        merged++;
      } catch (error) {
        failed++;
        if (failedSamples.length < 5) {
          failedSamples.push({
            nodeId: node._id,
            name: node.name,
            message: error instanceof Error ? error.message : 'Unknown consolidation error',
          });
        }
      }
    }

    const skippedDueLimit = Math.max(0, group.nodes.length - 1 - merged - failed);

    return {
      merged,
      movedFiles,
      skippedFiles,
      redirectedEdges,
      removedDuplicateEdges,
      reparentedChildren,
      redirectedSuggestions,
      failed,
      failedSamples,
      skippedDueLimit,
      canonicalNodeId: canonical._id,
    };
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
