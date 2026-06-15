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

function findCollapsedAncestor(
  node: Doc<'nodes'> | undefined,
  byId: ReadonlyMap<string, Doc<'nodes'>>,
  collapsedIds: ReadonlySet<string>,
) {
  let current = node;
  while (current?.parentId) {
    const parentId = current.parentId as string;
    if (collapsedIds.has(parentId)) return parentId;
    current = byId.get(parentId);
  }
  return node && collapsedIds.has(node._id as string) ? (node._id as string) : null;
}

export function getDefaultCollapsedNodeIds(nodes: Doc<'nodes'>[], threshold = 3) {
  const childrenByParent = buildChildrenByParent(nodes);
  const out: string[] = [];
  for (const [parentId, children] of childrenByParent.entries()) {
    if (children.length > threshold) out.push(parentId);
  }
  return out;
}

export function getCollapsibleNodeIds(nodes: Doc<'nodes'>[]) {
  return Array.from(buildChildrenByParent(nodes).keys());
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
    const sourceNode = byId.get(edge.sourceNodeId as string);
    const targetNode = byId.get(edge.targetNodeId as string);
    const sourceCollapsed = findCollapsedAncestor(sourceNode, byId, collapsedNodeIds);
    const targetCollapsed = findCollapsedAncestor(targetNode, byId, collapsedNodeIds);
    const sourceId = sourceCollapsed ?? (edge.sourceNodeId as string);
    const targetId = targetCollapsed ?? (edge.targetNodeId as string);
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
    visibleNodes: nodes.filter((node) => !hiddenIds.has(node._id as string)),
    renderEdges: Array.from(edgeMap.values()),
    collapsedStats,
    visibleNodeIdForNodeId,
  };
}
