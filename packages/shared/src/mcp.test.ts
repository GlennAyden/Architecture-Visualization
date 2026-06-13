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
        },
      ],
    });

    expect(parsed.suggestions[0]).toMatchObject({
      filePath: 'apps/web/app/page.tsx',
      action: 'create_node',
      source: 'hermes',
      confidence: 0.9,
    });
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
        },
      ],
    });

    expect(parsed.suggestions[0]!.action).toBe('ignore');
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
