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

describe('POST /api/mcp/kanban/status', () => {
  test('200 moves task across columns and re-positions', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });
    const taskId = await asUser.mutation(api.kanban.create, {
      nodeId,
      title: 'T',
      status: 'todo',
    });

    const res = await t.fetch('/api/mcp/kanban/status', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ taskId, status: 'done' }),
    });
    expect(res.status).toBe(200);

    const tasks = await asUser.query(api.kanban.listByNode, { nodeId });
    expect(tasks[0]!.status).toEqual('done');
  });

  test('404 for unknown taskId', async () => {
    const t = convexTest(schema, modules);
    const { rawToken } = await seedTokenForUser(t);
    const res = await t.fetch('/api/mcp/kanban/status', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: 'kanbanTasks:nope', status: 'done' }),
    });
    expect([400, 404]).toContain(res.status);
  });
});

describe('POST /api/mcp/activity/log', () => {
  test('200 records an activity entry', async () => {
    const t = convexTest(schema, modules);
    const { projectId, rawToken } = await seedTokenForUser(t);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/activity/log', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        actor: 'mcp:claude-code',
        message: 'Implemented form',
        metadata: { commit: 'abc123' },
      }),
    });
    expect(res.status).toBe(200);

    const entries = await t.run(async (ctx) =>
      ctx.db.query('activityLog').collect(),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actor).toEqual('mcp:claude-code');
    expect(entries[0]!.message).toEqual('Implemented form');
  });

  test('403 for node outside token scope', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken } = await seedTokenForUser(t);
    const other = await asUser.mutation(api.projects.create, { name: 'Other' });
    const foreign = await asUser.mutation(api.nodes.create, {
      projectId: other,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/activity/log', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeId: foreign,
        actor: 'mcp:claude-code',
        message: 'should fail',
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/mcp/activity/log_by_file', () => {
  test('200 matched:true when the file path is linked to a node in scope', async () => {
    const t = convexTest(schema, modules);
    const { projectId, rawToken } = await seedTokenForUser(t);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Login',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodeFiles.add, {
      nodeId,
      path: 'apps/web/components/login.tsx',
    });

    const res = await t.fetch('/api/mcp/activity/log_by_file', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        filePath: 'apps/web/components/login.tsx',
        actor: 'hook:claude-code',
        message: 'Edited apps/web/components/login.tsx',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matched).toBe(true);
    expect(body.nodeId).toBe(nodeId);

    const entries = await t.run(async (ctx) =>
      ctx.db.query('activityLog').collect(),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actor).toBe('hook:claude-code');
  });

  test('200 matched:false when no node has the path linked (hook can silently no-op)', async () => {
    const t = convexTest(schema, modules);
    const { rawToken } = await seedTokenForUser(t);

    const res = await t.fetch('/api/mcp/activity/log_by_file', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        filePath: 'apps/web/random-file.tsx',
        actor: 'hook:claude-code',
        message: 'should silently skip',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matched).toBe(false);

    const entries = await t.run(async (ctx) =>
      ctx.db.query('activityLog').collect(),
    );
    expect(entries).toEqual([]);
  });

  test('does not match a node owned by a different project (token scope guard)', async () => {
    const t = convexTest(schema, modules);
    // The token's project is `projectId`.
    const { projectId, rawToken } = await seedTokenForUser(t);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));

    // A second project owned by the same user, with the same file linked.
    const otherProjectId = await asUser.mutation(api.projects.create, {
      name: 'Other',
    });
    const otherNodeId = await asUser.mutation(api.nodes.create, {
      projectId: otherProjectId,
      type: 'page',
      name: 'Other',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodeFiles.add, {
      nodeId: otherNodeId,
      path: 'apps/web/components/login.tsx',
    });

    // Token is scoped to `projectId` — must not log into the other project.
    const res = await t.fetch('/api/mcp/activity/log_by_file', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        filePath: 'apps/web/components/login.tsx',
        actor: 'hook:claude-code',
        message: 'should not cross project boundary',
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).matched).toBe(false);
    expect(projectId).not.toBe(otherProjectId);

    const entries = await t.run(async (ctx) =>
      ctx.db.query('activityLog').collect(),
    );
    expect(entries).toEqual([]);
  });

  test('normalizes Windows backslashes in the file path', async () => {
    const t = convexTest(schema, modules);
    const { projectId, rawToken } = await seedTokenForUser(t);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Win',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodeFiles.add, {
      nodeId,
      path: 'apps/web/components/login.tsx',
    });

    const res = await t.fetch('/api/mcp/activity/log_by_file', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        filePath: 'apps\\web\\components\\login.tsx',
        actor: 'hook:claude-code',
        message: 'from windows shell',
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).matched).toBe(true);
  });
});

describe('POST /api/mcp/files/auto_link', () => {
  // Why: when an importer file already lives in a node, every fresh import
  // discovered by the scanner must follow it onto that same node — that's
  // the whole point of "strict sync". A regression here means the canvas
  // silently desyncs from the code.
  test('200 attaches imported paths to the single node owning the importer', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Login',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodeFiles.add, {
      nodeId,
      path: 'apps/web/components/LoginForm.tsx',
    });

    const res = await t.fetch('/api/mcp/files/auto_link', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        originFilePath: 'apps/web/components/LoginForm.tsx',
        importedFilePaths: ['apps/web/hooks/use-auth-store.ts'],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.linked).toBe(1);
    expect(body.matchedNodes).toBe(1);

    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId });
    expect(files.map((f) => f.path).sort()).toEqual([
      'apps/web/components/LoginForm.tsx',
      'apps/web/hooks/use-auth-store.ts',
    ]);
  });

  // Why: a file is allowed to be linked to multiple nodes (e.g. a shared util
  // belongs to two features). Auto-link must mirror onto BOTH, otherwise one
  // of the nodes drifts away from the import graph.
  test('200 fans out to every node that already owns the importer', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeA = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'A',
      positionX: 0,
      positionY: 0,
    });
    const nodeB = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'B',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodeFiles.add, { nodeId: nodeA, path: 'shared.ts' });
    await asUser.mutation(api.nodeFiles.add, { nodeId: nodeB, path: 'shared.ts' });

    const res = await t.fetch('/api/mcp/files/auto_link', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        originFilePath: 'shared.ts',
        importedFilePaths: ['lodash-helper.ts'],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.linked).toBe(2);
    expect(body.matchedNodes).toBe(2);

    const filesA = await asUser.query(api.nodeFiles.listByNode, { nodeId: nodeA });
    const filesB = await asUser.query(api.nodeFiles.listByNode, { nodeId: nodeB });
    expect(filesA.map((f) => f.path)).toContain('lodash-helper.ts');
    expect(filesB.map((f) => f.path)).toContain('lodash-helper.ts');
  });

  // Why: hooks fire on every edited file — including files not yet linked.
  // A no-match must be a silent 200 (linked:0), not an error, so the hook
  // pipeline stays clean.
  test('200 with linked:0 when the importer is not linked to any node', async () => {
    const t = convexTest(schema, modules);
    const { rawToken } = await seedTokenForUser(t);
    const res = await t.fetch('/api/mcp/files/auto_link', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        originFilePath: 'apps/web/utils/not-linked-yet.ts',
        importedFilePaths: ['some-import.ts'],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.linked).toBe(0);
    expect(body.matchedNodes).toBe(0);
  });

  // Why: dedup keeps the table clean across repeated hook fires. Same edit
  // re-running shouldn't double-link.
  test('200 does not duplicate when the imported path is already linked', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'A',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'a.ts' });
    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'b.ts' });

    const res = await t.fetch('/api/mcp/files/auto_link', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        originFilePath: 'a.ts',
        importedFilePaths: ['b.ts'],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.linked).toBe(0);
    expect(body.alreadyLinked).toBe(1);

    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId });
    expect(files).toHaveLength(2);
  });
});

describe('POST /api/mcp/scans/push + /get_latest', () => {
  // Why: orphan/drift scans are write-once-replace-prev — the UI always reads
  // "the latest" with no need to filter by timestamp. If push left old rows
  // behind, the UI would show stale data after every new scan.
  test('200 stores a fresh orphans snapshot and replaces any previous one', async () => {
    const t = convexTest(schema, modules);
    const { rawToken } = await seedTokenForUser(t);

    const first = await t.fetch('/api/mcp/scans/push', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'orphans',
        data: { orphans: ['a.ts', 'b.ts'], timestamp: 1 },
      }),
    });
    expect(first.status).toBe(200);
    expect((await first.json()).replaced).toBe(0);

    const second = await t.fetch('/api/mcp/scans/push', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'orphans',
        data: { orphans: ['c.ts'], timestamp: 2 },
      }),
    });
    expect(second.status).toBe(200);
    expect((await second.json()).replaced).toBe(1);

    const get = await t.fetch('/api/mcp/scans/get_latest', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'orphans' }),
    });
    expect(get.status).toBe(200);
    const body = await get.json();
    expect(body.snapshot.data.orphans).toEqual(['c.ts']);
  });

  // Why: a runaway scan (binary file, massive repo) could fill the table.
  // 1MB cap protects the deployment without surfacing as Convex platform 500.
  test('413 when payload exceeds the 1MB cap', async () => {
    const t = convexTest(schema, modules);
    const { rawToken } = await seedTokenForUser(t);
    const huge = 'x'.repeat(1_000_001);
    const res = await t.fetch('/api/mcp/scans/push', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'orphans', data: { blob: huge } }),
    });
    expect(res.status).toBe(413);
  });

  test('200 returns null snapshot when no scan has been pushed yet', async () => {
    const t = convexTest(schema, modules);
    const { rawToken } = await seedTokenForUser(t);
    const res = await t.fetch('/api/mcp/scans/get_latest', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'drift' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshot).toBeNull();
  });
});
