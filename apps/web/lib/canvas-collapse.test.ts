import { describe, expect, test } from 'vitest';
import { buildCollapsedGraph, getDefaultCollapsedNodeIds } from './canvas-collapse';
import type { Doc, Id } from '../../../convex/_generated/dataModel';

function node(input: Partial<Doc<'nodes'>> & { id: string; name?: string }): Doc<'nodes'> {
  return {
    _id: input.id as Id<'nodes'>,
    _creationTime: 1,
    projectId: 'project' as Id<'projects'>,
    type: input.type ?? 'page',
    name: input.name ?? input.id,
    description: '',
    positionX: 0,
    positionY: 0,
    parentId: input.parentId,
    layerId: input.layerId,
    semanticKind: input.semanticKind,
    productArea: input.productArea,
    mappingStatus: input.mappingStatus,
    mappingConfidence: input.mappingConfidence,
    capabilityKey: input.capabilityKey,
    routeHint: input.routeHint,
    createdAt: 1,
    updatedAt: 1,
  } as Doc<'nodes'>;
}

function edge(input: {
  id: string;
  source: string;
  target: string;
  type?: Doc<'nodeEdges'>['type'];
}): Doc<'nodeEdges'> {
  return {
    _id: input.id as Id<'nodeEdges'>,
    _creationTime: 1,
    projectId: 'project' as Id<'projects'>,
    sourceNodeId: input.source as Id<'nodes'>,
    targetNodeId: input.target as Id<'nodes'>,
    type: input.type ?? 'uses',
    confidence: 1,
    reason: 'test',
    source: 'auto',
    updatedAt: 1,
  } as unknown as Doc<'nodeEdges'>;
}

describe('canvas collapse helpers', () => {
  test('defaults parent clusters with more than three direct children to collapsed', () => {
    const nodes = [
      node({ id: 'parent' }),
      node({ id: 'a', parentId: 'parent' as Id<'nodes'> }),
      node({ id: 'b', parentId: 'parent' as Id<'nodes'> }),
      node({ id: 'c', parentId: 'parent' as Id<'nodes'> }),
      node({ id: 'd', parentId: 'parent' as Id<'nodes'> }),
    ];

    expect(getDefaultCollapsedNodeIds(nodes)).toEqual(['parent']);
  });

  test('hides descendants visually while preserving aggregate edges to the collapsed parent', () => {
    const nodes = [
      node({ id: 'parent' }),
      node({ id: 'child', parentId: 'parent' as Id<'nodes'> }),
      node({ id: 'external' }),
    ];
    const graph = buildCollapsedGraph({
      nodes,
      edges: [edge({ id: 'edge', source: 'child', target: 'external', type: 'triggers' })],
      nodeSummaries: [{ nodeId: 'child', fileCount: 2, verifiedCount: 0, roles: {} }],
      collapsedNodeIds: new Set(['parent']),
    });

    expect(graph.visibleNodes.map((item) => item._id as string)).toEqual(['parent', 'external']);
    expect(graph.renderEdges).toHaveLength(1);
    expect(graph.renderEdges[0]).toMatchObject({
      sourceNodeId: 'parent',
      targetNodeId: 'external',
      type: 'triggers',
      aggregateCount: 1,
    });
    expect(graph.collapsedStats.get('parent')).toMatchObject({
      directChildCount: 1,
      hiddenNodeCount: 1,
      hiddenFileCount: 2,
    });
  });

  test('collapses duplicate top-level UI modules into a semantic group', () => {
    const nodes = [
      node({
        id: 'admin-a',
        name: 'Admin Operations',
        semanticKind: 'ui_module',
        productArea: 'admin',
        capabilityKey: 'admin_operations',
      }),
      node({
        id: 'admin-b',
        name: 'Admin Operations',
        semanticKind: 'ui_module',
        productArea: 'admin',
        capabilityKey: 'admin_operations',
      }),
      node({ id: 'api', name: 'API Layer', semanticKind: 'api' }),
    ];
    const defaults = getDefaultCollapsedNodeIds(nodes);
    expect(defaults).toEqual(['semantic-group:ui:admin:admin-operations:admin_operations']);

    const graph = buildCollapsedGraph({
      nodes,
      edges: [edge({ id: 'edge', source: 'admin-b', target: 'api', type: 'uses' })],
      nodeSummaries: [
        { nodeId: 'admin-a', fileCount: 2, verifiedCount: 0, roles: {} },
        { nodeId: 'admin-b', fileCount: 3, verifiedCount: 0, roles: {} },
      ],
      collapsedNodeIds: new Set(defaults),
    });

    expect(graph.visibleNodes.map((item) => item._id as string)).toEqual([
      'api',
      'semantic-group:ui:admin:admin-operations:admin_operations',
    ]);
    expect(
      graph.collapsedStats.get('semantic-group:ui:admin:admin-operations:admin_operations'),
    ).toMatchObject({
      hiddenNodeCount: 2,
      hiddenFileCount: 5,
      memberNodeIds: ['admin-a', 'admin-b'],
    });
    expect(graph.renderEdges[0]).toMatchObject({
      sourceNodeId: 'semantic-group:ui:admin:admin-operations:admin_operations',
      targetNodeId: 'api',
      aggregateCount: 1,
    });
  });

  test('treats self-parented nodes as safe top-level nodes', () => {
    const nodes = [
      node({
        id: 'plan-catalog',
        name: 'Plan Catalog',
        parentId: 'plan-catalog' as Id<'nodes'>,
      }),
      node({ id: 'billing', name: 'Billing' }),
    ];

    expect(getDefaultCollapsedNodeIds(nodes)).toEqual([]);

    const graph = buildCollapsedGraph({
      nodes,
      edges: [edge({ id: 'edge', source: 'plan-catalog', target: 'billing', type: 'uses' })],
      nodeSummaries: [{ nodeId: 'plan-catalog', fileCount: 4, verifiedCount: 0, roles: {} }],
      collapsedNodeIds: new Set(['plan-catalog']),
    });

    expect(graph.visibleNodes.map((item) => item._id as string)).toEqual([
      'plan-catalog',
      'billing',
    ]);
    expect(graph.collapsedStats.get('plan-catalog')).toMatchObject({
      hiddenNodeCount: 0,
      hiddenFileCount: 0,
    });
  });
});
