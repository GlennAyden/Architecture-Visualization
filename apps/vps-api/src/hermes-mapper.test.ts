// @vitest-environment node

import { describe, expect, test } from 'vitest';

import { heuristicHermesMapper, type HermesMappingContext } from './hermes-mapper.js';

describe('heuristicHermesMapper architecture flows', () => {
  test('suggests a readable flow when meaningful architecture edges exist', async () => {
    const context: HermesMappingContext = {
      runId: 'runs:flow',
      project: { _id: 'projects:arch', name: 'Arch Viz' },
      layers: [
        { _id: 'layers:surface', name: 'Surfaces', position: 0 },
        { _id: 'layers:backend', name: 'Backend', position: 1 },
      ],
      nodes: [
        {
          _id: 'nodes:web',
          name: 'Web App',
          type: 'page',
          layerId: 'layers:surface',
          semanticKind: 'surface',
          files: ['apps/web/app/page.tsx'],
        },
        {
          _id: 'nodes:api',
          name: 'Auth API',
          type: 'page',
          layerId: 'layers:backend',
          semanticKind: 'api',
          files: ['apps/web/app/api/auth/login/route.ts'],
        },
      ],
      edges: [
        {
          _id: 'edges:web-api',
          sourceNodeId: 'nodes:web',
          targetNodeId: 'nodes:api',
          type: 'data_flow',
          label: 'login request',
          source: 'manual',
          confidence: 0.93,
        },
      ],
      latestScan: { data: { orphans: [] } },
      suggestions: [],
      relationshipSuggestions: [],
      flows: [],
    };

    const result = await heuristicHermesMapper(context);

    expect(result.flowSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'data_flow',
          nodeIds: ['nodes:web', 'nodes:api'],
          confidence: expect.any(Number),
        }),
      ]),
    );
  });
});
