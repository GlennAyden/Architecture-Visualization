import { describe, expect, test } from 'vitest';
import {
  createNodeInput,
  updateNodeInput,
  getNodeInput,
  deleteNodeInput,
  linkFilesInput,
  addKanbanTaskInput,
  updateKanbanStatusInput,
  logActivityInput,
  hermesMappingRunCompleteInput,
  pushCodebaseSuggestionsInput,
} from './mcp';

describe('createNodeInput', () => {
  test('accepts minimal input', () => {
    expect(createNodeInput.parse({ type: 'page', name: 'Home' })).toEqual({
      type: 'page',
      name: 'Home',
    });
  });

  test('accepts feature with parentId and optional fields', () => {
    const parsed = createNodeInput.parse({
      type: 'feature',
      name: 'Auth',
      parentId: 'nodes:abc',
      layerId: 'projectLayers:abc',
      description: 'OAuth handlers',
      files: ['src/auth.ts'],
      positionX: 100,
      positionY: 200,
    });
    expect(parsed.type).toBe('feature');
    expect(parsed.layerId).toBe('projectLayers:abc');
    expect(parsed.files).toEqual(['src/auth.ts']);
  });

  test('rejects unknown type', () => {
    expect(() => createNodeInput.parse({ type: 'component', name: 'X' })).toThrow();
  });

  test('rejects empty name', () => {
    expect(() => createNodeInput.parse({ type: 'page', name: '   ' })).toThrow(/required/i);
  });
});

describe('updateNodeInput', () => {
  test('requires nodeId', () => {
    expect(() => updateNodeInput.parse({ name: 'New' })).toThrow();
  });

  test('allows partial fields', () => {
    expect(updateNodeInput.parse({ nodeId: 'nodes:abc', description: 'updated' })).toMatchObject({
      nodeId: 'nodes:abc',
      description: 'updated',
    });
  });
});

describe('linkFilesInput', () => {
  test('accepts list of paths', () => {
    expect(linkFilesInput.parse({ nodeId: 'nodes:abc', paths: ['a.ts', 'b.ts'] })).toEqual({
      nodeId: 'nodes:abc',
      paths: ['a.ts', 'b.ts'],
    });
  });

  test('rejects empty paths array', () => {
    expect(() => linkFilesInput.parse({ nodeId: 'nodes:abc', paths: [] })).toThrow();
  });
});

describe('addKanbanTaskInput', () => {
  test('defaults status to todo', () => {
    expect(addKanbanTaskInput.parse({ nodeId: 'nodes:abc', title: 'X' })).toMatchObject({
      status: 'todo',
    });
  });

  test('accepts all status values', () => {
    for (const status of ['todo', 'doing', 'done'] as const) {
      expect(addKanbanTaskInput.parse({ nodeId: 'nodes:abc', title: 'X', status }).status).toBe(
        status,
      );
    }
  });
});

describe('updateKanbanStatusInput', () => {
  test('rejects unknown status', () => {
    expect(() =>
      updateKanbanStatusInput.parse({ taskId: 'kanbanTasks:abc', status: 'archived' }),
    ).toThrow();
  });
});

describe('logActivityInput + getNodeInput + deleteNodeInput', () => {
  test('logActivityInput accepts optional metadata', () => {
    expect(
      logActivityInput.parse({ nodeId: 'nodes:abc', actor: 'mcp:claude-code', message: 'x' }),
    ).toMatchObject({ actor: 'mcp:claude-code' });
  });

  test('getNodeInput requires nodeId', () => {
    expect(getNodeInput.parse({ nodeId: 'nodes:abc' }).nodeId).toBe('nodes:abc');
  });

  test('deleteNodeInput requires nodeId', () => {
    expect(deleteNodeInput.parse({ nodeId: 'nodes:abc' }).nodeId).toBe('nodes:abc');
  });
});

describe('pushCodebaseSuggestionsInput', () => {
  test('accepts a Hermes file-to-layer suggestion contract', () => {
    const parsed = pushCodebaseSuggestionsInput.parse({
      suggestions: [
        {
          filePath: 'apps/web/app/page.tsx',
          layerId: 'projectLayers:abc',
          suggestedNodeName: 'Home page',
          confidence: 0.9,
          reason: 'App route belongs in the surface layer.',
          semanticKind: 'surface',
          fileRole: 'route',
        },
      ],
      relationshipSuggestions: [
        {
          sourceNodeId: 'nodes:web',
          targetNodeId: 'nodes:api',
          type: 'data_flow',
          label: 'calls login endpoint',
          confidence: 0.92,
          reason: 'The UI route submits credentials to the API route.',
          evidence: ['fetch /api/auth/login'],
        },
      ],
    });

    expect(parsed.suggestions[0]).toMatchObject({
      filePath: 'apps/web/app/page.tsx',
      action: 'create_node',
      source: 'hermes',
      confidence: 0.9,
      semanticKind: 'surface',
      fileRole: 'route',
    });
    expect(parsed.relationshipSuggestions[0]).toMatchObject({
      type: 'data_flow',
      source: 'hermes',
      confidence: 0.92,
    });
  });

  test('accepts relationship-only payloads for existing nodes', () => {
    const parsed = pushCodebaseSuggestionsInput.parse({
      relationshipSuggestions: [
        {
          sourceNodeId: 'nodes:web',
          targetNodeId: 'nodes:vps',
          type: 'data_flow',
          confidence: 0.93,
          reason: 'Auth proxy calls the VPS backend.',
        },
      ],
    });

    expect(parsed.suggestions).toEqual([]);
    expect(parsed.relationshipSuggestions).toHaveLength(1);
  });

  test('accepts flow-only payloads for semantic architecture review', () => {
    const parsed = pushCodebaseSuggestionsInput.parse({
      flowSuggestions: [
        {
          title: 'User login flow',
          shortTitle: 'Login flow',
          goal: 'Show how login reaches the auth backend.',
          importance: 0.92,
          curationKey: 'user:login',
          description: 'Browser submits credentials and the backend creates a session.',
          kind: 'user_journey',
          nodeIds: ['nodes:surface', 'nodes:api'],
          edgeRefs: [
            {
              sourceNodeId: 'nodes:surface',
              targetNodeId: 'nodes:api',
              type: 'data_flow',
            },
          ],
          steps: [
            {
              title: 'Submit credentials',
              description: 'The login surface calls the auth API.',
              nodeIds: ['nodes:surface', 'nodes:api'],
            },
          ],
          confidence: 0.91,
          reason: 'The selected nodes and edge form a reviewable user journey.',
          evidence: ['Login node sends data to API node'],
        },
      ],
    });

    expect(parsed.suggestions).toEqual([]);
    expect(parsed.relationshipSuggestions).toEqual([]);
    expect(parsed.flowSuggestions[0]).toMatchObject({
      title: 'User login flow',
      shortTitle: 'Login flow',
      importance: 0.92,
      curationKey: 'user:login',
      kind: 'user_journey',
      source: 'hermes',
    });
  });

  test('rejects flow importance outside the 0..1 range', () => {
    expect(() =>
      pushCodebaseSuggestionsInput.parse({
        flowSuggestions: [
          {
            title: 'Invalid importance',
            description: 'Importance must stay bounded for sorting.',
            kind: 'user_journey',
            nodeIds: ['nodes:surface', 'nodes:api'],
            steps: [{ title: 'Call API', description: 'Surface calls API.' }],
            confidence: 0.91,
            importance: 1.5,
            reason: 'Invalid sorting weight.',
          },
        ],
      }),
    ).toThrow();
  });

  test('rejects flows without at least two nodes', () => {
    expect(() =>
      pushCodebaseSuggestionsInput.parse({
        flowSuggestions: [
          {
            title: 'Too small',
            description: 'Not enough context.',
            kind: 'system_process',
            nodeIds: ['nodes:only'],
            steps: [{ title: 'One node', description: 'Cannot form a flow.' }],
            confidence: 0.8,
            reason: 'Needs more than one node.',
          },
        ],
      }),
    ).toThrow();
  });

  test('accepts V2 action suggestions for link, group, and ignore', () => {
    const parsed = pushCodebaseSuggestionsInput.parse({
      runId: 'runs:abc',
      suggestions: [
        {
          filePath: 'apps/web/app/api/auth/login/route.ts',
          action: 'link_existing_node',
          targetNodeId: 'nodes:auth',
          confidence: 0.91,
          reason: 'Existing auth node already owns this behavior.',
          evidence: ['route handler', 'auth proxy'],
        },
        {
          filePath: 'apps/web/lib/auth/proxy.ts',
          action: 'group_into_node',
          groupKey: 'auth-proxy',
          layerId: 'projectLayers:infra',
          suggestedNodeName: 'Auth Proxy',
          confidence: 0.88,
          reason: 'Shared auth proxy files should be grouped.',
        },
        {
          filePath: 'convex/_generated/api.js',
          action: 'ignore',
          confidence: 0.95,
          reason: 'Generated file is not an architecture node.',
        },
      ],
    });

    expect(parsed.runId).toBe('runs:abc');
    expect(parsed.suggestions.map((s) => s.action)).toEqual([
      'link_existing_node',
      'group_into_node',
      'ignore',
    ]);
  });

  test('rejects invalid confidence and empty suggestion fields', () => {
    expect(() =>
      pushCodebaseSuggestionsInput.parse({
        suggestions: [
          {
            filePath: 'src/a.ts',
            layerId: 'projectLayers:abc',
            suggestedNodeName: 'A',
            confidence: 1.1,
            reason: 'too high',
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      pushCodebaseSuggestionsInput.parse({
        suggestions: [
          {
            filePath: '   ',
            layerId: 'projectLayers:abc',
            suggestedNodeName: '   ',
            confidence: 0.5,
            reason: '',
          },
        ],
      }),
    ).toThrow();
  });

  test('requires target identifiers for action-specific suggestions', () => {
    expect(() =>
      pushCodebaseSuggestionsInput.parse({
        suggestions: [
          {
            filePath: 'src/a.ts',
            action: 'link_existing_node',
            confidence: 0.9,
            reason: 'Missing target node.',
          },
        ],
      }),
    ).toThrow(/targetNodeId/);

    expect(() =>
      pushCodebaseSuggestionsInput.parse({
        suggestions: [
          {
            filePath: 'src/a.ts',
            action: 'group_into_node',
            layerId: 'projectLayers:abc',
            confidence: 0.9,
            reason: 'Missing group key.',
          },
        ],
      }),
    ).toThrow(/groupKey/);
  });
});

describe('hermesMappingRunCompleteInput', () => {
  test('accepts successful run completion with V2 suggestions', () => {
    const parsed = hermesMappingRunCompleteInput.parse({
      runId: 'runs:abc',
      submitToken: 'x'.repeat(32),
      status: 'completed',
      suggestions: [
        {
          filePath: 'src/a.ts',
          action: 'ignore',
          confidence: 0.95,
          reason: 'Generated/test-only file.',
          semanticKind: 'test_harness',
          fileRole: 'test',
        },
      ],
      relationshipSuggestions: [
        {
          sourceNodeId: 'nodes:a',
          targetNodeId: 'nodes:b',
          type: 'dependency',
          confidence: 0.91,
          reason: 'Static import resolves to the target node.',
        },
      ],
      flowSuggestions: [
        {
          title: 'Auth proxy flow',
          description: 'Web auth route talks to the VPS backend.',
          kind: 'integration',
          nodeIds: ['nodes:a', 'nodes:b'],
          steps: [{ title: 'Proxy request', description: 'The route forwards to the backend.' }],
          confidence: 0.9,
          reason: 'A data-flow relationship connects both nodes.',
        },
      ],
    });

    expect(parsed.suggestions[0]!.action).toBe('ignore');
    expect(parsed.relationshipSuggestions[0]!.type).toBe('dependency');
    expect(parsed.flowSuggestions[0]!.kind).toBe('integration');
  });

  test('requires a safe error message for failed run completion', () => {
    expect(() =>
      hermesMappingRunCompleteInput.parse({
        runId: 'runs:abc',
        submitToken: 'x'.repeat(32),
        status: 'failed',
      }),
    ).toThrow(/errorMessage/);
  });
});
