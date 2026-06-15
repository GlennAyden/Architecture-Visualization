import { describe, expect, test } from 'vitest';
import {
  clusterArchitectureFlows,
  getRelatedFlowsForNode,
  type ArchitectureFlowRow,
} from './flow-clusters';
import type { Doc, Id } from '../../../convex/_generated/dataModel';

function node(input: {
  id: string;
  name: string;
  parentId?: Id<'nodes'>;
  semanticKind?: Doc<'nodes'>['semanticKind'];
  productArea?: Doc<'nodes'>['productArea'];
}): Doc<'nodes'> {
  return {
    _id: input.id as Id<'nodes'>,
    _creationTime: 1,
    projectId: 'project' as Id<'projects'>,
    type: input.parentId ? 'feature' : 'page',
    name: input.name,
    description: '',
    positionX: 0,
    positionY: 0,
    parentId: input.parentId,
    semanticKind: input.semanticKind,
    productArea: input.productArea,
    createdAt: 1,
    updatedAt: 1,
  } as Doc<'nodes'>;
}

function flow(input: {
  id: string;
  title: string;
  nodeIds: string[];
  productArea?: Doc<'architectureFlows'>['productArea'];
  kind?: Doc<'architectureFlows'>['kind'];
}): ArchitectureFlowRow {
  return {
    _id: input.id as Id<'architectureFlows'>,
    _creationTime: 1,
    projectId: 'project' as Id<'projects'>,
    title: input.title,
    shortTitle: input.title,
    description: input.title,
    kind: input.kind ?? 'user_journey',
    nodeIds: input.nodeIds as Id<'nodes'>[],
    steps: [{ title: 'Step', description: 'Step', nodeIds: input.nodeIds as Id<'nodes'>[] }],
    confidence: 0.91,
    reason: 'test',
    source: 'test',
    status: 'applied',
    productArea: input.productArea,
    updatedAt: 1,
  } as ArchitectureFlowRow;
}

describe('flow cluster helpers', () => {
  test('groups flows by root surface before falling back to area and kind', () => {
    const nodes = [
      node({
        id: 'dashboard',
        name: 'User Dashboard',
        semanticKind: 'surface',
        productArea: 'user',
      }),
      node({ id: 'billing', name: 'Billing CTA', parentId: 'dashboard' as Id<'nodes'> }),
    ];
    const clusters = clusterArchitectureFlows(
      [
        flow({ id: 'a', title: 'Dashboard Billing', nodeIds: ['dashboard', 'billing'] }),
        flow({
          id: 'b',
          title: 'Loose Agent Flow',
          nodeIds: ['missing'],
          productArea: 'internal',
          kind: 'agent_workflow',
        }),
      ],
      nodes,
    );

    expect(clusters.map((cluster) => cluster.key)).toEqual([
      'surface:dashboard',
      'area:internal:agent_workflow',
    ]);
    expect(clusters[0]!.title).toBe('User Dashboard');
  });

  test('finds related flows through descendants and ancestors', () => {
    const nodes = [
      node({ id: 'dashboard', name: 'User Dashboard', semanticKind: 'surface' }),
      node({ id: 'billing', name: 'Billing CTA', parentId: 'dashboard' as Id<'nodes'> }),
    ];
    const flows = [flow({ id: 'a', title: 'Dashboard Billing', nodeIds: ['billing'] })];

    expect(getRelatedFlowsForNode({ nodeId: 'dashboard', nodes, flows })).toHaveLength(1);
    expect(getRelatedFlowsForNode({ nodeId: 'billing', nodes, flows })).toHaveLength(1);
  });

  test('handles self-parented nodes without looping forever', () => {
    const nodes = [
      node({
        id: 'plan-catalog',
        name: 'Plan Catalog',
        parentId: 'plan-catalog' as Id<'nodes'>,
        semanticKind: 'ui_module',
      }),
    ];
    const flows = [flow({ id: 'a', title: 'Plan Catalog Flow', nodeIds: ['plan-catalog'] })];

    expect(clusterArchitectureFlows(flows, nodes)).toHaveLength(1);
    expect(getRelatedFlowsForNode({ nodeId: 'plan-catalog', nodes, flows })).toHaveLength(1);
  });
});
