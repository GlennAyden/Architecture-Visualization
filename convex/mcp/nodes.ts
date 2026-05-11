import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
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
      files: files.map((f) => ({ id: f._id, path: f.path })),
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
    description: v.optional(v.string()),
    files: v.optional(v.array(v.string())),
    positionX: v.optional(v.number()),
    positionY: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnership(ctx, args.userId, args.scopeProjectId);

    const trimmed = args.name.trim();
    if (trimmed.length === 0) throw new Error('Node name is required');
    if (trimmed.length > 80) throw new Error('Node name must be 80 characters or fewer');

    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.projectId !== args.scopeProjectId) {
        throw new ForbiddenError('Parent node not in token scope');
      }
    }

    // Default position: scatter around origin so AI-created nodes don't stack.
    const positionX = args.positionX ?? Math.round((Math.random() - 0.5) * 400);
    const positionY = args.positionY ?? Math.round((Math.random() - 0.5) * 400);

    const nodeId = await ctx.db.insert('nodes', {
      projectId: args.scopeProjectId,
      parentId: args.parentId,
      type: args.type,
      name: trimmed,
      description: args.description?.trim() || undefined,
      positionX,
      positionY,
    });

    if (args.files && args.files.length > 0) {
      const seen = new Set<string>();
      for (const raw of args.files) {
        const p = raw.trim();
        if (p.length === 0 || p.length > 500) continue;
        if (seen.has(p)) continue;
        seen.add(p);
        await ctx.db.insert('nodeFiles', { nodeId, path: p });
      }
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

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.nodeId, patch);
    }
  },
});
