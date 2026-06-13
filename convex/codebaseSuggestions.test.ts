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

async function seedTokenForUser(t: ReturnType<typeof convexTest>) {
  const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
  const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
  const layers = await asUser.query(api.projectLayers.listByProject, { projectId });
  const { rawToken } = await asUser.mutation(api.apiTokens.create, {
    projectId,
    name: 'hermes',
  });
  return { asUser, projectId, layers, rawToken };
}

async function pushSuggestion(
  t: ReturnType<typeof convexTest>,
  rawToken: string,
  suggestion: {
    filePath: string;
    layerId: string;
    suggestedNodeName: string;
    confidence: number;
    reason: string;
  },
) {
  return await t.fetch('/api/mcp/codebase_suggestions/push', {
    method: 'POST',
    headers: { Authorization: `Bearer ${rawToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ suggestions: [suggestion] }),
  });
}

describe('codebase suggestions', () => {
  test('push requires a project API token and validates payload shape', async () => {
    const t = convexTest(schema, modules);

    const noToken = await t.fetch('/api/mcp/codebase_suggestions/push', {
      method: 'POST',
      body: JSON.stringify({ suggestions: [] }),
    });
    expect(noToken.status).toBe(401);

    const { rawToken } = await seedTokenForUser(t);
    const invalid = await t.fetch('/api/mcp/codebase_suggestions/push', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ suggestions: [] }),
    });
    expect(invalid.status).toBe(400);
  });

  test('push stores a low-confidence file-to-layer suggestion for canvas review', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);

    const res = await pushSuggestion(t, rawToken, {
      filePath: 'apps/web/app/page.tsx',
      layerId: layers[0]!._id,
      suggestedNodeName: 'Home page',
      confidence: 0.6,
      reason: 'App route is a client surface.',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 1, pending: 1, applied: 0 });

    const pending = await asUser.query(api.codebaseSuggestions.listByProject, {
      projectId,
      status: 'pending',
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      filePath: 'apps/web/app/page.tsx',
      suggestedNodeName: 'Home page',
      source: 'hermes',
    });
    expect(pending[0]!.createdAt).toEqual(expect.any(Number));
    expect(pending[0]!.updatedAt).toBeGreaterThanOrEqual(pending[0]!.createdAt);
  });

  test('push updates an existing pending suggestion for the same file', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);

    await pushSuggestion(t, rawToken, {
      filePath: 'apps/web/app/page.tsx',
      layerId: layers[0]!._id,
      suggestedNodeName: 'Old page name',
      confidence: 0.5,
      reason: 'Old classification.',
    });
    const first = await asUser.query(api.codebaseSuggestions.listByProject, {
      projectId,
      status: 'pending',
    });

    await pushSuggestion(t, rawToken, {
      filePath: 'apps/web/app/page.tsx',
      layerId: layers[1]!._id,
      suggestedNodeName: 'Updated page name',
      confidence: 0.7,
      reason: 'Latest Hermes classification should replace the stale pending row.',
    });

    const pending = await asUser.query(api.codebaseSuggestions.listByProject, {
      projectId,
      status: 'pending',
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      _id: first[0]!._id,
      layerId: layers[1]!._id,
      suggestedNodeName: 'Updated page name',
      confidence: 0.7,
      reason: 'Latest Hermes classification should replace the stale pending row.',
    });
    expect(pending[0]!.createdAt).toBe(first[0]!.createdAt);
    expect(pending[0]!.updatedAt).toBeGreaterThanOrEqual(first[0]!.updatedAt);
  });

  test('push auto-applies high-confidence suggestions into the requested layer', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);

    const res = await pushSuggestion(t, rawToken, {
      filePath: 'apps/web/lib/hermes.ts',
      layerId: layers[3]!._id,
      suggestedNodeName: 'Hermes bridge',
      confidence: 0.91,
      reason: 'Agent integration code belongs with MCP / Agents.',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 1, pending: 0, applied: 1 });

    const nodes = await asUser.query(api.nodes.listByProject, { projectId });
    const node = nodes.find((n) => n.name === 'Hermes bridge');
    expect(node).toBeDefined();
    expect(node!.layerId).toBe(layers[3]!._id);

    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId: node!._id });
    expect(files.map((f) => f.path)).toEqual(['apps/web/lib/hermes.ts']);

    const applied = await asUser.query(api.codebaseSuggestions.listByProject, {
      projectId,
      status: 'applied',
    });
    expect(applied[0]).toMatchObject({
      filePath: 'apps/web/lib/hermes.ts',
      appliedNodeId: node!._id,
    });
  });

  test('push rejects a layer from another project', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken } = await seedTokenForUser(t);
    const otherProjectId = await asUser.mutation(api.projects.create, { name: 'Other' });
    const otherLayers = await asUser.query(api.projectLayers.listByProject, {
      projectId: otherProjectId,
    });

    const res = await pushSuggestion(t, rawToken, {
      filePath: 'src/wrong.ts',
      layerId: otherLayers[0]!._id,
      suggestedNodeName: 'Wrong',
      confidence: 0.8,
      reason: 'Wrong project layer.',
    });

    expect(res.status).toBe(403);
  });

  test('push skips a file already linked in the project without creating a duplicate node', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);
    const existingNode = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[0]!._id,
      type: 'page',
      name: 'Existing',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodeFiles.add, {
      nodeId: existingNode,
      path: 'src/already.ts',
    });

    const res = await pushSuggestion(t, rawToken, {
      filePath: 'src/already.ts',
      layerId: layers[1]!._id,
      suggestedNodeName: 'Duplicate',
      confidence: 0.99,
      reason: 'Already linked.',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      accepted: 0,
      skipped: [{ filePath: 'src/already.ts', reason: 'already_linked' }],
    });

    const nodes = await asUser.query(api.nodes.listByProject, { projectId });
    expect(nodes.map((n) => n.name)).toEqual(['Existing']);
  });

  test('apply and reject let the canvas resolve pending suggestions manually', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);
    await pushSuggestion(t, rawToken, {
      filePath: 'src/manual.ts',
      layerId: layers[2]!._id,
      suggestedNodeName: 'Manual mapping',
      confidence: 0.7,
      reason: 'Convex code belongs in Convex layer.',
    });
    await pushSuggestion(t, rawToken, {
      filePath: 'src/reject.ts',
      layerId: layers[2]!._id,
      suggestedNodeName: 'Reject me',
      confidence: 0.7,
      reason: 'Will be rejected.',
    });

    const pending = await asUser.query(api.codebaseSuggestions.listByProject, {
      projectId,
      status: 'pending',
    });
    const manual = pending.find((s) => s.filePath === 'src/manual.ts')!;
    const rejected = pending.find((s) => s.filePath === 'src/reject.ts')!;

    const nodeId = await asUser.mutation(api.codebaseSuggestions.apply, { id: manual._id });
    await asUser.mutation(api.codebaseSuggestions.reject, { id: rejected._id });

    const node = await asUser.query(api.nodes.get, { id: nodeId });
    expect(node).toMatchObject({ name: 'Manual mapping', layerId: layers[2]!._id });

    const rejectedRows = await asUser.query(api.codebaseSuggestions.listByProject, {
      projectId,
      status: 'rejected',
    });
    expect(rejectedRows.map((s) => s.filePath)).toContain('src/reject.ts');
  });

  test('project deletion removes suggestion inbox rows', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);
    await pushSuggestion(t, rawToken, {
      filePath: 'src/delete-me.ts',
      layerId: layers[0]!._id,
      suggestedNodeName: 'Delete me',
      confidence: 0.5,
      reason: 'Temporary suggestion.',
    });

    await asUser.mutation(api.projects.remove, { id: projectId });

    const leftovers = await t.run(async (ctx) =>
      ctx.db
        .query('codebaseSuggestions')
        .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', 'pending'))
        .collect(),
    );
    expect(leftovers).toEqual([]);
  });
});
