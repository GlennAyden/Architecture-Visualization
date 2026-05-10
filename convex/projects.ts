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

export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, { name }) => {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('Project name is required');
    if (trimmed.length > 80) throw new Error('Project name must be 80 characters or fewer');

    const profile = await getOrCreateProfile(ctx);

    let slug = slugify(trimmed);
    if (slug.length === 0) slug = 'untitled';

    // Ensure slug uniqueness per user — append -2, -3, ... if taken.
    const existingSlugs = new Set(
      (
        await ctx.db
          .query('projects')
          .withIndex('by_user', (q) => q.eq('userId', profile._id))
          .collect()
      ).map((p) => p.slug),
    );
    let candidate = slug;
    let counter = 2;
    while (existingSlugs.has(candidate)) {
      candidate = `${slug}-${counter++}`;
    }

    return await ctx.db.insert('projects', {
      userId: profile._id,
      name: trimmed,
      slug: candidate,
    });
  },
});

export const get = query({
  args: { id: v.id('projects') },
  handler: async (ctx, { id }) => {
    return await requireProjectAccess(ctx, id);
  },
});

export const rename = mutation({
  args: {
    id: v.id('projects'),
    name: v.string(),
  },
  handler: async (ctx, { id, name }) => {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('Project name is required');
    if (trimmed.length > 80) throw new Error('Project name must be 80 characters or fewer');

    await requireProjectAccess(ctx, id);
    await ctx.db.patch(id, { name: trimmed });
  },
});

export const remove = mutation({
  args: { id: v.id('projects') },
  handler: async (ctx, { id }) => {
    await requireProjectAccess(ctx, id);
    await ctx.db.delete(id);
    // No child rows yet (nodes/kanban arrive in Phase 1B/1C); cascade will be added then.
  },
});
