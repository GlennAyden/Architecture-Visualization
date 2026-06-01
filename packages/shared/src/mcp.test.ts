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
      source: 'hermes',
      confidence: 0.9,
    });
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
});
