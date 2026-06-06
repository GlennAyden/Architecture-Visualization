import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx, QueryCtx } from '../_generated/server';

type AnyCtx = QueryCtx | MutationCtx;

const clerkDisabled = process.env.CONVEX_DISABLE_CLERK_AUTH === 'true';

async function getDebugProfile(ctx: AnyCtx): Promise<Doc<'profiles'> | null> {
  if (!clerkDisabled) return null;

  const debugEmail = process.env.CONVEX_DEBUG_PROFILE_EMAIL;
  if (debugEmail) {
    const profile = await ctx.db
      .query('profiles')
      .filter((q) => q.eq(q.field('email'), debugEmail))
      .first();
    if (profile) return profile;
  }

  return await ctx.db.query('profiles').order('asc').first();
}

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
  const debugProfile = await getDebugProfile(ctx);
  if (debugProfile) {
    return {
      subject: debugProfile.clerkId,
      email: debugProfile.email,
    };
  }

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
  const debugProfile = await getDebugProfile(ctx);
  if (debugProfile) return debugProfile;

  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query('profiles')
    .withIndex('by_clerk', (q) => q.eq('clerkId', identity.subject))
    .unique();
}

/**
 * Loads a project by id and verifies the current user can ACT on it: owner
 * or an accepted member. Pending invites do not grant access. Throws on
 * miss / unauthorized — use from MUTATION paths so writes fail loudly.
 * Works in both query and mutation contexts because it only reads.
 *
 * Owner-only operations (token management, member invite/revoke, project
 * delete) MUST use `requireOwnership` instead — `requireProjectAccess` is
 * deliberately the lenient peer-permission gate.
 */
export async function requireProjectAccess(
  ctx: AnyCtx,
  projectId: Id<'projects'>,
): Promise<Doc<'projects'>> {
  const profile = await getProfile(ctx);
  if (!profile) throw new UnauthorizedError('Unauthorized: no profile yet');
  const project = await ctx.db.get(projectId);
  if (!project) throw new NotFoundError('Project not found');
  if (project.userId === profile._id) return project;

  const membership = await ctx.db
    .query('projectMembers')
    .withIndex('by_project_user', (q) =>
      q.eq('projectId', projectId).eq('userId', profile._id),
    )
    .unique();
  if (membership && membership.acceptedAt) return project;

  throw new UnauthorizedError('You do not have access to this project');
}

/**
 * Strict owner-only variant: throws unless the current user is the literal
 * owner of the project. Use for operations that the owner must remain in
 * sole control of: managing apiTokens, inviting / revoking members,
 * creating / revoking share tokens, deleting the project itself.
 */
export async function requireOwnership(
  ctx: AnyCtx,
  projectId: Id<'projects'>,
): Promise<Doc<'projects'>> {
  const profile = await getProfile(ctx);
  if (!profile) throw new UnauthorizedError('Unauthorized: no profile yet');
  const project = await ctx.db.get(projectId);
  if (!project) throw new NotFoundError('Project not found');
  if (project.userId !== profile._id) {
    throw new UnauthorizedError('Unauthorized: owner-only operation');
  }
  return project;
}

/**
 * Lenient read-side variant: returns the project if the current user can
 * access it (owner OR accepted member), or null otherwise. Use from QUERY
 * paths so the UI can re-render gracefully when navigating to a stale URL
 * (cascade-deleted project, signed-out user with leftover client state)
 * instead of throwing into the React tree.
 *
 * Renamed from `getProjectIfOwned` in Sprint 4 — the function now lets
 * accepted members through, matching the new collaborator model.
 */
export async function getProjectIfAccessible(
  ctx: AnyCtx,
  projectId: Id<'projects'>,
): Promise<Doc<'projects'> | null> {
  const profile = await getProfile(ctx);
  if (!profile) return null;
  const project = await ctx.db.get(projectId);
  if (!project) return null;
  if (project.userId === profile._id) return project;
  const membership = await ctx.db
    .query('projectMembers')
    .withIndex('by_project_user', (q) =>
      q.eq('projectId', projectId).eq('userId', profile._id),
    )
    .unique();
  if (membership && membership.acceptedAt) return project;
  return null;
}

/**
 * Lenient read-side variant for nodes: returns the node if the current user
 * has access to its parent project (owner or accepted member), else null.
 */
export async function getNodeIfAccessible(
  ctx: AnyCtx,
  nodeId: Id<'nodes'>,
): Promise<Doc<'nodes'> | null> {
  const node = await ctx.db.get(nodeId);
  if (!node) return null;
  const project = await getProjectIfAccessible(ctx, node.projectId);
  return project ? node : null;
}
