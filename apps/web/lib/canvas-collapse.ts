import type { Doc } from '../../../convex/_generated/dataModel';
import type { NodeSummary } from '@/hooks/use-canvas-sync';

export type RenderEdge = Pick<
  Doc<'nodeEdges'>,
  | '_id'
  | 'sourceNodeId'
  | 'targetNodeId'
  | 'type'
  | 'source'
  | 'confidence'
  | 'label'
  | 'sourceRunId'
> & {
  aggregateCount?: number;
};

export type CollapsedNodeStats = {
  directChildCount: number;
  hiddenNodeCount: number;
  hiddenFileCount: number;
  hiddenEdgeCount: number;
  semanticGroupKey?: string;
  memberNodeIds?: string[];
};

export type CollapsedGraph = {
  visibleNodes: Doc<'nodes'>[];
  renderEdges: RenderEdge[];
  collapsedStats: Map<string, CollapsedNodeStats>;
  visibleNodeIdForNodeId: Map<string, string>;
};

function buildChildrenByParent(nodes: Doc<'nodes'>[]) {
  const children = new Map<string, Doc<'nodes'>[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const parentId = node.parentId as string;
    const list = children.get(parentId) ?? [];
    list.push(node);
    children.set(parentId, list);
  }
  return children;
}

function normalizeToken(value: string | undefined, fallback = 'unknown') {
  const token = (value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return token || fallback;
}

function semanticDuplicateKeyForNode(node: Doc<'nodes'>) {
  if (node.semanticKind !== 'ui_module' || node.parentId) return null;
  const area = node.productArea ?? 'unknown';
  const capability = node.capabilityKey
    ? normalizeToken(node.capabilityKey)
    : normalizeToken(node.name);
  return `ui:${area}:top:${capability}`;
}

function semanticGroupId(key: string) {
  return `semantic-group:${key}`;
}

function buildSemanticGroups(nodes: Doc<'nodes'>[]) {
  const groups = new Map<string, Doc<'nodes'>[]>();
  for (const node of nodes) {
    const key = semanticDuplicateKeyForNode(node);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(node);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => ({ key, id: semanticGroupId(key), members }));
}

function collectDescendantIds(
  rootId: string,
  childrenByParent: ReadonlyMap<string, Doc<'nodes'>[]>,
) {
  const out: string[] = [];
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const id = node._id as string;
    out.push(id);
    const children = childrenByParent.get(id);
    if (children) stack.push(...children);
  }
  return out;
}

export function getDefaultCollapsedNodeIds(nodes: Doc<'nodes'>[], threshold = 3) {
  const childrenByParent = buildChildrenByParent(nodes);
  const out: string[] = [];
  for (const [parentId, children] of childrenByParent.entries()) {
    if (children.length > threshold) out.push(parentId);
  }
  for (const group of buildSemanticGroups(nodes)) out.push(group.id);
  return out;
}

export function getCollapsibleNodeIds(nodes: Doc<'nodes'>[]) {
  return [
    ...Array.from(buildChildrenByParent(nodes).keys()),
    ...buildSemanticGroups(nodes).map((group) => group.id),
  ];
}

export function buildCollapsedGraph(args: {
  nodes: Doc<'nodes'>[];
  edges: Doc<'nodeEdges'>[];
  nodeSummaries: NodeSummary[];
  collapsedNodeIds: ReadonlySet<string>;
}): CollapsedGraph {
  const { nodes, edges, nodeSummaries, collapsedNodeIds } = args;
  const byId = new Map(nodes.map((node) => [node._id as string, node]));
  const childrenByParent = buildChildrenByParent(nodes);
  const summaryByNode = new Map(nodeSummaries.map((summary) => [summary.nodeId, summary]));
  const hiddenIds = new Set<string>();
  const visibleNodeIdForNodeId = new Map<string, string>();
  const collapsedStats = new Map<string, CollapsedNodeStats>();
  const syntheticNodes: Doc<'nodes'>[] = [];

  for (const group of buildSemanticGroups(nodes)) {
    if (!collapsedNodeIds.has(group.id)) continue;
    const first = group.members[0];
    if (!first) continue;
    let hiddenFileCount = 0;
    let mappingConfidence = first.mappingConfidence;
    for (const member of group.members) {
      const id = member._id as string;
      hiddenIds.add(id);
      visibleNodeIdForNodeId.set(id, group.id);
      hiddenFileCount += summaryByNode.get(id)?.fileCount ?? 0;
      mappingConfidence = Math.max(mappingConfidence ?? 0, member.mappingConfidence ?? 0);
    }
    const memberNodeIds = group.members.map((member) => member._id as string);
    collapsedStats.set(group.id, {
      directChildCount: group.members.length,
      hiddenNodeCount: group.members.length,
      hiddenFileCount,
      hiddenEdgeCount: 0,
      semanticGroupKey: group.key,
      memberNodeIds,
    });
    syntheticNodes.push({
      ...first,
      _id: group.id as Doc<'nodes'>['_id'],
      name: first.name,
      type: 'page',
      parentId: undefined,
      positionX: first.positionX,
      positionY: first.positionY,
      mappingConfidence,
    });
  }

  for (const collapsedId of collapsedNodeIds) {
    if (!byId.has(collapsedId)) continue;
    const descendants = collectDescendantIds(collapsedId, childrenByParent);
    let hiddenFileCount = 0;
    for (const id of descendants) {
      hiddenIds.add(id);
      visibleNodeIdForNodeId.set(id, collapsedId);
      hiddenFileCount += summaryByNode.get(id)?.fileCount ?? 0;
    }
    collapsedStats.set(collapsedId, {
      directChildCount: childrenByParent.get(collapsedId)?.length ?? 0,
      hiddenNodeCount: descendants.length,
      hiddenFileCount,
      hiddenEdgeCount: 0,
    });
  }

  for (const node of nodes) {
    const id = node._id as string;
    if (!visibleNodeIdForNodeId.has(id)) visibleNodeIdForNodeId.set(id, id);
  }

  const edgeMap = new Map<string, RenderEdge>();
  for (const edge of edges) {
    const sourceId =
      visibleNodeIdForNodeId.get(edge.sourceNodeId as string) ?? (edge.sourceNodeId as string);
    const targetId =
      visibleNodeIdForNodeId.get(edge.targetNodeId as string) ?? (edge.targetNodeId as string);
    const aggregated =
      sourceId !== (edge.sourceNodeId as string) || targetId !== (edge.targetNodeId as string);
    if (sourceId === targetId) {
      if (aggregated) {
        const stats = collapsedStats.get(sourceId);
        if (stats) stats.hiddenEdgeCount++;
      }
      continue;
    }
    const key = `${sourceId}:${targetId}:${edge.type}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.aggregateCount = (existing.aggregateCount ?? 1) + 1;
      continue;
    }
    edgeMap.set(key, {
      ...edge,
      _id: aggregated ? (`aggregate:${key}` as Doc<'nodeEdges'>['_id']) : edge._id,
      sourceNodeId: sourceId as Doc<'nodeEdges'>['sourceNodeId'],
      targetNodeId: targetId as Doc<'nodeEdges'>['targetNodeId'],
      label: aggregated ? `${edge.type.replace(/_/g, ' ')} (${1})` : edge.label,
      aggregateCount: aggregated ? 1 : undefined,
    });
  }

  for (const edge of edgeMap.values()) {
    if (edge.aggregateCount && edge.aggregateCount > 1) {
      edge.label = `${edge.type.replace(/_/g, ' ')} (${edge.aggregateCount})`;
    }
  }

  return {
    visibleNodes: [
      ...nodes.filter((node) => !hiddenIds.has(node._id as string)),
      ...syntheticNodes,
    ],
    renderEdges: Array.from(edgeMap.values()),
    collapsedStats,
    visibleNodeIdForNodeId,
  };
}
