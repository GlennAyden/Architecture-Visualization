import { query } from './_generated/server';
import { getProfile } from './lib/auth';

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getProfile(ctx);
    if (profile) return profile;

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return { clerkId: identity.subject, email: identity.email ?? '' };
  },
});
