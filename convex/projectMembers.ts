import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { UnauthorizedError, getProfile, requireOwnership } from './lib/auth';

const MAX_MEMBERS_PER_PROJECT = 3;

/**
 * Owner-side member list. Includes pending + accepted invites with their
 * profiles joined so the UI can render names + emails alongside status.
 * Lenient: returns `[]` for non-owner callers so members don't probe each
 * other through this query.
 */
export const listByProject = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const profile = await getProfile(ctx);
    if (!profile) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== profile._id) return [];

    const rows = await ctx.db
      .query('projectMembers')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();

    return Promise.all(
      rows.map(async (r) => {
        const member = await ctx.db.get(r.userId);
        return {
          _id: r._id,
          _creationTime: r._creationTime,
          userId: r.userId,
          email: member?.email ?? '(deleted user)',
          invitedAt: r.invitedAt,
          acceptedAt: r.acceptedAt,
        };
      }),
    );
  },
});

/**
 * Per-user inbox: every project the current user has been invited to but
 * hasn't accepted yet. Used for the global "you have an invite" banner.
 */
export const listInvitesForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getProfile(ctx);
    if (!profile) return [];
    const rows = await ctx.db
      .query('projectMembers')
      .withIndex('by_user', (q) => q.eq('userId', profile._id))
      .filter((q) => q.eq(q.field('acceptedAt'), undefined))
      .collect();
    return Promise.all(
      rows.map(async (r) => {
        const project = await ctx.db.get(r.projectId);
        return {
          _id: r._id,
          projectId: r.projectId,
          projectName: project?.name ?? '(deleted project)',
          invitedAt: r.invitedAt,
        };
      }),
    );
  },
});

/**
 * Owner invites another existing user by email. Pre-conditions:
 *   - caller is the project owner (strict)
 *   - target email matches an existing local-auth `profiles` row
 *   - target isn't the owner themselves
 *   - no existing membership row for (projectId, userId)
 *   - total member rows for this project is below the cap (3)
 *
 * The cap counts pending + accepted together to prevent spamming a
 * project with phantom invites. To free a slot, owner revokes a pending
 * row first.
 */
export const invite = mutation({
  args: {
    projectId: v.id('projects'),
    email: v.string(),
  },
  handler: async (ctx, { projectId, email }) => {
    const trimmedEmail = email.trim().toLowerCase();
    if (trimmedEmail.length === 0) throw new Error('Email is required');

    const project = await requireOwnership(ctx, projectId);

    const target = await ctx.db
      .query('profiles')
      .withIndex('by_email', (q) => q.eq('email', trimmedEmail))
      .first();
    if (!target) {
      throw new Error(
        'No user with that email has signed up yet. Ask them to log in once, then invite.',
      );
    }
    if (target._id === project.userId) {
      throw new Error('You already own this project — no need to invite yourself.');
    }

    const existing = await ctx.db
      .query('projectMembers')
      .withIndex('by_project_user', (q) => q.eq('projectId', projectId).eq('userId', target._id))
      .unique();
    if (existing) {
      throw new Error('That user is already invited or a member of this project.');
    }

    const current = await ctx.db
      .query('projectMembers')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    if (current.length >= MAX_MEMBERS_PER_PROJECT) {
      throw new Error(
        `Member cap reached (${MAX_MEMBERS_PER_PROJECT}). Revoke an existing invite before adding another.`,
      );
    }

    return await ctx.db.insert('projectMembers', {
      projectId,
      userId: target._id,
      invitedAt: Date.now(),
    });
  },
});

/**
 * Invitee accepts. Only the invited user can flip their own row to
 * accepted — owner cannot force-accept on someone's behalf.
 */
export const accept = mutation({
  args: { id: v.id('projectMembers') },
  handler: async (ctx, { id }) => {
    const profile = await getProfile(ctx);
    const row = await ctx.db.get(id);
    if (!row) throw new Error('Invite not found');

    if (!profile || row.userId !== profile._id) {
      throw new UnauthorizedError('Unauthorized: invite is for a different user');
    }
    if (row.acceptedAt) return; // idempotent
    await ctx.db.patch(id, { acceptedAt: Date.now() });
  },
});

/**
 * Owner-side revoke. Works on pending and accepted rows alike — a
 * "remove from project" action by the owner ends in the same delete.
 * Idempotent on already-deleted rows.
 */
export const revoke = mutation({
  args: { id: v.id('projectMembers') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    await requireOwnership(ctx, row.projectId);
    await ctx.db.delete(id);
  },
});

/**
 * Member-side decline: the invited user rejects without accepting.
 * Distinct from revoke because the caller is the INVITEE, not the owner.
 * Owner-revoke and member-decline both end in row deletion; we keep them
 * as separate mutations so the auth check is clear at the call site.
 */
export const decline = mutation({
  args: { id: v.id('projectMembers') },
  handler: async (ctx, { id }) => {
    const profile = await getProfile(ctx);
    const row = await ctx.db.get(id);
    if (!row) return;
    if (!profile || row.userId !== profile._id) {
      throw new UnauthorizedError('Unauthorized: invite is for a different user');
    }
    await ctx.db.delete(id);
  },
});
