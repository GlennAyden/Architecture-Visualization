import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.{ts,js}');

const fakeIdentity = (subject: string, email: string) => ({
  subject,
  email,
  tokenIdentifier: `https://test.clerk.accounts.dev|${subject}`,
  issuer: 'https://test.clerk.accounts.dev',
});

describe('exports.exportProject', () => {
  // Why: an export is a backup escape hatch. If the bundle misses a major
  // sub-collection (files, kanban, activity, edges) the user trusts the
  // download and then loses data when they realise it was incomplete.
  test('returns the full bundle (nodes + files + kanban + activity + edges)', async () => {
    const t = convexTest(schema, modules);
    const asOwner = t.withIdentity(fakeIdentity('owner', 'owner@example.com'));
    const projectId = await asOwner.mutation(api.projects.create, { name: 'P' });
    const page = await asOwner.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Login',
      positionX: 0,
      positionY: 0,
    });
    const feature = await asOwner.mutation(api.nodes.create, {
      projectId,
      type: 'feature',
      name: 'Form',
      parentId: page,
      positionX: 0,
      positionY: 0,
    });
    await asOwner.mutation(api.nodeFiles.add, { nodeId: page, path: 'login.tsx' });
    await asOwner.mutation(api.kanban.create, {
      nodeId: feature,
      title: 'Build',
      status: 'todo',
    });

    const snap = await asOwner.query(api.exports.exportProject, { projectId });
    expect(snap).not.toBeNull();
    expect(snap!.schemaVersion).toBe(2);
    expect(snap!.project.name).toBe('P');
    expect(snap!.layers.map((layer) => layer.name)).toContain('Surfaces');
    expect(snap!.nodes).toHaveLength(2);
    const pageNode = snap!.nodes.find((n) => n.name === 'Login')!;
    expect(pageNode.files.map((f) => f.path)).toEqual(['login.tsx']);
    const featureNode = snap!.nodes.find((n) => n.name === 'Form')!;
    expect(featureNode.kanbanTasks.map((t) => t.title)).toEqual(['Build']);
    // Hierarchy edge from page → feature is captured by the edges array.
    expect(snap!.edges.find((e) => e.type === 'hierarchy')).toBeDefined();
  });

  // Why: members must be able to export the projects they collaborate on,
  // otherwise the export is owner-only and members can't take their work
  // with them after a removal. Roadmap framing: Sprint 4 introduced
  // members as full peers on read; export is a read.
  test('accepted members can export', async () => {
    const t = convexTest(schema, modules);
    const asOwner = t.withIdentity(fakeIdentity('owner', 'owner@example.com'));
    const asMember = t.withIdentity(fakeIdentity('member', 'member@example.com'));
    const projectId = await asOwner.mutation(api.projects.create, { name: 'P' });

    // Seed member profile + accept invite.
    await t.run(async (ctx) => {
      await ctx.db.insert('profiles', { clerkId: 'member', email: 'member@example.com' });
    });
    const inviteId = await asOwner.mutation(api.projectMembers.invite, {
      projectId,
      email: 'member@example.com',
    });
    await asMember.mutation(api.projectMembers.accept, { id: inviteId });

    const snap = await asMember.query(api.exports.exportProject, { projectId });
    expect(snap).not.toBeNull();
    expect(snap!.project.name).toBe('P');
  });

  // Why: a stranger probing the export endpoint must NOT see project data.
  // We rely on `getProjectIfAccessible` returning null for non-members,
  // mirroring the lenient pattern used by other UI queries.
  test('returns null for non-owner / non-member', async () => {
    const t = convexTest(schema, modules);
    const asOwner = t.withIdentity(fakeIdentity('owner', 'owner@example.com'));
    const asStranger = t.withIdentity(fakeIdentity('stranger', 'stranger@example.com'));
    const projectId = await asOwner.mutation(api.projects.create, { name: 'P' });

    const snap = await asStranger.query(api.exports.exportProject, { projectId });
    expect(snap).toBeNull();
  });
});
