// @vitest-environment node

import { describe, expect, test } from 'vitest';

import { heuristicHermesMapper, type HermesMappingContext } from './hermes-mapper.js';

describe('heuristicHermesMapper architecture flows', () => {
  test('groups related data edges into one curated semantic flow', async () => {
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
        {
          _id: 'nodes:data',
          name: 'Auth Data',
          type: 'page',
          layerId: 'layers:backend',
          semanticKind: 'storage',
          files: ['convex/auth.ts'],
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
        {
          _id: 'edges:web-data',
          sourceNodeId: 'nodes:web',
          targetNodeId: 'nodes:data',
          type: 'data_flow',
          label: 'session write',
          source: 'manual',
          confidence: 0.94,
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
          shortTitle: 'Web App Journey',
          curationKey: 'user:nodes:web',
          confidence: expect.any(Number),
          importance: expect.any(Number),
        }),
      ]),
    );
  });

  test('does not produce one flow per edge for repeated domain writes', async () => {
    const context: HermesMappingContext = {
      runId: 'runs:domain',
      project: { _id: 'projects:expandly', name: 'Expandly' },
      layers: [
        { _id: 'layers:app', name: 'Application', position: 0 },
        { _id: 'layers:backend', name: 'Backend', position: 1 },
      ],
      nodes: [
        {
          _id: 'nodes:domain',
          name: 'Domain Services',
          type: 'page',
          layerId: 'layers:app',
          semanticKind: 'capability',
          files: ['src/domain/index.ts'],
        },
        ...['Admin Service', 'Payment Service', 'Extension Service', 'Messaging Service'].map(
          (name, index) => ({
            _id: `nodes:target-${index}`,
            name,
            type: 'page',
            layerId: 'layers:backend',
            semanticKind: 'api',
            files: [`src/api/${index}.ts`],
          }),
        ),
      ],
      edges: ['Admin Service', 'Payment Service', 'Extension Service', 'Messaging Service'].map(
        (_name, index) => ({
          _id: `edges:domain-${index}`,
          sourceNodeId: 'nodes:domain',
          targetNodeId: `nodes:target-${index}`,
          type: 'data_flow',
          label: 'domain write',
          source: 'manual',
          confidence: 0.91,
        }),
      ),
      latestScan: { data: { orphans: [] } },
      suggestions: [],
      relationshipSuggestions: [],
      flows: [],
    };

    const result = await heuristicHermesMapper(context);
    const dataFlows = result.flowSuggestions?.filter((flow) => flow.kind === 'data_flow') ?? [];

    expect(dataFlows).toHaveLength(1);
    expect(dataFlows[0]).toMatchObject({
      shortTitle: 'Domain Services Data Path',
      curationKey: 'data:nodes:domain',
    });
    expect(dataFlows[0]!.nodeIds.length).toBeGreaterThan(2);
    expect(dataFlows[0]!.edgeRefs).toHaveLength(4);
    expect(result.flowSuggestions!.length).toBeLessThanOrEqual(8);
    expect(result.flowSuggestions!.every((flow) => flow.title.length <= 120)).toBe(true);
  });
});
