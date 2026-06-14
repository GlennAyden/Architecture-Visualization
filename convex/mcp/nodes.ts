import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { deleteNodeCascade } from '../lib/cascade';
import { ensureHierarchyEdge } from '../lib/edges';
import { defaultNodePosition, resolveNodeLayer } from '../lib/layers';
import {
  linkedFileRoleValidator,
  mappingStatusValidator,
  nodeSemanticKindValidator,
} from '../lib/semantic';
import { ForbiddenError, requireNodeOwnership, requireOwnership } from './lib';

export const getProjectSummary = internalQuery({
  args: { userId: v.id('profiles'), projectId: v.id('projects') },
  handler: async (ctx, { userId, projectId }) => {
    try {
      const project = await requireOwnership(ctx, userId, projectId);
      return { name: project.name };
    } catch {
      return null;
    }
  },
});

export const listForProject = internalQuery({
  args: { userId: v.id('profiles'), projectId: v.id('projects') },
  handler: async (ctx, { userId, projectId }) => {
    await requireOwnership(ctx, userId, projectId);
    const nodes = await ctx.db
      .query('nodes')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    return nodes.map((n) => ({
      id: n._id,
      type: n.type,
      name: n.name,
      parentId: n.parentId ?? null,
      description: n.description ?? null,
      positionX: n.positionX,
      positionY: n.positionY,
      layerId: n.layerId ?? null,
      semanticKind: n.semanticKind ?? null,
      mappingStatus: n.mappingStatus ?? null,
      mappingConfidence: n.mappingConfidence ?? null,
    }));
  },
});

export const getDetail = internalQuery({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    nodeId: v.id('nodes'),
  },
  handler: async (ctx, { userId, scopeProjectId, nodeId }) => {
    const node = await requireNodeOwnership(ctx, userId, nodeId);
    if (node.projectId !== scopeProjectId) {
      throw new ForbiddenError('Node not in token scope');
    }
    const files = await ctx.db
      .query('nodeFiles')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
    const tasks = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
    return {
      id: node._id,
      type: node.type,
      name: node.name,
      parentId: node.parentId ?? null,
      description: node.description ?? null,
      positionX: node.positionX,
      positionY: node.positionY,
      layerId: node.layerId ?? null,
      // Surface metadata (especially route + apiPaths) so the CLI's
      // navigation / data-flow walkers can build a route→node and
      // apiPath→node lookup from a single `nodes/get` pass per node.
      metadata: (node.metadata ?? null) as Record<string, unknown> | null,
      semanticKind: node.semanticKind ?? null,
      mappingStatus: node.mappingStatus ?? null,
      mappingConfidence: node.mappingConfidence ?? null,
      files: files.map((f) => ({
        id: f._id,
        path: f.path,
        role: f.role ?? null,
        source: f.source ?? null,
        confidence: f.confidence ?? null,
        reason: f.reason ?? null,
        evidence: f.evidence ?? null,
        verifiedAt: f.verifiedAt ?? null,
      })),
      kanbanTasks: tasks
        .sort((a, b) => a.position - b.position)
        .map((t) => ({
          id: t._id,
          title: t.title,
          description: t.description ?? null,
          status: t.status,
          position: t.position,
        })),
    };
  },
});

export const createForProject = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    type: v.union(v.literal('page'), v.literal('feature')),
    name: v.string(),
    parentId: v.optional(v.id('nodes')),
    layerId: v.optional(v.id('projectLayers')),
    description: v.optional(v.string()),
    files: v.optional(v.array(v.string())),
    positionX: v.optional(v.number()),
    positionY: v.optional(v.number()),
    semanticKind: v.optional(nodeSemanticKindValidator),
    mappingStatus: v.optional(mappingStatusValidator),
    mappingConfidence: v.optional(v.number()),
    fileRole: v.optional(linkedFileRoleValidator),
  },
  handler: async (ctx, args) => {
    await requireOwnership(ctx, args.userId, args.scopeProjectId);

    const trimmed = args.name.trim();
    if (trimmed.length === 0) throw new Error('Node name is required');
    if (trimmed.length > 80) throw new Error('Node name must be 80 characters or fewer');

    let parent = null;
    if (args.parentId) {
      parent = await ctx.db.get(args.parentId);
      if (!parent || parent.projectId !== args.scopeProjectId) {
        throw new ForbiddenError('Parent node not in token scope');
      }
    }

    const layerId = await resolveNodeLayer(ctx, {
      projectId: args.scopeProjectId,
      type: args.type,
      layerId: args.layerId,
      parent,
      makeError: (message) =>
        message === 'Layer must belong to the same project'
          ? new ForbiddenError('Layer not in token scope')
          : new Error(message),
    });
    const layer = layerId ? await ctx.db.get(layerId) : null;
    const siblingCount = (
      await ctx.db
        .query('nodes')
        .withIndex('by_project', (q) => q.eq('projectId', args.scopeProjectId))
        .collect()
    ).filter((node) => node.layerId === layerId && node.parentId === args.parentId).length;
    const fallbackPosition = defaultNodePosition({
      type: args.type,
      layer,
      parent,
      siblingCount,
    });
    const positionX = args.positionX ?? fallbackPosition.x;
    const positionY = args.positionY ?? fallbackPosition.y;

    const nodeId = await ctx.db.insert('nodes', {
      projectId: args.scopeProjectId,
      layerId,
      parentId: args.parentId,
      type: args.type,
      name: trimmed,
      description: args.description?.trim() || undefined,
      positionX,
      positionY,
      semanticKind: args.semanticKind,
      mappingStatus: args.mappingStatus ?? 'manual',
      mappingConfidence: args.mappingConfidence,
    });

    if (args.files && args.files.length > 0) {
      const seen = new Set<string>();
      for (const raw of args.files) {
        const p = raw.trim();
        if (p.length === 0 || p.length > 500) continue;
        if (seen.has(p)) continue;
        seen.add(p);
        await ctx.db.insert('nodeFiles', { nodeId, path: p, role: args.fileRole });
      }
    }

    if (args.parentId) {
      await ensureHierarchyEdge(ctx, args.scopeProjectId, args.parentId, nodeId);
    }

    return { nodeId, name: trimmed };
  },
});

export const updateForProject = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    nodeId: v.id('nodes'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    positionX: v.optional(v.number()),
    positionY: v.optional(v.number()),
    // Free-form JSON. Sprint 3 reads `metadata.route` and `metadata.apiPaths`
    // from this when running the navigation / data-flow heuristic walkers.
    metadata: v.optional(v.any()),
    semanticKind: v.optional(nodeSemanticKindValidator),
    mappingStatus: v.optional(mappingStatusValidator),
    mappingConfidence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const node = await ctx.db.get(args.nodeId);
    if (!node) return; // idempotent
    await requireOwnership(ctx, args.userId, node.projectId);
    if (node.projectId !== args.scopeProjectId) {
      throw new ForbiddenError('Node not in token scope');
    }

    const patch: Partial<typeof node> = {};
    if (args.name !== undefined) {
      const trimmed = args.name.trim();
      if (trimmed.length === 0) throw new Error('Node name is required');
      if (trimmed.length > 80) throw new Error('Node name must be 80 characters or fewer');
      patch.name = trimmed;
    }
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    if (args.positionX !== undefined) patch.positionX = args.positionX;
    if (args.positionY !== undefined) patch.positionY = args.positionY;
    if (args.semanticKind !== undefined) patch.semanticKind = args.semanticKind;
    if (args.mappingStatus !== undefined) patch.mappingStatus = args.mappingStatus;
    if (args.mappingConfidence !== undefined) patch.mappingConfidence = args.mappingConfidence;
    if (args.metadata !== undefined) {
      // Merge over existing metadata so a partial update doesn't wipe other
      // heuristic fields. Pass an empty object to clear, or set specific
      // keys to undefined / null to remove them.
      const merged: Record<string, unknown> = {
        ...(node.metadata as Record<string, unknown> | undefined),
        ...(args.metadata as Record<string, unknown>),
      };
      patch.metadata = merged;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.nodeId, patch);
    }
  },
});

export const removeForProject = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    nodeId: v.id('nodes'),
  },
  handler: async (ctx, { userId, scopeProjectId, nodeId }) => {
    const node = await ctx.db.get(nodeId);
    if (!node) return; // idempotent
    await requireOwnership(ctx, userId, node.projectId);
    if (node.projectId !== scopeProjectId) {
      throw new ForbiddenError('Node not in token scope');
    }
    await deleteNodeCascade(ctx, nodeId);
  },
});
