import { v } from 'convex/values';
import { Doc, Id } from './_generated/dataModel';
import { QueryCtx, query } from './_generated/server';
import { hashToken } from './lib/tokens';

/**
 * Public viewer endpoint for `/share/<rawToken>`. Returns a sanitized
 * snapshot of the project — enough to render a read-only canvas but
 * NOTHING else from the project's private surface area:
 *
 *   - No `apiTokens`, `shareTokens`, or `projectMembers` rows surface.
 *   - The owner's email / Clerk identity is never returned.
 *   - Internal hashes (`tokenHash`) never appear in the response.
 *
 * No Clerk auth required — the share token itself is the only credential.
 * A null return means "token unknown, revoked, or expired"; the UI
 * surfaces a single generic "share link not available" page for all of
 * those so a probe attack can't tell them apart.
 */
export const get = query({
  args: { rawToken: v.string() },
  handler: async (ctx, { rawToken }) => {
    const project = await resolveProject(ctx, rawToken);
    if (!project) return null;

    const nodes = await ctx.db
      .query('nodes')
      .withIndex('by_project', (q) => q.eq('projectId', project._id))
      .collect();
    const edges = await ctx.db
      .query('nodeEdges')
      .withIndex('by_project', (q) => q.eq('projectId', project._id))
      .collect();

    return {
      projectName: project.name,
      shareName: project.shareName,
      nodes: nodes.map((n) => ({
        _id: n._id as string,
        _creationTime: n._creationTime,
        type: n.type,
        name: n.name,
        parentId: (n.parentId as string | undefined) ?? null,
        description: n.description ?? null,
        positionX: n.positionX,
        positionY: n.positionY,
        metadata:
          (n.metadata as Record<string, unknown> | undefined) ?? null,
      })),
      edges: edges.map((e) => ({
        _id: e._id as string,
        sourceNodeId: e.sourceNodeId as string,
        targetNodeId: e.targetNodeId as string,
        type: e.type,
        source: (e.source ?? 'auto') as 'auto' | 'manual',
      })),
    };
  },
});

/**
 * Detail snapshot for a single node in a share view: description, files,
 * kanban, recent activity. Mirrors what the owner modal shows but never
 * leaves the project boundary the share token grants.
 */
export const getNodeDetail = query({
  args: { rawToken: v.string(), nodeId: v.id('nodes') },
  handler: async (ctx, { rawToken, nodeId }) => {
    const project = await resolveProject(ctx, rawToken);
    if (!project) return null;

    const node = await ctx.db.get(nodeId);
    if (!node || node.projectId !== project._id) return null;

    const files = await ctx.db
      .query('nodeFiles')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
    const tasks = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
    const activity = await ctx.db
      .query('activityLog')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .order('desc')
      .take(50);

    return {
      id: node._id as string,
      name: node.name,
      type: node.type,
      description: node.description ?? null,
      files: files
        .filter((f) => !f.archived)
        .map((f) => ({ id: f._id as string, path: f.path })),
      kanbanTasks: tasks
        .sort((a, b) => a.position - b.position)
        .map((t) => ({
          id: t._id as string,
          title: t.title,
          description: t.description ?? null,
          status: t.status,
          position: t.position,
        })),
      activity: activity.map((a) => ({
        id: a._id as string,
        creationTime: a._creationTime,
        actor: a.actor,
        message: a.message,
        metadata: a.metadata,
      })),
    };
  },
});

/**
 * Hash the raw token, look up the share row, validate revoke / expire,
 * then load the parent project. Returns null on any failure — callers
 * fan out into "share not available" without leaking which step failed.
 */
async function resolveProject(
  ctx: QueryCtx,
  rawToken: string,
): Promise<(Doc<'projects'> & { shareName: string }) | null> {
  if (typeof rawToken !== 'string' || rawToken.length < 6) return null;
  const tokenHash = await hashToken(rawToken);
  const token = await ctx.db
    .query('shareTokens')
    .withIndex('by_hash', (q) => q.eq('tokenHash', tokenHash))
    .unique();
  if (!token) return null;
  if (token.revokedAt) return null;
  if (token.expiresAt !== undefined && token.expiresAt <= Date.now()) return null;

  const project = await ctx.db.get(token.projectId as Id<'projects'>);
  if (!project) return null;
  return { ...project, shareName: token.name };
}
