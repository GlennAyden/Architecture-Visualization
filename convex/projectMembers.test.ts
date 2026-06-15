import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.{ts,js}');

function localSubject(subject: string) {
  return subject.startsWith('local:') ? subject : `local:${subject}`;
}

const fakeIdentity = (subject: string, email: string) => {
  const subjectId = localSubject(subject);
  return {
    subject: subjectId,
    email,
    tokenIdentifier: `https://archviz-auth.test|${subjectId}`,
    issuer: 'https://archviz-auth.test',
  };
};

async function ensureProfile(t: ReturnType<typeof convexTest>, subject: string, email: string) {
  const subjectId = localSubject(subject);
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query('profiles')
      .withIndex('by_clerk', (q) => q.eq('clerkId', subjectId))
      .unique();
    if (!existing) {
      await ctx.db.insert('profiles', { clerkId: subjectId, email });
    }
  });
}

async function seedProjectAndUsers(t: ReturnType<typeof convexTest>) {
  const asOwner = t.withIdentity(fakeIdentity('owner', 'owner@example.com'));
  const asInvitee = t.withIdentity(fakeIdentity('invitee', 'invitee@example.com'));
  const projectId = await asOwner.mutation(api.projects.create, { name: 'P' });
  // Profiles are created lazily via getOrCreateProfile in mutations. For
  // tests we pre-seed the invitee's profile so invite-by-email finds them.
  await ensureProfile(t, 'invitee', 'invitee@example.com');
  return { asOwner, asInvitee, projectId };
}

describe('projectMembers — invite / accept / revoke', () => {
  // Why: this is the headline flow Sprint 4 promises — owner invites by
  // email, invitee accepts, invitee gains edit access to nodes. If any
  // step breaks, the feature is unusable.
  test('invite → accept → member sees the project in their list', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, asInvitee, projectId } = await seedProjectAndUsers(t);

    const inviteId = await asOwner.mutation(api.projectMembers.invite, {
      projectId,
      email: 'invitee@example.com',
    });

    const inboxBefore = await asInvitee.query(api.projectMembers.listInvitesForCurrentUser, {});
    expect(inboxBefore).toHaveLength(1);

    await asInvitee.mutation(api.projectMembers.accept, { id: inviteId });

    // Invitee's projects.list now includes the project with role='member'.
    const projects = await asInvitee.query(api.projects.list);
    const shared = projects.find((p) => p._id === projectId);
    expect(shared).toBeDefined();
    expect(shared!.role).toBe('member');
  });

  // Why: pending invites must NOT grant access — otherwise the accept
  // gesture would be meaningless. We assert by trying a mutation that
  // requires project access and expecting it to fail before acceptance.
  test('pending invite does NOT grant project access (mutation blocked)', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, asInvitee, projectId } = await seedProjectAndUsers(t);
    await asOwner.mutation(api.projectMembers.invite, {
      projectId,
      email: 'invitee@example.com',
    });

    await expect(
      asInvitee.mutation(api.nodes.create, {
        projectId,
        type: 'page',
        name: 'sneak',
        positionX: 0,
        positionY: 0,
      }),
    ).rejects.toThrow(/access|Unauthorized/i);
  });

  // Why: after acceptance the member should be able to do collaborative
  // edits. If this didn't work, members would be effectively read-only,
  // collapsing Sprint 4 to share-links only.
  test('accepted member can create nodes', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, asInvitee, projectId } = await seedProjectAndUsers(t);
    const inviteId = await asOwner.mutation(api.projectMembers.invite, {
      projectId,
      email: 'invitee@example.com',
    });
    await asInvitee.mutation(api.projectMembers.accept, { id: inviteId });

    const nodeId = await asInvitee.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'by-member',
      positionX: 0,
      positionY: 0,
    });
    const node = await asInvitee.query(api.nodes.get, { id: nodeId });
    expect(node!.name).toBe('by-member');
  });

  // Why: project deletion is irreversible — a member with edit rights
  // must NOT be able to nuke the project the owner started. This is the
  // canonical "owner-only" guard we need to encode.
  test('member cannot delete the project (owner-only)', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, asInvitee, projectId } = await seedProjectAndUsers(t);
    const inviteId = await asOwner.mutation(api.projectMembers.invite, {
      projectId,
      email: 'invitee@example.com',
    });
    await asInvitee.mutation(api.projectMembers.accept, { id: inviteId });

    await expect(asInvitee.mutation(api.projects.remove, { id: projectId })).rejects.toThrow(
      /owner-only|Unauthorized/i,
    );
  });

  // Why: API tokens are user-scoped credentials with broad MCP power.
  // A member must not be able to mint tokens against the owner's project
  // — that would let them exfiltrate edit access into a separate channel
  // (e.g. another machine, an AI agent) outside the project's auth UX.
  test('member cannot create api tokens for the project', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, asInvitee, projectId } = await seedProjectAndUsers(t);
    const inviteId = await asOwner.mutation(api.projectMembers.invite, {
      projectId,
      email: 'invitee@example.com',
    });
    await asInvitee.mutation(api.projectMembers.accept, { id: inviteId });

    await expect(
      asInvitee.mutation(api.apiTokens.create, { projectId, name: 'sneak' }),
    ).rejects.toThrow(/owner-only|Unauthorized/i);
  });

  // Why: invite-by-email requires an existing profile. If we silently
  // accepted unknown emails we'd accumulate orphan invite rows that
  // nobody could ever accept, with no visible failure mode for the owner.
  test('invite fails with a clear error when the email is unknown', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, projectId } = await seedProjectAndUsers(t);
    await expect(
      asOwner.mutation(api.projectMembers.invite, {
        projectId,
        email: 'noone@example.com',
      }),
    ).rejects.toThrow(/signed up/i);
  });

  // Why: duplicate invite rows would let the owner blow past the cap by
  // re-inviting the same user N times. Dedup at the (projectId, userId)
  // tuple is the simplest fix and matches the schema's natural key.
  test('invite rejects duplicates for the same user', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, projectId } = await seedProjectAndUsers(t);
    await asOwner.mutation(api.projectMembers.invite, {
      projectId,
      email: 'invitee@example.com',
    });
    await expect(
      asOwner.mutation(api.projectMembers.invite, {
        projectId,
        email: 'invitee@example.com',
      }),
    ).rejects.toThrow(/already invited|already.*member/i);
  });

  // Why: the cap is the whole reason the data shape exists — without
  // enforcement the "small private group" goal would erode into "any
  // number of randoms". 3 is the spec'd maximum.
  test('invite enforces the 3-member cap (pending + accepted combined)', async () => {
    const t = convexTest(schema, modules);
    const asOwner = t.withIdentity(fakeIdentity('owner', 'owner@example.com'));
    const projectId = await asOwner.mutation(api.projects.create, { name: 'P' });
    for (let i = 0; i < 3; i++) {
      const email = `u${i}@example.com`;
      await ensureProfile(t, `u${i}`, email);
      await asOwner.mutation(api.projectMembers.invite, { projectId, email });
    }

    const fourthEmail = 'u3@example.com';
    await ensureProfile(t, 'u3', fourthEmail);
    await expect(
      asOwner.mutation(api.projectMembers.invite, { projectId, email: fourthEmail }),
    ).rejects.toThrow(/cap reached/i);
  });

  // Why: only the invitee can accept — owner must not be able to forge
  // acceptance, otherwise the consent step is meaningless.
  test('only the invited user can accept their own row', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, asInvitee, projectId } = await seedProjectAndUsers(t);
    const inviteId = await asOwner.mutation(api.projectMembers.invite, {
      projectId,
      email: 'invitee@example.com',
    });
    await expect(asOwner.mutation(api.projectMembers.accept, { id: inviteId })).rejects.toThrow(
      /Unauthorized|different user/,
    );
    // Sanity: the rightful invitee still can.
    await asInvitee.mutation(api.projectMembers.accept, { id: inviteId });
  });

  // Why: deleting a project must take its memberships with it, otherwise
  // the new orphan rows would show up in member inboxes as broken invites.
  test('project deletion cascades shareTokens + projectMembers', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, asInvitee, projectId } = await seedProjectAndUsers(t);
    await asOwner.mutation(api.projectMembers.invite, {
      projectId,
      email: 'invitee@example.com',
    });
    await asOwner.mutation(api.shareTokens.create, { projectId, name: 's' });

    await asOwner.mutation(api.projects.remove, { id: projectId });

    const tokensLeft = await t.run((ctx) => ctx.db.query('shareTokens').collect());
    expect(tokensLeft).toEqual([]);
    const membersLeft = await t.run((ctx) => ctx.db.query('projectMembers').collect());
    expect(membersLeft).toEqual([]);

    // Member inbox is empty afterwards.
    const inbox = await asInvitee.query(api.projectMembers.listInvitesForCurrentUser, {});
    expect(inbox).toEqual([]);
  });

  // Why: revoking a member must end their access immediately, not just
  // hide them from listings. Without this property a revoked member could
  // still mutate via stale subscriptions.
  test('owner revoke ends member access', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, asInvitee, projectId } = await seedProjectAndUsers(t);
    const inviteId = await asOwner.mutation(api.projectMembers.invite, {
      projectId,
      email: 'invitee@example.com',
    });
    await asInvitee.mutation(api.projectMembers.accept, { id: inviteId });
    // Sanity: member can write before revoke.
    await asInvitee.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'pre',
      positionX: 0,
      positionY: 0,
    });

    await asOwner.mutation(api.projectMembers.revoke, { id: inviteId });

    await expect(
      asInvitee.mutation(api.nodes.create, {
        projectId,
        type: 'page',
        name: 'post',
        positionX: 0,
        positionY: 0,
      }),
    ).rejects.toThrow(/access|Unauthorized/i);
  });
});
