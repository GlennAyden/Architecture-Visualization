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

describe('nodes.listByProject', () => {
  test('returns the project owner’s nodes', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Login',
      positionX: 0,
      positionY: 0,
    });

    const nodes = await asUser.query(api.nodes.listByProject, { projectId });
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toEqual('Login');
    expect(nodes[0].type).toEqual('page');
  });

  test('returns empty array for a project belonging to another user', async () => {
    const t = convexTest(schema, modules);
    const asAlice = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));
    const asBob = t.withIdentity(fakeIdentity('user_bob', 'bob@example.com'));

    const projectId = await asAlice.mutation(api.projects.create, { name: 'P' });

    const result = await asBob.query(api.nodes.listByProject, { projectId });
    expect(result).toEqual([]);
  });
});

describe('nodes.create', () => {
  test('rejects empty names', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });

    await expect(
      asUser.mutation(api.nodes.create, {
        projectId,
        type: 'page',
        name: '   ',
        positionX: 0,
        positionY: 0,
      }),
    ).rejects.toThrow(/Node name is required/);
  });

  test('rejects parentId from a different project', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectA = await asUser.mutation(api.projects.create, { name: 'A' });
    const projectB = await asUser.mutation(api.projects.create, { name: 'B' });
    const nodeInA = await asUser.mutation(api.nodes.create, {
      projectId: projectA,
      type: 'page',
      name: 'Top',
      positionX: 0,
      positionY: 0,
    });

    await expect(
      asUser.mutation(api.nodes.create, {
        projectId: projectB,
        type: 'feature',
        name: 'Child',
        parentId: nodeInA,
        positionX: 0,
        positionY: 0,
      }),
    ).rejects.toThrow(/same project/);
  });
});

describe('nodes.update', () => {
  test('updates only the provided fields', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Original',
      positionX: 0,
      positionY: 0,
    });

    await asUser.mutation(api.nodes.update, { id: nodeId, positionX: 100 });
    const after = await asUser.query(api.nodes.listByProject, { projectId });
    expect(after[0].name).toEqual('Original'); // unchanged
    expect(after[0].positionX).toEqual(100);
  });
});

describe('nodes.remove', () => {
  test('removes the node and any children', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const parent = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Parent',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'feature',
      name: 'Child',
      parentId: parent,
      positionX: 0,
      positionY: 0,
    });

    await asUser.mutation(api.nodes.remove, { id: parent });
    const after = await asUser.query(api.nodes.listByProject, { projectId });
    expect(after).toEqual([]);
  });

  test('refuses to remove a node owned by another user', async () => {
    const t = convexTest(schema, modules);
    const asAlice = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));
    const asBob = t.withIdentity(fakeIdentity('user_bob', 'bob@example.com'));

    const projectId = await asAlice.mutation(api.projects.create, { name: 'P' });
    const nodeId = await asAlice.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Alice node',
      positionX: 0,
      positionY: 0,
    });

    await expect(asBob.mutation(api.nodes.remove, { id: nodeId })).rejects.toThrow(/Unauthorized/);
  });
});

describe('projects.remove cascade', () => {
  test('removes the project and all its nodes', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'A',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'B',
      positionX: 0,
      positionY: 0,
    });

    await asUser.mutation(api.projects.remove, { id: projectId });

    // Verify directly via t.run that no nodes from this project remain.
    await t.run(async (ctx) => {
      const remaining = await ctx.db.query('nodes').collect();
      expect(remaining.filter((n) => n.projectId === projectId)).toEqual([]);
    });
  });
});
