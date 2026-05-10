import { query } from './_generated/server';
import { getProfile } from './lib/auth';

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
