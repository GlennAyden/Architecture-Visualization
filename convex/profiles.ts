import { query } from './_generated/server';

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const existing = await ctx.db
      .query('profiles')
      .withIndex('by_clerk', (q) => q.eq('clerkId', identity.subject))
      .unique();
    return existing ?? { clerkId: identity.subject, email: identity.email ?? '' };
  },
});
