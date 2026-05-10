import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getOrCreateProfile, getProfile, requireProjectAccess } from './lib/auth';
import { slugify } from '@arch-viz/shared';

export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getProfile(ctx);
    if (!profile) return [];
    return ctx.db
      .query('projects')
      .withIndex('by_user', (q) => q.eq('userId', profile._id))
      .order('desc')
      .collect();
  },
});
