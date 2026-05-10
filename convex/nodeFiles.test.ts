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

async function makeNode(t: ReturnType<typeof convexTest>) {
  const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));
  const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
  const nodeId = await asUser.mutation(api.nodes.create, {
    projectId,
    type: 'page',
    name: 'Login',
    positionX: 0,
    positionY: 0,
  });
  return { asUser, projectId, nodeId };
}

describe('nodeFiles', () => {
  test('add then list returns the file', async () => {
    const t = convexTest(schema, modules);
    const { asUser, nodeId } = await makeNode(t);

    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'src/login.tsx' });

    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId });
    expect(files).toHaveLength(1);
    expect(files[0].path).toEqual('src/login.tsx');
  });

  test('add is idempotent for the same path on the same node', async () => {
    const t = convexTest(schema, modules);
    const { asUser, nodeId } = await makeNode(t);

    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'a.ts' });
    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'a.ts' });

    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId });
    expect(files).toHaveLength(1);
  });

  test('add rejects empty paths', async () => {
    const t = convexTest(schema, modules);
    const { asUser, nodeId } = await makeNode(t);

    await expect(asUser.mutation(api.nodeFiles.add, { nodeId, path: '   ' })).rejects.toThrow(
      /File path is required/,
    );
  });

  test('returns empty for files of another user’s node', async () => {
    const t = convexTest(schema, modules);
    const { nodeId } = await makeNode(t);
    const asBob = t.withIdentity(fakeIdentity('user_bob', 'bob@example.com'));

    const result = await asBob.query(api.nodeFiles.listByNode, { nodeId });
    expect(result).toEqual([]);
  });

  test('cascade: removing a node deletes its files', async () => {
    const t = convexTest(schema, modules);
    const { asUser, nodeId } = await makeNode(t);
    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'a.ts' });
    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'b.ts' });

    await asUser.mutation(api.nodes.remove, { id: nodeId });

    await t.run(async (ctx) => {
      const remaining = await ctx.db.query('nodeFiles').collect();
      expect(remaining.filter((f) => f.nodeId === nodeId)).toEqual([]);
    });
  });
});
