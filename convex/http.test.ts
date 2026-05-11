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

async function seedTokenForUser(t: ReturnType<typeof convexTest>) {
  const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
  const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
  const { rawToken } = await asUser.mutation(api.apiTokens.create, {
    projectId,
    name: 'laptop',
  });
  return { asUser, projectId, rawToken };
}

describe('POST /api/mcp/health', () => {
  test('returns 401 when x-api-key is missing', async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch('/api/mcp/health', { method: 'POST' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('unauthorized');
  });

  test('returns 401 for an unknown token', async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch('/api/mcp/health', {
      method: 'POST',
      headers: { 'x-api-key': 'archv_unknown' },
    });
    expect(res.status).toBe(401);
  });

  test('returns 200 with project name + token name for a valid token', async () => {
    const t = convexTest(schema, modules);
    const { projectId, rawToken } = await seedTokenForUser(t);

    const res = await t.fetch('/api/mcp/health', {
      method: 'POST',
      headers: { 'x-api-key': rawToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projectId).toEqual(projectId);
    expect(body.projectName).toEqual('P');
    expect(body.tokenName).toEqual('laptop');
  });
});

describe('POST /api/mcp/nodes/list', () => {
  test('401 when no token', async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch('/api/mcp/nodes/list', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  test('200 with empty array when project has no nodes', async () => {
    const t = convexTest(schema, modules);
    const { rawToken } = await seedTokenForUser(t);
    const res = await t.fetch('/api/mcp/nodes/list', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toEqual([]);
  });

  test('200 returns nodes for the token-scoped project only', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Home',
      positionX: 0,
      positionY: 0,
    });

    // Second project for the same user — its nodes must NOT leak.
    const otherProject = await asUser.mutation(api.projects.create, { name: 'Other' });
    await asUser.mutation(api.nodes.create, {
      projectId: otherProject,
      type: 'page',
      name: 'Leaked',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/list', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toHaveLength(1);
    expect(body.nodes[0].name).toEqual('Home');
  });
});

describe('POST /api/mcp/nodes/get', () => {
  test('404 for unknown nodeId', async () => {
    const t = convexTest(schema, modules);
    const { rawToken } = await seedTokenForUser(t);
    const res = await t.fetch('/api/mcp/nodes/get', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'nodes:notreal' }),
    });
    expect([400, 404]).toContain(res.status);
  });

  test('200 returns node detail with files and kanban', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Settings',
      positionX: 10,
      positionY: 20,
    });
    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'src/settings.tsx' });
    await asUser.mutation(api.kanban.create, {
      nodeId,
      title: 'Build form',
      status: 'doing',
    });

    const res = await t.fetch('/api/mcp/nodes/get', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.node.name).toEqual('Settings');
    expect(body.node.files).toHaveLength(1);
    expect(body.node.files[0].path).toEqual('src/settings.tsx');
    expect(body.node.kanbanTasks).toHaveLength(1);
    expect(body.node.kanbanTasks[0].status).toEqual('doing');
  });

  test('403 when node belongs to a different project than the token', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken } = await seedTokenForUser(t);
    const other = await asUser.mutation(api.projects.create, { name: 'Other' });
    const foreignNode = await asUser.mutation(api.nodes.create, {
      projectId: other,
      type: 'page',
      name: 'Leaked',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/get', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: foreignNode }),
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/mcp/nodes/create', () => {
  test('400 for invalid input (missing name)', async () => {
    const t = convexTest(schema, modules);
    const { rawToken } = await seedTokenForUser(t);
    const res = await t.fetch('/api/mcp/nodes/create', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'page' }),
    });
    expect(res.status).toBe(400);
  });

  test('200 creates a minimal page node and returns its id', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken } = await seedTokenForUser(t);
    const res = await t.fetch('/api/mcp/nodes/create', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'page', name: 'About' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.nodeId).toBe('string');
    expect(body.name).toBe('About');

    const nodes = await asUser.query(api.nodes.listByProject, {
      projectId: (await asUser.query(api.projects.list))[0]!._id,
    });
    expect(nodes.find((n) => n.name === 'About')).toBeDefined();
  });

  test('200 creates a feature with parentId, description, and files in one call', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const parentId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Auth',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/create', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'feature',
        name: 'OAuth callback',
        parentId,
        description: 'Handles /auth/callback',
        files: ['src/auth/callback.ts', 'src/auth/utils.ts'],
        positionX: 50,
        positionY: 50,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodeId).toBeDefined();

    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId: body.nodeId });
    expect(files.map((f) => f.path).sort()).toEqual(['src/auth/callback.ts', 'src/auth/utils.ts']);
  });

  test('403 when parentId belongs to a different project', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken } = await seedTokenForUser(t);
    const other = await asUser.mutation(api.projects.create, { name: 'Other' });
    const foreignParent = await asUser.mutation(api.nodes.create, {
      projectId: other,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/create', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'feature',
        name: 'orphan',
        parentId: foreignParent,
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/mcp/nodes/update', () => {
  test('200 updates description', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/update', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, description: 'updated desc' }),
    });
    expect(res.status).toBe(200);
    const node = await asUser.query(api.nodes.get, { id: nodeId });
    expect(node?.description).toEqual('updated desc');
  });

  test('403 for node outside token scope', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken } = await seedTokenForUser(t);
    const other = await asUser.mutation(api.projects.create, { name: 'Other' });
    const foreign = await asUser.mutation(api.nodes.create, {
      projectId: other,
      type: 'page',
      name: 'Leaked',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/update', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: foreign, name: 'pwned' }),
    });
    expect(res.status).toBe(403);
  });

  test('400 when no fields are updated', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/update', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/mcp/nodes/delete', () => {
  test('200 deletes a node and cascades', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Doomed',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/delete', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
    expect(res.status).toBe(200);
    const after = await asUser.query(api.nodes.get, { id: nodeId });
    expect(after).toBeNull();
  });

  test('200 is idempotent on already-deleted node', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Doomed',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodes.remove, { id: nodeId });

    const res = await t.fetch('/api/mcp/nodes/delete', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/mcp/files/link', () => {
  test('200 links multiple paths and dedupes', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Files',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/files/link', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        paths: ['a.ts', 'b.ts', 'a.ts'],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.linked).toBe(2);

    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId });
    expect(files.map((f) => f.path).sort()).toEqual(['a.ts', 'b.ts']);
  });

  test('200 ignores paths that already exist on the node', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Files',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'a.ts' });

    const res = await t.fetch('/api/mcp/files/link', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, paths: ['a.ts', 'b.ts'] }),
    });
    expect(res.status).toBe(200);
    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId });
    expect(files).toHaveLength(2);
  });

  test('403 when node is outside token scope', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken } = await seedTokenForUser(t);
    const other = await asUser.mutation(api.projects.create, { name: 'O' });
    const foreign = await asUser.mutation(api.nodes.create, {
      projectId: other,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/files/link', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: foreign, paths: ['a.ts'] }),
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/mcp/kanban/add', () => {
  test('200 creates a kanban task and returns its id', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/kanban/add', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, title: 'Build form', status: 'doing' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.taskId).toBe('string');

    const tasks = await asUser.query(api.kanban.listByNode, { nodeId });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toEqual('doing');
  });

  test('400 for empty title', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/kanban/add', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, title: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});
