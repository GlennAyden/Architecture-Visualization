import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx, QueryCtx } from '../_generated/server';

type AnyCtx = QueryCtx | MutationCtx;

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Internal-handler counterpart of `requireProjectAccess`: takes an explicit
 * userId (resolved by the HTTP auth layer) instead of reading Clerk identity.
 */
export async function requireOwnership(
  ctx: AnyCtx,
  userId: Id<'profiles'>,
  projectId: Id<'projects'>,
): Promise<Doc<'projects'>> {
  const project = await ctx.db.get(projectId);
  if (!project) throw new NotFoundError('Project not found');
  if (project.userId !== userId) throw new ForbiddenError('Project not in token scope');
  return project;
}

/**
 * Verifies that the node exists AND belongs to a project owned by `userId`.
 */
export async function requireNodeOwnership(
  ctx: AnyCtx,
  userId: Id<'profiles'>,
  nodeId: Id<'nodes'>,
): Promise<Doc<'nodes'>> {
  const node = await ctx.db.get(nodeId);
  if (!node) throw new NotFoundError('Node not found');
  await requireOwnership(ctx, userId, node.projectId);
  return node;
}
