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

describe('activity.listByNode', () => {
  test('returns [] for an unauthenticated user', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Home',
      positionX: 0,
      positionY: 0,
    });

    // Anonymous read returns [], not throw.
    const result = await t.query(api.activity.listByNode, { nodeId });
    expect(result).toEqual([]);
  });

  test('returns [] when the node has no activity', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Home',
      positionX: 0,
      positionY: 0,
    });
    const entries = await asUser.query(api.activity.listByNode, { nodeId });
    expect(entries).toEqual([]);
  });

  test('returns entries newest first', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Home',
      positionX: 0,
      positionY: 0,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert('activityLog', { nodeId, actor: 'user', message: 'first' });
      await ctx.db.insert('activityLog', { nodeId, actor: 'mcp', message: 'second' });
      await ctx.db.insert('activityLog', { nodeId, actor: 'user', message: 'third' });
    });

    const entries = await asUser.query(api.activity.listByNode, { nodeId });
    expect(entries.map((e) => e.message)).toEqual(['third', 'second', 'first']);
  });

  test('honors limit', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Home',
      positionX: 0,
      positionY: 0,
    });

    await t.run(async (ctx) => {
      for (let i = 0; i < 10; i++) {
        await ctx.db.insert('activityLog', { nodeId, actor: 'user', message: `e${i}` });
      }
    });

    const entries = await asUser.query(api.activity.listByNode, { nodeId, limit: 3 });
    expect(entries).toHaveLength(3);
  });

  test('returns [] when user does not own the node', async () => {
    const t = convexTest(schema, modules);
    const asA = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const asB = t.withIdentity(fakeIdentity('user_b', 'b@example.com'));
    const projectId = await asA.mutation(api.projects.create, { name: 'A' });
    const nodeId = await asA.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('activityLog', { nodeId, actor: 'user', message: 'leaked?' });
    });

    const entries = await asB.query(api.activity.listByNode, { nodeId });
    expect(entries).toEqual([]);
  });
});

describe('activity.listByProject', () => {
  test('returns [] for an empty project (no nodes)', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });

    const entries = await asUser.query(api.activity.listByProject, { projectId });
    expect(entries).toEqual([]);
  });

  test('returns [] when project has nodes but no activity', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Home',
      positionX: 0,
      positionY: 0,
    });

    const entries = await asUser.query(api.activity.listByProject, { projectId });
    expect(entries).toEqual([]);
  });

  test('merges entries from multiple nodes newest-first with node names', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const home = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Home',
      positionX: 0,
      positionY: 0,
    });
    const settings = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Settings',
      positionX: 10,
      positionY: 10,
    });

    // Insert with explicit ordering by _creationTime via separate runs so the
    // ms-resolution clock advances.
    await t.run(async (ctx) => {
      await ctx.db.insert('activityLog', {
        nodeId: home,
        actor: 'user',
        message: 'home-1',
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('activityLog', {
        nodeId: settings,
        actor: 'mcp:codex',
        message: 'settings-1',
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('activityLog', {
        nodeId: home,
        actor: 'user',
        message: 'home-2',
        metadata: { foo: 'bar' },
      });
    });

    const entries = await asUser.query(api.activity.listByProject, { projectId });
    expect(entries.map((e) => e.message)).toEqual(['home-2', 'settings-1', 'home-1']);

    const homeEntry = entries.find((e) => e.message === 'home-2');
    expect(homeEntry?.nodeName).toBe('Home');
    expect(homeEntry?.metadata).toEqual({ foo: 'bar' });
    expect(entries.find((e) => e.message === 'settings-1')?.nodeName).toBe('Settings');
  });

  test('returns [] when user does not own the project', async () => {
    const t = convexTest(schema, modules);
    const asA = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const asB = t.withIdentity(fakeIdentity('user_b', 'b@example.com'));
    const projectId = await asA.mutation(api.projects.create, { name: 'A' });
    const nodeId = await asA.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Secret',
      positionX: 0,
      positionY: 0,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('activityLog', { nodeId, actor: 'user', message: 'private' });
    });

    const entries = await asB.query(api.activity.listByProject, { projectId });
    expect(entries).toEqual([]);
  });

  test('honors limit across nodes', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const n1 = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'A',
      positionX: 0,
      positionY: 0,
    });
    const n2 = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'B',
      positionX: 0,
      positionY: 0,
    });

    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert('activityLog', { nodeId: n1, actor: 'user', message: `a${i}` });
      }
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert('activityLog', { nodeId: n2, actor: 'user', message: `b${i}` });
      }
    });

    const entries = await asUser.query(api.activity.listByProject, {
      projectId,
      limit: 4,
    });
    expect(entries).toHaveLength(4);
  });
});
