import type { Doc } from '../../../convex/_generated/dataModel';

export type ArchitectureFlowRow = Doc<'architectureFlows'> & {
  isCurated?: boolean;
  nodeNames?: Record<string, string>;
};

export type FlowCluster = {
  key: string;
  title: string;
  subtitle: string;
  flows: ArchitectureFlowRow[];
  nodeCount: number;
  topConfidence: number;
  topTitles: string[];
};

function formatToken(value: string | undefined) {
  return (value ?? 'unknown').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildAncestors(nodes: Doc<'nodes'>[]) {
  const byId = new Map(nodes.map((node) => [node._id as string, node]));
  const ancestors = new Map<string, string[]>();
  for (const node of nodes) {
    const chain: string[] = [];
    const seen = new Set<string>([node._id as string]);
    let current = node.parentId ? byId.get(node.parentId as string) : undefined;
    while (current) {
      const id = current._id as string;
      if (seen.has(id)) break;
      seen.add(id);
      chain.push(id);
      current = current.parentId ? byId.get(current.parentId as string) : undefined;
    }
    ancestors.set(node._id as string, chain);
  }
  return ancestors;
}

function rootSurfaceForFlow(
  flow: ArchitectureFlowRow,
  nodesById: ReadonlyMap<string, Doc<'nodes'>>,
) {
  for (const nodeId of flow.nodeIds) {
    const node = nodesById.get(nodeId as string);
    if (node?.semanticKind === 'surface') return node;
  }
  for (const nodeId of flow.nodeIds) {
    let node = nodesById.get(nodeId as string);
    const seen = new Set<string>();
    while (node?.parentId) {
      const id = node._id as string;
      if (seen.has(id)) break;
      seen.add(id);
      node = nodesById.get(node.parentId as string);
      if (node?.semanticKind === 'surface') return node;
    }
  }
  return null;
}

export function clusterArchitectureFlows(
  flows: ArchitectureFlowRow[],
  nodes: Doc<'nodes'>[],
): FlowCluster[] {
  const nodesById = new Map(nodes.map((node) => [node._id as string, node]));
  const clusters = new Map<string, ArchitectureFlowRow[]>();
  const titles = new Map<string, string>();
  const subtitles = new Map<string, string>();

  for (const flow of flows) {
    const surface = rootSurfaceForFlow(flow, nodesById);
    const key = surface
      ? `surface:${surface._id as string}`
      : flow.productArea
        ? `area:${flow.productArea}:${flow.kind}`
        : `kind:${flow.kind}`;
    const list = clusters.get(key) ?? [];
    list.push(flow);
    clusters.set(key, list);
    if (!titles.has(key)) {
      titles.set(
        key,
        surface?.name ?? `${formatToken(flow.productArea)} ${formatToken(flow.kind)}`,
      );
      subtitles.set(
        key,
        surface ? `${formatToken(surface.productArea)} surface` : `${formatToken(flow.kind)} flows`,
      );
    }
  }

  return Array.from(clusters.entries())
    .map(([key, groupedFlows]) => {
      const nodeIds = new Set<string>();
      for (const flow of groupedFlows) {
        for (const nodeId of flow.nodeIds) nodeIds.add(nodeId as string);
      }
      const topConfidence = Math.max(...groupedFlows.map((flow) => flow.confidence));
      return {
        key,
        title: titles.get(key) ?? 'Architecture flows',
        subtitle: subtitles.get(key) ?? 'Grouped flows',
        flows: groupedFlows,
        nodeCount: nodeIds.size,
        topConfidence,
        topTitles: groupedFlows.slice(0, 2).map((flow) => flow.shortTitle ?? flow.title),
      };
    })
    .sort(
      (a, b) =>
        Math.max(...b.flows.map((flow) => flow.importance ?? 0)) -
          Math.max(...a.flows.map((flow) => flow.importance ?? 0)) ||
        b.topConfidence - a.topConfidence ||
        b.flows.length - a.flows.length,
    );
}

export function getRelatedFlowsForNode(args: {
  nodeId: string;
  nodes: Doc<'nodes'>[];
  flows: ArchitectureFlowRow[];
}) {
  const { nodeId, nodes, flows } = args;
  const ancestors = buildAncestors(nodes);
  const descendants = new Set<string>();
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const node of nodes) {
      if (node.parentId === current) {
        const id = node._id as string;
        if (seen.has(id)) continue;
        descendants.add(id);
        stack.push(id);
      }
    }
  }
  const relevantIds = new Set([nodeId, ...descendants, ...(ancestors.get(nodeId) ?? [])]);

  return flows.filter((flow) => {
    if (flow.nodeIds.some((id) => relevantIds.has(id as string))) return true;
    if (
      flow.steps.some((step) => step.nodeIds?.some((id) => relevantIds.has(id as string)) ?? false)
    ) {
      return true;
    }
    return flow.edgeRefs?.some(
      (ref) =>
        (ref.sourceNodeId && relevantIds.has(ref.sourceNodeId as string)) ||
        (ref.targetNodeId && relevantIds.has(ref.targetNodeId as string)),
    );
  });
}
