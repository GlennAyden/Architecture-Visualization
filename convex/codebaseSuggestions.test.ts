import { convexTest } from 'convex-test';
import type { FunctionReference } from 'convex/server';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const semanticSuggestionApi = api.semanticNodeSuggestions as typeof api.semanticNodeSuggestions & {
  duplicateReport: FunctionReference<'query', 'public', { projectId: string }, unknown[]>;
  consolidateSemanticDuplicateGroup: FunctionReference<
    'mutation',
    'public',
    { projectId: string; groupKey: string; canonicalNodeId?: string },
    Record<string, unknown>
  >;
};

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

async function hashSubmitToken(raw: string) {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

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
    action?: 'create_node' | 'link_existing_node' | 'group_into_node' | 'ignore';
    layerId?: string;
    targetNodeId?: string;
    groupKey?: string;
    suggestedNodeName?: string;
    confidence: number;
    reason: string;
    evidence?: string[];
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

  test('push links high-confidence suggestions to an existing target node', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);
    const authNode = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[4]!._id,
      type: 'page',
      name: 'Auth Proxy',
      positionX: 0,
      positionY: 0,
    });

    const res = await pushSuggestion(t, rawToken, {
      filePath: 'apps/web/app/api/auth/login/route.ts',
      action: 'link_existing_node',
      targetNodeId: authNode,
      suggestedNodeName: 'Auth Proxy',
      confidence: 0.91,
      reason: 'Route belongs to the existing auth proxy node.',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 1, applied: 1 });

    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId: authNode });
    expect(files.map((file) => file.path)).toContain('apps/web/app/api/auth/login/route.ts');
  });

  test('push groups related files into one node when group confidence is high', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);

    const res = await t.fetch('/api/mcp/codebase_suggestions/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${rawToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        suggestions: [
          {
            filePath: 'apps/web/lib/auth/proxy.ts',
            action: 'group_into_node',
            groupKey: 'auth-proxy',
            layerId: layers[4]!._id,
            suggestedNodeName: 'Auth Proxy',
            confidence: 0.86,
            reason: 'Shared auth proxy files should be grouped.',
          },
          {
            filePath: 'apps/web/lib/auth/request.ts',
            action: 'group_into_node',
            groupKey: 'auth-proxy',
            layerId: layers[4]!._id,
            suggestedNodeName: 'Auth Proxy',
            confidence: 0.86,
            reason: 'Shared auth proxy files should be grouped.',
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 2, applied: 2 });

    const nodes = await asUser.query(api.nodes.listByProject, { projectId });
    const grouped = nodes.filter((node) => node.name === 'Auth Proxy');
    expect(grouped).toHaveLength(1);
    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId: grouped[0]!._id });
    expect(files.map((file) => file.path).sort()).toEqual([
      'apps/web/lib/auth/proxy.ts',
      'apps/web/lib/auth/request.ts',
    ]);
  });

  test('push ignores high-confidence generated or support files without creating nodes', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId } = await seedTokenForUser(t);

    const res = await pushSuggestion(t, rawToken, {
      filePath: 'convex/_generated/api.js',
      action: 'ignore',
      confidence: 0.96,
      reason: 'Generated output should be hidden from orphan review.',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 1, ignored: 1 });

    const ignored = await asUser.query(api.codebaseSuggestions.listByProject, {
      projectId,
      status: 'ignored',
    });
    expect(ignored.map((suggestion) => suggestion.filePath)).toEqual(['convex/_generated/api.js']);
    await expect(asUser.query(api.nodes.listByProject, { projectId })).resolves.toHaveLength(0);
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

  test('push rejects a target node from another project', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken } = await seedTokenForUser(t);
    const otherProjectId = await asUser.mutation(api.projects.create, { name: 'Other' });
    const otherLayers = await asUser.query(api.projectLayers.listByProject, {
      projectId: otherProjectId,
    });
    const otherNode = await asUser.mutation(api.nodes.create, {
      projectId: otherProjectId,
      layerId: otherLayers[0]!._id,
      type: 'page',
      name: 'Foreign',
      positionX: 0,
      positionY: 0,
    });

    const res = await pushSuggestion(t, rawToken, {
      filePath: 'src/wrong-link.ts',
      action: 'link_existing_node',
      targetNodeId: otherNode,
      suggestedNodeName: 'Wrong link',
      confidence: 0.91,
      reason: 'Wrong project target.',
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

  test('bulk pending actions process all review rows without changing applied rows', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);

    await pushSuggestion(t, rawToken, {
      filePath: 'src/apply-a.ts',
      layerId: layers[0]!._id,
      suggestedNodeName: 'Apply A',
      confidence: 0.4,
      reason: 'Manual bulk apply candidate.',
    });
    await pushSuggestion(t, rawToken, {
      filePath: 'src/apply-b.ts',
      layerId: layers[0]!._id,
      suggestedNodeName: 'Apply B',
      confidence: 0.4,
      reason: 'Manual bulk apply candidate.',
    });

    await expect(
      asUser.mutation(api.codebaseSuggestions.applyAllPending, { projectId }),
    ).resolves.toMatchObject({ applied: 2, failed: 0 });
    const applied = await asUser.query(api.codebaseSuggestions.listByProject, {
      projectId,
      status: 'applied',
    });
    expect(applied.map((row) => row.filePath).sort()).toEqual(['src/apply-a.ts', 'src/apply-b.ts']);

    await pushSuggestion(t, rawToken, {
      filePath: 'src/ignore.ts',
      layerId: layers[0]!._id,
      suggestedNodeName: 'Ignore Me',
      confidence: 0.4,
      reason: 'Manual bulk ignore candidate.',
    });
    await expect(
      asUser.mutation(api.codebaseSuggestions.ignoreAllPending, { projectId }),
    ).resolves.toMatchObject({ ignored: 1, failed: 0 });

    await pushSuggestion(t, rawToken, {
      filePath: 'src/reject-all.ts',
      layerId: layers[0]!._id,
      suggestedNodeName: 'Reject Me',
      confidence: 0.4,
      reason: 'Manual bulk reject candidate.',
    });
    await expect(
      asUser.mutation(api.codebaseSuggestions.rejectAllPending, { projectId }),
    ).resolves.toMatchObject({ rejected: 1, failed: 0 });

    const stillApplied = await asUser.query(api.codebaseSuggestions.listByProject, {
      projectId,
      status: 'applied',
    });
    expect(stillApplied).toHaveLength(2);
  });

  test('push stores architecture flow suggestions for canvas review', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);
    const surface = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[0]!._id,
      type: 'page',
      name: 'Login Surface',
      positionX: 0,
      positionY: 0,
    });
    const apiNode = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[2]!._id,
      type: 'page',
      name: 'Auth API',
      positionX: 300,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/codebase_suggestions/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${rawToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        flowSuggestions: [
          {
            title: 'Login review flow',
            description: 'The login surface calls the auth API.',
            kind: 'user_journey',
            nodeIds: [surface, apiNode],
            edgeRefs: [{ sourceNodeId: surface, targetNodeId: apiNode, type: 'data_flow' }],
            steps: [
              {
                title: 'Submit credentials',
                description: 'The surface sends credentials to the API.',
                nodeIds: [surface, apiNode],
              },
            ],
            confidence: 0.72,
            reason: 'Hermes found a reviewable login journey.',
            evidence: ['Login Surface -> Auth API'],
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 1, flowPending: 1, flowApplied: 0 });

    const pending = await asUser.query(api.architectureFlows.listByProject, {
      projectId,
      status: 'pending',
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      title: 'Login review flow',
      kind: 'user_journey',
      confidence: 0.72,
      source: 'hermes',
    });
    expect(pending[0]!.nodeNames[surface]).toBe('Login Surface');

    await asUser.mutation(api.architectureFlows.apply, { id: pending[0]!._id });
    const applied = await asUser.query(api.architectureFlows.listByProject, {
      projectId,
      status: 'applied',
    });
    expect(applied.map((flow) => flow.title)).toContain('Login review flow');
  });

  test('curationKey updates an existing pending flow instead of duplicating it', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);
    const surface = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[0]!._id,
      type: 'page',
      name: 'Admin Surface',
      positionX: 0,
      positionY: 0,
    });
    const apiNode = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[2]!._id,
      type: 'page',
      name: 'Admin API',
      positionX: 300,
      positionY: 0,
    });
    const dataNode = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[3]!._id,
      type: 'page',
      name: 'Admin Data',
      positionX: 600,
      positionY: 0,
    });

    const flow = (title: string, importance: number) => ({
      title,
      shortTitle: 'Admin Journey',
      goal: 'Show the admin surface reaching API and data ownership.',
      importance,
      curationKey: 'flow:admin-journey',
      description: 'Admin surface calls the API and the API writes data.',
      kind: 'user_journey',
      nodeIds: [surface, apiNode, dataNode],
      edgeRefs: [
        { sourceNodeId: surface, targetNodeId: apiNode, type: 'data_flow' },
        { sourceNodeId: apiNode, targetNodeId: dataNode, type: 'data_flow' },
      ],
      steps: [
        { title: 'Open admin', description: 'Admin starts from the surface.', nodeIds: [surface] },
        { title: 'Call API', description: 'Surface calls API.', nodeIds: [apiNode] },
        { title: 'Write data', description: 'API writes data.', nodeIds: [dataNode] },
      ],
      confidence: 0.82,
      reason: 'A curated user journey has multiple nodes and edges.',
      evidence: ['Admin Surface -> Admin API', 'Admin API -> Admin Data'],
    });

    await t.fetch('/api/mcp/codebase_suggestions/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${rawToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ flowSuggestions: [flow('Old admin title', 0.7)] }),
    });
    await t.fetch('/api/mcp/codebase_suggestions/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${rawToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ flowSuggestions: [flow('Updated admin title', 0.96)] }),
    });

    const pending = await asUser.query(api.architectureFlows.listByProject, {
      projectId,
      status: 'pending',
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      title: 'Updated admin title',
      shortTitle: 'Admin Journey',
      importance: 0.96,
      curationKey: 'flow:admin-journey',
      isCurated: true,
    });
  });

  test('high-confidence low-value two-node data flow stays pending and is marked legacy', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);
    const source = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[1]!._id,
      type: 'page',
      name: 'Domain Services',
      positionX: 0,
      positionY: 0,
    });
    const target = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[2]!._id,
      type: 'page',
      name: 'Admin Service',
      positionX: 300,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/codebase_suggestions/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${rawToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        flowSuggestions: [
          {
            title: 'Domain Services writes through Admin Service',
            description: 'A single edge should not become a featured flow.',
            kind: 'data_flow',
            nodeIds: [source, target],
            edgeRefs: [{ sourceNodeId: source, targetNodeId: target, type: 'data_flow' }],
            steps: [{ title: 'Write', description: 'Domain writes through service.' }],
            confidence: 0.95,
            reason: 'This is only a pairwise edge-level flow.',
            evidence: ['Domain Services -> Admin Service'],
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ flowPending: 1, flowApplied: 0 });

    const pending = await asUser.query(api.architectureFlows.listByProject, {
      projectId,
      status: 'pending',
    });
    expect(pending[0]).toMatchObject({ isCurated: false });
  });

  test('applied architecture flows sort by importance before recency', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);
    const a = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[0]!._id,
      type: 'page',
      name: 'Surface',
      positionX: 0,
      positionY: 0,
    });
    const b = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[2]!._id,
      type: 'page',
      name: 'API',
      positionX: 300,
      positionY: 0,
    });
    const c = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[3]!._id,
      type: 'page',
      name: 'Data',
      positionX: 600,
      positionY: 0,
    });

    const flow = (title: string, importance: number, key: string) => ({
      title,
      shortTitle: title,
      importance,
      curationKey: key,
      description: 'A curated three-node flow.',
      kind: 'system_process',
      nodeIds: [a, b, c],
      edgeRefs: [
        { sourceNodeId: a, targetNodeId: b, type: 'data_flow' },
        { sourceNodeId: b, targetNodeId: c, type: 'data_flow' },
      ],
      steps: [
        { title: 'Surface', description: 'Starts at the surface.', nodeIds: [a] },
        { title: 'API', description: 'Moves through the API.', nodeIds: [b] },
        { title: 'Data', description: 'Ends at data ownership.', nodeIds: [c] },
      ],
      confidence: 0.94,
      reason: 'Curated flow with enough nodes and edges.',
      evidence: ['Surface -> API', 'API -> Data'],
    });

    await t.fetch('/api/mcp/codebase_suggestions/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${rawToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        flowSuggestions: [
          flow('Less important', 0.4, 'flow:low'),
          flow('More important', 0.95, 'flow:high'),
        ],
      }),
    });

    const applied = await asUser.query(api.architectureFlows.listByProject, {
      projectId,
      status: 'applied',
    });
    expect(applied.map((row) => row.title)).toEqual(['More important', 'Less important']);
  });

  test('semantic product suggestions create UI modules, capabilities, edges, and a surface flow', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);
    const surface = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[0]!._id,
      type: 'page',
      name: 'User Dashboard',
      positionX: 0,
      positionY: 0,
      semanticKind: 'surface',
      productArea: 'user',
      routeHint: '/dashboard',
    });
    await asUser.mutation(api.nodeFiles.add, {
      nodeId: surface,
      path: 'src/app/dashboard/page.tsx',
      role: 'route',
    });

    const res = await t.fetch('/api/mcp/codebase_suggestions/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${rawToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        semanticNodeSuggestions: [
          {
            sourceFilePath: 'src/app/dashboard/page.tsx',
            semanticKey: 'ui:/dashboard:onboarding',
            suggestedNodeName: 'Onboarding Panel',
            semanticKind: 'ui_module',
            productArea: 'user',
            capabilityKey: 'onboarding',
            routeHint: '/dashboard',
            layerId: layers[1]!._id,
            parentNodeId: surface,
            confidence: 0.89,
            reason: 'The dashboard contains onboarding setup copy.',
            evidence: ['Welcome back', 'get started'],
          },
          {
            sourceFilePath: 'src/app/dashboard/page.tsx',
            semanticKey: 'ui:/dashboard:billing',
            suggestedNodeName: 'Subscription CTA',
            semanticKind: 'ui_module',
            productArea: 'user',
            capabilityKey: 'billing_subscription',
            routeHint: '/dashboard',
            layerId: layers[1]!._id,
            parentNodeId: surface,
            confidence: 0.89,
            reason: 'The dashboard exposes plan and redeem-code CTAs.',
            evidence: ['Redeem code', 'View plans'],
          },
          {
            sourceFilePath: 'src/app/dashboard/page.tsx',
            semanticKey: 'capability:onboarding:src/app/dashboard/page.tsx',
            suggestedNodeName: 'Onboarding',
            semanticKind: 'capability',
            productArea: 'user',
            capabilityKey: 'onboarding',
            routeHint: '/dashboard',
            layerId: layers[2]!._id,
            confidence: 0.91,
            reason: 'Onboarding is a product capability surfaced on the dashboard.',
            evidence: ['Welcome back', 'quick steps'],
          },
          {
            sourceFilePath: 'src/app/dashboard/page.tsx',
            semanticKey: 'capability:billing_subscription:src/app/dashboard/page.tsx',
            suggestedNodeName: 'Billing & Subscription',
            semanticKind: 'capability',
            productArea: 'user',
            capabilityKey: 'billing_subscription',
            routeHint: '/dashboard',
            layerId: layers[2]!._id,
            confidence: 0.91,
            reason: 'Billing is a product capability surfaced on the dashboard.',
            evidence: ['Redeem code', 'View plans'],
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ semanticApplied: 4 });

    const nodes = await asUser.query(api.nodes.listByProject, { projectId });
    const nodeByName = new Map(nodes.map((node) => [node.name, node]));
    expect(nodeByName.get('Onboarding Panel')).toMatchObject({
      type: 'feature',
      parentId: surface,
      semanticKind: 'ui_module',
      productArea: 'user',
      capabilityKey: 'onboarding',
      layerId: layers[0]!._id,
    });
    expect(nodeByName.get('Billing & Subscription')).toMatchObject({
      semanticKind: 'capability',
      capabilityKey: 'billing_subscription',
      layerId: layers[2]!._id,
    });

    const onboardingFiles = await asUser.query(api.nodeFiles.listByNode, {
      nodeId: nodeByName.get('Onboarding Panel')!._id,
    });
    expect(onboardingFiles.map((file) => file.path)).toContain('src/app/dashboard/page.tsx');
    expect(onboardingFiles[0]).toMatchObject({ role: 'ui', source: 'hermes' });

    const edges = await asUser.query(api.nodeEdges.listByProject, { projectId });
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: surface,
          targetNodeId: nodeByName.get('Onboarding Panel')!._id,
          type: 'contains',
        }),
        expect.objectContaining({
          sourceNodeId: nodeByName.get('Subscription CTA')!._id,
          targetNodeId: nodeByName.get('Billing & Subscription')!._id,
          type: 'triggers',
        }),
      ]),
    );

    const flows = await asUser.query(api.architectureFlows.listByProject, {
      projectId,
      status: 'applied',
    });
    expect(flows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'User Dashboard Experience',
          kind: 'user_journey',
          productArea: 'user',
          isCurated: true,
        }),
      ]),
    );
  });

  test('semantic UI module suggestions merge into an existing canonical node', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);
    const surface = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[0]!._id,
      type: 'page',
      name: 'Admin Console',
      positionX: 0,
      positionY: 0,
      semanticKind: 'surface',
      productArea: 'admin',
      routeHint: '/admin',
    });

    const res = await t.fetch('/api/mcp/codebase_suggestions/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${rawToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        semanticNodeSuggestions: [
          {
            sourceFilePath: 'src/components/admin/users.tsx',
            semanticKey: 'ui:admin:/admin:admin_operations',
            suggestedNodeName: 'Admin Operations',
            semanticKind: 'ui_module',
            productArea: 'admin',
            capabilityKey: 'admin_operations',
            routeHint: '/admin',
            layerId: layers[1]!._id,
            parentNodeId: surface,
            confidence: 0.9,
            reason: 'Admin users UI belongs to admin operations.',
            evidence: ['users table'],
          },
          {
            sourceFilePath: 'src/components/admin/filters.tsx',
            semanticKey: 'ui:admin:/admin:admin_operations:filters',
            suggestedNodeName: 'Admin Operations',
            semanticKind: 'ui_module',
            productArea: 'admin',
            capabilityKey: 'admin_operations',
            routeHint: '/admin',
            layerId: layers[1]!._id,
            parentNodeId: surface,
            confidence: 0.9,
            reason: 'Admin filters UI belongs to admin operations.',
            evidence: ['filters panel'],
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ semanticApplied: 2 });

    const nodes = await asUser.query(api.nodes.listByProject, { projectId });
    const adminOps = nodes.filter(
      (node) => node.semanticKind === 'ui_module' && node.capabilityKey === 'admin_operations',
    );
    expect(adminOps).toHaveLength(1);
    expect(adminOps[0]).toMatchObject({ parentId: surface, type: 'feature' });

    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId: adminOps[0]!._id });
    expect(files.map((file) => file.path).sort()).toEqual([
      'src/components/admin/filters.tsx',
      'src/components/admin/users.tsx',
    ]);
  });

  test('semantic duplicate report and consolidation move files to a canonical node', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, layers } = await seedTokenForUser(t);
    const first = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[1]!._id,
      type: 'page',
      name: 'Notifications',
      positionX: 0,
      positionY: 0,
      semanticKind: 'ui_module',
      productArea: 'admin',
      capabilityKey: 'notifications',
    });
    const second = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[1]!._id,
      type: 'page',
      name: 'Notifications',
      positionX: 0,
      positionY: 120,
      semanticKind: 'ui_module',
      productArea: 'admin',
      capabilityKey: 'notifications',
    });
    await asUser.mutation(api.nodeFiles.add, {
      nodeId: first,
      path: 'src/admin/notification-bell.tsx',
      role: 'ui',
    });
    await asUser.mutation(api.nodeFiles.add, {
      nodeId: second,
      path: 'src/admin/notification-settings.tsx',
      role: 'ui',
    });

    const report = await asUser.query(semanticSuggestionApi.duplicateReport, {
      projectId,
    });
    expect(report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupKey: 'ui:admin:top:notifications',
          nodeCount: 2,
          uniqueFileCount: 2,
        }),
      ]),
    );

    const result = await asUser.mutation(semanticSuggestionApi.consolidateSemanticDuplicateGroup, {
      projectId,
      groupKey: 'ui:admin:top:notifications',
      canonicalNodeId: first,
    });
    expect(result).toMatchObject({ merged: 1, movedFiles: 1, failed: 0 });

    const nodes = await asUser.query(api.nodes.listByProject, { projectId });
    expect(nodes.some((node) => node._id === second)).toBe(false);
    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId: first });
    expect(files.map((file) => file.path).sort()).toEqual([
      'src/admin/notification-bell.tsx',
      'src/admin/notification-settings.tsx',
    ]);
  });

  test('mapping run complete route verifies submit token and stores suggestions', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, layers } = await seedTokenForUser(t);
    const submitToken = 'submit-token-submit-token-submit-token';
    const run = await asUser.mutation(api.hermesMappingRuns.start, {
      projectId,
      source: 'canvas',
      scope: 'orphans',
      submitTokenHash: await hashSubmitToken(submitToken),
    });

    const invalid = await t.fetch('/api/hermes/mapping-runs/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: run.runId,
        submitToken: 'wrong-token-wrong-token-wrong-token',
        status: 'completed',
        suggestions: [],
      }),
    });
    expect(invalid.status).toBe(401);

    const valid = await t.fetch('/api/hermes/mapping-runs/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: run.runId,
        submitToken,
        status: 'completed',
        suggestions: [
          {
            filePath: 'src/from-run.ts',
            layerId: layers[0]!._id,
            suggestedNodeName: 'From run',
            confidence: 0.6,
            reason: 'Run-scoped suggestion should enter the review queue.',
          },
        ],
      }),
    });
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toMatchObject({ pending: 1 });

    const runs = await asUser.query(api.hermesMappingRuns.latestByProject, { projectId });
    expect(runs[0]).toMatchObject({
      status: 'completed',
      suggestedCount: 1,
      pendingCount: 1,
    });
  });

  test('mapping run completion auto-applies high-confidence architecture flows', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, layers } = await seedTokenForUser(t);
    const surface = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[0]!._id,
      type: 'page',
      name: 'Web Surface',
      positionX: 0,
      positionY: 0,
    });
    const backend = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[2]!._id,
      type: 'page',
      name: 'Backend API',
      positionX: 300,
      positionY: 0,
    });
    const data = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[3]!._id,
      type: 'page',
      name: 'Data Store',
      positionX: 600,
      positionY: 0,
    });
    const submitToken = 'flow-submit-token-flow-submit-token';
    const run = await asUser.mutation(api.hermesMappingRuns.start, {
      projectId,
      source: 'canvas',
      scope: 'project',
      submitTokenHash: await hashSubmitToken(submitToken),
    });

    const valid = await t.fetch('/api/hermes/mapping-runs/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: run.runId,
        submitToken,
        status: 'completed',
        flowSuggestions: [
          {
            title: 'Surface to backend flow',
            shortTitle: 'Surface Flow',
            goal: 'Show UI work reaching backend and data ownership.',
            importance: 0.9,
            curationKey: 'flow:surface-backend-data',
            description: 'The UI invokes backend behavior.',
            kind: 'system_process',
            nodeIds: [surface, backend, data],
            edgeRefs: [
              { sourceNodeId: surface, targetNodeId: backend, type: 'data_flow' },
              { sourceNodeId: backend, targetNodeId: data, type: 'data_flow' },
            ],
            steps: [
              {
                title: 'Invoke backend',
                description: 'The surface sends work to the backend.',
                nodeIds: [surface, backend],
              },
              {
                title: 'Persist data',
                description: 'The backend writes to the data store.',
                nodeIds: [backend, data],
              },
            ],
            confidence: 0.93,
            reason: 'High-confidence node chain should become an applied flow.',
          },
        ],
      }),
    });

    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toMatchObject({ applied: 1 });

    const applied = await asUser.query(api.architectureFlows.listByProject, {
      projectId,
      status: 'applied',
    });
    expect(applied.map((flow) => flow.title)).toEqual(['Surface to backend flow']);

    const runs = await asUser.query(api.hermesMappingRuns.latestByProject, { projectId });
    expect(runs[0]).toMatchObject({ suggestedCount: 1, appliedCount: 1 });
  });

  test('mapping run completion rejects architecture flows with foreign nodes', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, layers } = await seedTokenForUser(t);
    const localNode = await asUser.mutation(api.nodes.create, {
      projectId,
      layerId: layers[0]!._id,
      type: 'page',
      name: 'Local',
      positionX: 0,
      positionY: 0,
    });
    const otherProjectId = await asUser.mutation(api.projects.create, { name: 'Foreign' });
    const otherLayers = await asUser.query(api.projectLayers.listByProject, {
      projectId: otherProjectId,
    });
    const foreignNode = await asUser.mutation(api.nodes.create, {
      projectId: otherProjectId,
      layerId: otherLayers[0]!._id,
      type: 'page',
      name: 'Foreign',
      positionX: 0,
      positionY: 0,
    });
    const submitToken = 'foreign-flow-submit-token-foreign';
    const run = await asUser.mutation(api.hermesMappingRuns.start, {
      projectId,
      source: 'canvas',
      scope: 'project',
      submitTokenHash: await hashSubmitToken(submitToken),
    });

    const res = await t.fetch('/api/hermes/mapping-runs/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: run.runId,
        submitToken,
        status: 'completed',
        flowSuggestions: [
          {
            title: 'Cross project flow',
            description: 'This should be rejected.',
            kind: 'integration',
            nodeIds: [localNode, foreignNode],
            steps: [{ title: 'Invalid', description: 'Foreign node ref.' }],
            confidence: 0.93,
            reason: 'Foreign node is outside project boundary.',
          },
        ],
      }),
    });

    expect(res.status).toBe(400);
  });

  test('bulk apply resolves pending suggestions above their action threshold', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken, projectId, layers } = await seedTokenForUser(t);
    await pushSuggestion(t, rawToken, {
      filePath: 'src/high.ts',
      layerId: layers[0]!._id,
      suggestedNodeName: 'High confidence',
      confidence: 0.84,
      reason: 'Below threshold at first so the user can bulk apply later after edit.',
    });
    const pending = await asUser.query(api.codebaseSuggestions.listByProject, {
      projectId,
      status: 'pending',
    });
    await asUser.mutation(api.codebaseSuggestions.updateReview, {
      id: pending[0]!._id,
      suggestedNodeName: 'High confidence',
      layerId: layers[0]!._id,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(pending[0]!._id, { confidence: 0.85 });
    });

    await expect(
      asUser.mutation(api.codebaseSuggestions.applyHighConfidence, { projectId }),
    ).resolves.toMatchObject({ applied: 1 });
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
    await asUser.mutation(api.hermesMappingRuns.start, {
      projectId,
      source: 'canvas',
      scope: 'orphans',
      submitTokenHash: await hashSubmitToken('delete-run-submit-token'),
    });

    await asUser.mutation(api.projects.remove, { id: projectId });

    const leftovers = await t.run(async (ctx) =>
      ctx.db
        .query('codebaseSuggestions')
        .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', 'pending'))
        .collect(),
    );
    expect(leftovers).toEqual([]);
    const runLeftovers = await t.run(async (ctx) =>
      ctx.db
        .query('hermesMappingRuns')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect(),
    );
    expect(runLeftovers).toEqual([]);
  });
});
