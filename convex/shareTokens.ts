import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { UnauthorizedError, getProfile, requireOwnership } from './lib/auth';
import { generateRawToken, hashToken } from './lib/tokens';

const MAX_NAME_LENGTH = 80;

/**
 * Lists every share token issued for a project. Owner-only so members
 * don't see the project's outbound share surface — they can't revoke or
 * audit it. Lenient: returns `[]` for non-owner readers (signed-in
 * members or anonymous) so the UI stays stable on stale URLs.
 */
export const listByProject = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const profile = await getProfile(ctx);
    if (!profile) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== profile._id) return [];
    return await ctx.db
      .query('shareTokens')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .order('desc')
      .collect();
  },
});

/**
 * Mint a new share token. Returns the raw value exactly once — the
 * caller must surface it to the user immediately and never persist it
 * client-side. Subsequent reads only see the hash + name + revoked /
 * expires metadata.
 *
 * `expiresAt` is optional. When set in the future it's an auto-revoke
 * timestamp; when null the token lives until manually revoked.
 */
export const create = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, { projectId, name, expiresAt }) => {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('Share name is required');
    if (trimmed.length > MAX_NAME_LENGTH) {
      throw new Error(`Share name must be ${MAX_NAME_LENGTH} characters or fewer`);
    }
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      throw new Error('expiresAt must be in the future');
    }

    await requireOwnership(ctx, projectId);

    const rawToken = generateRawToken();
    const tokenHash = await hashToken(rawToken);
    const tokenId = await ctx.db.insert('shareTokens', {
      projectId,
      name: trimmed,
      tokenHash,
      expiresAt,
    });
    return { tokenId, rawToken };
  },
});

/**
 * Revoke a share token. Idempotent on already-revoked / already-deleted
 * rows so a double-click in the UI doesn't surface an error.
 */
export const revoke = mutation({
  args: { id: v.id('shareTokens') },
  handler: async (ctx, { id }) => {
    const token = await ctx.db.get(id);
    if (!token) return;
    const profile = await getProfile(ctx);
    if (!profile) throw new UnauthorizedError('Unauthorized: no profile yet');
    const project = await ctx.db.get(token.projectId);
    if (!project || project.userId !== profile._id) {
      throw new UnauthorizedError('Unauthorized: only the project owner can revoke a share');
    }
    if (token.revokedAt) return; // idempotent
    await ctx.db.patch(id, { revokedAt: Date.now() });
  },
});
