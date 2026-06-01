import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import {
  getOrCreateProfile,
  getProfile,
  getProjectIfAccessible,
  requireOwnership,
  requireProjectAccess,
} from './lib/auth';
import { deleteNodeCascade } from './lib/cascade';
import { slugify } from '@arch-viz/shared';
import { seedDefaultLayers } from './projectLayers';

export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getProfile(ctx);
    if (!profile) return [];

    const owned = await ctx.db
      .query('projects')
      .withIndex('by_user', (q) => q.eq('userId', profile._id))
      .order('desc')
      .collect();

    // Plus projects the user has accepted invites for. Pending invites
    // are surfaced via projectMembers.listInvitesForCurrentUser instead
    // so they're visible as an action banner, not as actionable rows.
    const memberships = await ctx.db
      .query('projectMembers')
      .withIndex('by_user', (q) => q.eq('userId', profile._id))
      .collect();
    const accepted = memberships.filter((m) => m.acceptedAt !== undefined);
    const memberProjects = await Promise.all(accepted.map((m) => ctx.db.get(m.projectId)));

    const all = [
      ...owned.map((p) => ({ ...p, role: 'owner' as const })),
      ...memberProjects
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => ({ ...p, role: 'member' as const })),
    ];

    // Stable order: most recently created project (owned or invited) first.
    return all.sort((a, b) => b._creationTime - a._creationTime);
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

    const projectId = await ctx.db.insert('projects', {
      userId: profile._id,
      name: trimmed,
      slug: candidate,
    });
    await seedDefaultLayers(ctx, projectId);
    return projectId;
  },
});

export const get = query({
  args: { id: v.id('projects') },
  handler: async (ctx, { id }) => {
    return await getProjectIfAccessible(ctx, id);
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
    // Project deletion is destructive and irreversible: only the owner can
    // do it. A member with edit access cannot kill the project out from
    // under everyone else.
    await requireOwnership(ctx, id);

    const nodes = await ctx.db
      .query('nodes')
      .withIndex('by_project', (q) => q.eq('projectId', id))
      .collect();
    for (const node of nodes) {
      await deleteNodeCascade(ctx, node._id);
    }

    const tokens = await ctx.db
      .query('apiTokens')
      .withIndex('by_project', (q) => q.eq('projectId', id))
      .collect();
    for (const tok of tokens) {
      await ctx.db.delete(tok._id);
    }

    // Sprint 2 left this gap: scanSnapshots survived a project delete and
    // accumulated as orphans. Fixing it here as part of the Sprint 4
    // cascade audit.
    const snapshots = await ctx.db
      .query('scanSnapshots')
      .withIndex('by_project_kind', (q) => q.eq('projectId', id))
      .collect();
    for (const snap of snapshots) {
      await ctx.db.delete(snap._id);
    }

    // Sprint 4 — share tokens and project memberships die with the project.
    const shares = await ctx.db
      .query('shareTokens')
      .withIndex('by_project', (q) => q.eq('projectId', id))
      .collect();
    for (const s of shares) await ctx.db.delete(s._id);

    const members = await ctx.db
      .query('projectMembers')
      .withIndex('by_project', (q) => q.eq('projectId', id))
      .collect();
    for (const m of members) await ctx.db.delete(m._id);

    const layers = await ctx.db
      .query('projectLayers')
      .withIndex('by_project', (q) => q.eq('projectId', id))
      .collect();
    for (const layer of layers) await ctx.db.delete(layer._id);

    await ctx.db.delete(id);
  },
});
