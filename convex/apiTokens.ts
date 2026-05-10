import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { UnauthorizedError, getProfile, requireProjectAccess } from './lib/auth';
import { generateRawToken, hashToken } from './lib/tokens';
import { tokenNameSchema } from '@arch-viz/shared';

export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getProfile(ctx);
    if (!profile) return [];
    const tokens = await ctx.db
      .query('apiTokens')
      .withIndex('by_user', (q) => q.eq('userId', profile._id))
      .order('desc')
      .collect();
    // Join project name so the UI can show "<token name> · <project name>".
    return Promise.all(
      tokens.map(async (t) => {
        const project = await ctx.db.get(t.projectId);
        return {
          _id: t._id,
          _creationTime: t._creationTime,
          name: t.name,
          projectId: t.projectId,
          projectName: project?.name ?? '(deleted project)',
          lastUsedAt: t.lastUsedAt,
          revokedAt: t.revokedAt,
        };
      }),
    );
  },
});

export const create = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
  },
  handler: async (ctx, { projectId, name }) => {
    const parsedName = tokenNameSchema.parse(name);
    const project = await requireProjectAccess(ctx, projectId);

    const rawToken = generateRawToken();
    const tokenHash = await hashToken(rawToken);

    const tokenId = await ctx.db.insert('apiTokens', {
      userId: project.userId,
      projectId,
      name: parsedName,
      tokenHash,
    });

    return { tokenId, rawToken };
  },
});

export const revoke = mutation({
  args: { id: v.id('apiTokens') },
  handler: async (ctx, { id }) => {
    const token = await ctx.db.get(id);
    if (!token) return; // idempotent — already gone

    const profile = await getProfile(ctx);
    if (!profile || token.userId !== profile._id) {
      throw new UnauthorizedError('Unauthorized: you do not own this token');
    }

    if (token.revokedAt) return; // already revoked — idempotent
    await ctx.db.patch(id, { revokedAt: Date.now() });
  },
});
