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
