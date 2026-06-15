import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import {
  parsePushSuggestionsArgs,
  readSuggestionsPayload,
  runPushSuggestions,
} from './push-suggestions.js';

const TMPS: string[] = [];
afterAll(() => {
  for (const t of TMPS) {
    try {
      rmSync(t, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

const validEnv = {
  ARCHITECTURE_CONVEX_URL: 'https://dazzling-seahorse-444.convex.site',
  ARCHITECTURE_API_KEY: 'archv_abc',
  ARCHITECTURE_PROJECT_ID: 'projects:abc',
};

function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'arch-viz-suggestions-'));
  TMPS.push(root);
  return root;
}

describe('parsePushSuggestionsArgs', () => {
  test('requires --from-json so the CLI cannot silently guess an input source', () => {
    expect(parsePushSuggestionsArgs(['--from-json', 'suggestions.json'])).toEqual({
      fromJson: 'suggestions.json',
    });
    expect(() => parsePushSuggestionsArgs([])).toThrow(/--from-json/);
    expect(() => parsePushSuggestionsArgs(['--from-json'])).toThrow(/path/);
  });
});

describe('readSuggestionsPayload', () => {
  test('reads and validates the shared suggestions JSON contract', () => {
    const root = tempRepo();
    const file = join(root, 'suggestions.json');
    writeFileSync(
      file,
      JSON.stringify({
        suggestions: [
          {
            filePath: 'src/a.ts',
            layerId: 'projectLayers:abc',
            suggestedNodeName: 'A',
            confidence: 0.9,
            reason: 'Surface route.',
          },
        ],
      }),
    );

    expect(readSuggestionsPayload(file)).toMatchObject({
      suggestions: [{ filePath: 'src/a.ts', action: 'create_node', source: 'hermes' }],
    });
  });

  test('accepts V2 action suggestions for Hermes mapping review', () => {
    const root = tempRepo();
    const file = join(root, 'suggestions-v2.json');
    writeFileSync(
      file,
      JSON.stringify({
        runId: 'runs:abc',
        suggestions: [
          {
            filePath: 'src/generated.ts',
            action: 'ignore',
            confidence: 0.95,
            reason: 'Generated support file.',
            evidence: ['generated output'],
          },
          {
            filePath: 'src/login.ts',
            action: 'link_existing_node',
            targetNodeId: 'nodes:auth',
            confidence: 0.91,
            reason: 'Auth node already exists.',
          },
        ],
      }),
    );

    expect(readSuggestionsPayload(file)).toMatchObject({
      runId: 'runs:abc',
      suggestions: [
        { action: 'ignore', filePath: 'src/generated.ts' },
        { action: 'link_existing_node', targetNodeId: 'nodes:auth' },
      ],
    });
  });

  test('accepts architecture flow suggestions for Hermes flow review', () => {
    const root = tempRepo();
    const file = join(root, 'flow-suggestions.json');
    writeFileSync(
      file,
      JSON.stringify({
        flowSuggestions: [
          {
            title: 'User login reaches data layer',
            shortTitle: 'Login Flow',
            goal: 'Show how login reaches backend and data ownership.',
            importance: 0.91,
            curationKey: 'flow:login',
            description: 'Login surface calls the API and persists user state.',
            kind: 'user_journey',
            nodeIds: ['nodes:surface', 'nodes:api', 'nodes:data'],
            steps: [
              {
                title: 'Submit credentials',
                nodeIds: ['nodes:surface'],
                description: 'The browser sends the login form.',
              },
              {
                title: 'Validate user',
                nodeIds: ['nodes:api'],
                description: 'The backend validates and writes the session.',
              },
            ],
            confidence: 0.91,
            reason: 'The files and edges describe a real login path.',
          },
        ],
      }),
    );

    expect(readSuggestionsPayload(file)).toMatchObject({
      suggestions: [],
      flowSuggestions: [
        {
          title: 'User login reaches data layer',
          shortTitle: 'Login Flow',
          importance: 0.91,
          curationKey: 'flow:login',
          kind: 'user_journey',
          source: 'hermes',
        },
      ],
    });
  });

  test('fails loudly on malformed JSON', () => {
    const root = tempRepo();
    const file = join(root, 'bad.json');
    mkdirSync(root, { recursive: true });
    writeFileSync(file, '{not json');

    expect(() => readSuggestionsPayload(file)).toThrow(/Invalid JSON/);
  });
});

describe('runPushSuggestions', () => {
  test('posts the validated JSON payload to the codebase suggestions route', async () => {
    const root = tempRepo();
    const file = join(root, 'suggestions.json');
    writeFileSync(
      file,
      JSON.stringify({
        suggestions: [
          {
            filePath: 'src/a.ts',
            layerId: 'projectLayers:abc',
            suggestedNodeName: 'A',
            confidence: 0.9,
            reason: 'Surface route.',
          },
        ],
      }),
    );
    const calls: Array<{ path: string; body: unknown }> = [];
    const fakeClient = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return { accepted: 1, pending: 0, applied: 1, skipped: [] };
      },
    };

    const code = await runPushSuggestions(['--from-json', file], validEnv, root, fakeClient);

    expect(code).toBe(0);
    expect(calls).toEqual([
      {
        path: '/api/mcp/codebase_suggestions/push',
        body: {
          suggestions: [
            {
              filePath: 'src/a.ts',
              action: 'create_node',
              layerId: 'projectLayers:abc',
              suggestedNodeName: 'A',
              confidence: 0.9,
              reason: 'Surface route.',
              source: 'hermes',
            },
          ],
          semanticNodeSuggestions: [],
          relationshipSuggestions: [],
          flowSuggestions: [],
        },
      },
    ]);
  });
});
