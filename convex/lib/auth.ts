import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx, QueryCtx } from '../_generated/server';

type AnyCtx = QueryCtx | MutationCtx;

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Returns the Clerk identity. Throws UnauthorizedError if no signed-in user.
 */
export async function getRequiredIdentity(ctx: AnyCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new UnauthorizedError();
  return identity;
}

/**
 * Returns the profile row for the current user, creating it on first call.
 * Mutation context required because creation is a write.
 */
export async function getOrCreateProfile(ctx: MutationCtx): Promise<Doc<'profiles'>> {
  const identity = await getRequiredIdentity(ctx);
  const existing = await ctx.db
    .query('profiles')
    .withIndex('by_clerk', (q) => q.eq('clerkId', identity.subject))
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert('profiles', {
    clerkId: identity.subject,
    email: identity.email ?? '',
  });
  const inserted = await ctx.db.get(id);
  if (!inserted) throw new Error('failed to read profile after insert');
  return inserted;
}

/**
 * Read-side variant: returns the existing profile, or null if there is no
 * signed-in user / no profile row yet. Accepts either context type so
 * `requireProjectAccess` can use it from mutations too.
 */
export async function getProfile(ctx: AnyCtx): Promise<Doc<'profiles'> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query('profiles')
    .withIndex('by_clerk', (q) => q.eq('clerkId', identity.subject))
    .unique();
}

/**
 * Loads a project by id and verifies the current user owns it. Throws otherwise.
 * Use from MUTATION paths — writes should fail loudly on unauthorized access.
 * Works in both query and mutation contexts because it only reads.
 */
export async function requireProjectAccess(
  ctx: AnyCtx,
  projectId: Id<'projects'>,
): Promise<Doc<'projects'>> {
  const profile = await getProfile(ctx);
  if (!profile) throw new UnauthorizedError('Unauthorized: no profile yet');
  const project = await ctx.db.get(projectId);
  if (!project) throw new NotFoundError('Project not found');
  if (project.userId !== profile._id) throw new UnauthorizedError('You do not own this project');
  return project;
}

/**
 * Lenient read-side variant: returns the project if the current user owns it,
 * or null otherwise. Use from QUERY paths so the UI can re-render gracefully
 * when navigating to a stale URL (cascade-deleted project, signed-out user
 * with leftover client state) instead of throwing into the React tree.
 */
export async function getProjectIfOwned(
  ctx: AnyCtx,
  projectId: Id<'projects'>,
): Promise<Doc<'projects'> | null> {
  const profile = await getProfile(ctx);
  if (!profile) return null;
  const project = await ctx.db.get(projectId);
  if (!project || project.userId !== profile._id) return null;
  return project;
}

/**
 * Lenient read-side variant for nodes: returns the node if the current user
 * owns its parent project, or null otherwise.
 */
export async function getNodeIfOwned(
  ctx: AnyCtx,
  nodeId: Id<'nodes'>,
): Promise<Doc<'nodes'> | null> {
  const node = await ctx.db.get(nodeId);
  if (!node) return null;
  const project = await getProjectIfOwned(ctx, node.projectId);
  return project ? node : null;
}
