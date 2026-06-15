// @vitest-environment node

import { describe, expect, test } from 'vitest';

import { heuristicHermesMapper, type HermesMappingContext } from './hermes-mapper.js';

describe('heuristicHermesMapper architecture flows', () => {
  test('suggests product UI modules and capabilities from dashboard scan facts', async () => {
    const context: HermesMappingContext = {
      runId: 'runs:product',
      project: { _id: 'projects:expandly', name: 'Expandly' },
      layers: [
        { _id: 'layers:surfaces', name: 'Surfaces', position: 0 },
        { _id: 'layers:ui', name: 'UI Modules', position: 1 },
        { _id: 'layers:capabilities', name: 'Product Capabilities', position: 2 },
      ],
      nodes: [
        {
          _id: 'nodes:dashboard',
          name: 'User Dashboard',
          type: 'page',
          layerId: 'layers:surfaces',
          semanticKind: 'surface',
          productArea: 'user',
          routeHint: '/dashboard',
          files: ['src/app/dashboard/page.tsx'],
        },
      ],
      edges: [],
      latestScan: {
        data: {
          orphans: [],
          fileFacts: [
            {
              path: 'src/app/dashboard/page.tsx',
              kind: 'component',
              routeHint: '/dashboard',
              productArea: 'user',
              capabilityHints: ['onboarding', 'billing_subscription', 'notifications'],
              textHints: ['Welcome back', 'Redeem code', 'Notifications'],
              uiBlocks: [
                {
                  key: 'header_controls',
                  name: 'Header Controls',
                  kind: 'header',
                  labels: ['Notifications', 'Profile account'],
                  evidence: ['notification/language/profile controls detected'],
                  routeHint: '/dashboard',
                },
                {
                  key: 'onboarding',
                  name: 'Onboarding',
                  kind: 'panel',
                  labels: ['Welcome back'],
                  evidence: ['Onboarding keywords detected'],
                  routeHint: '/dashboard',
                },
                {
                  key: 'billing_subscription',
                  name: 'Billing & Subscription',
                  kind: 'cta',
                  labels: ['Redeem code'],
                  evidence: ['Billing & Subscription keywords detected'],
                  routeHint: '/dashboard',
                },
              ],
            },
          ],
        },
      },
      suggestions: [],
      relationshipSuggestions: [],
      flows: [],
    };

    const result = await heuristicHermesMapper(context);
    const semantic = result.semanticNodeSuggestions ?? [];

    expect(semantic).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          semanticKey: 'ui:/dashboard:header_controls',
          semanticKind: 'ui_module',
          suggestedNodeName: 'Header Controls',
          layerId: 'layers:ui',
          parentNodeId: 'nodes:dashboard',
          productArea: 'user',
        }),
        expect.objectContaining({
          semanticKey: 'ui:/dashboard:onboarding',
          semanticKind: 'ui_module',
          capabilityKey: 'onboarding',
          parentNodeId: 'nodes:dashboard',
          confidence: 0.9,
        }),
        expect.objectContaining({
          semanticKey: 'capability:onboarding:src/app/dashboard/page.tsx',
          semanticKind: 'capability',
          suggestedNodeName: 'Onboarding',
          layerId: 'layers:capabilities',
        }),
      ]),
    );
    expect(semantic.every((row) => row.reason.includes('chain-of-thought'))).toBe(false);
  });

  test('suggests semantic contains and uses edges for existing product nodes', async () => {
    const context: HermesMappingContext = {
      runId: 'runs:semantic-edges',
      project: { _id: 'projects:expandly', name: 'Expandly' },
      layers: [
        { _id: 'layers:surfaces', name: 'Surfaces', position: 0 },
        { _id: 'layers:ui', name: 'UI Modules', position: 1 },
        { _id: 'layers:capabilities', name: 'Product Capabilities', position: 2 },
      ],
      nodes: [
        {
          _id: 'nodes:dashboard',
          name: 'User Dashboard',
          type: 'page',
          layerId: 'layers:surfaces',
          semanticKind: 'surface',
          productArea: 'user',
          files: ['src/app/dashboard/page.tsx'],
        },
        {
          _id: 'nodes:onboarding-panel',
          name: 'Onboarding Panel',
          type: 'page',
          layerId: 'layers:ui',
          parentId: 'nodes:dashboard',
          semanticKind: 'ui_module',
          productArea: 'user',
          capabilityKey: 'onboarding',
          files: ['src/app/dashboard/page.tsx'],
        },
        {
          _id: 'nodes:onboarding',
          name: 'Onboarding',
          type: 'page',
          layerId: 'layers:capabilities',
          semanticKind: 'capability',
          productArea: 'user',
          capabilityKey: 'onboarding',
          files: ['src/app/dashboard/page.tsx'],
        },
      ],
      edges: [],
      latestScan: { data: { orphans: [] } },
      suggestions: [],
      relationshipSuggestions: [],
      flows: [],
    };

    const result = await heuristicHermesMapper(context);

    expect(result.relationshipSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: 'nodes:dashboard',
          targetNodeId: 'nodes:onboarding-panel',
          type: 'contains',
        }),
        expect.objectContaining({
          sourceNodeId: 'nodes:onboarding-panel',
          targetNodeId: 'nodes:onboarding',
          type: 'uses',
        }),
      ]),
    );
  });

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
