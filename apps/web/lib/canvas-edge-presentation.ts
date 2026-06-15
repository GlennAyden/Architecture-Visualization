import type { Doc } from '../../../convex/_generated/dataModel';
import type { RenderEdge } from './canvas-collapse';

export type CanvasEdgeMode = 'overview' | 'api' | 'data' | 'agents' | 'dependencies' | 'all';

export type CanvasFlowSelection = Pick<
  Doc<'architectureFlows'>,
  '_id' | 'nodeIds' | 'edgeRefs' | 'kind'
>;

type EdgeRef = NonNullable<Doc<'architectureFlows'>['edgeRefs']>[number];

type Presentation = {
  edges: RenderEdge[];
  highlightedEdgeIds?: Set<string>;
  highlightedNodeIds?: Set<string>;
  hasFocus: boolean;
};

function edgeMatchesRef(edge: RenderEdge, ref: EdgeRef) {
  if (ref.edgeId && edge._id === ref.edgeId) return true;
  return (
    edge.sourceNodeId === ref.sourceNodeId &&
    edge.targetNodeId === ref.targetNodeId &&
    (!ref.type || edge.type === ref.type)
  );
}

function isOverviewEdge(edge: RenderEdge) {
  if (edge.type === 'hierarchy' || edge.type === 'dependency') return false;
  if (['contains', 'uses', 'triggers', 'integrates'].includes(edge.type)) return true;
  if (edge.source === 'manual') return true;
  return (edge.confidence ?? 0) >= 0.9;
}

function edgeMatchesMode(edge: RenderEdge, mode: CanvasEdgeMode) {
  if (mode === 'all') return true;
  if (mode === 'overview') return isOverviewEdge(edge);
  if (mode === 'dependencies') return edge.type === 'dependency';
  if (mode === 'api') {
    return ['navigation', 'data_flow', 'uses', 'triggers', 'reads', 'writes'].includes(edge.type);
  }
  if (mode === 'data') return ['data_flow', 'reads', 'writes'].includes(edge.type);
  return (
    ['data_flow', 'uses', 'triggers', 'integrates'].includes(edge.type) ||
    Boolean(edge.sourceRunId) ||
    /agent|hermes|mcp/i.test(edge.label ?? '')
  );
}

export function getCanvasEdgePresentation(
  edges: RenderEdge[],
  mode: CanvasEdgeMode,
  selectedFlow?: CanvasFlowSelection | null,
): Presentation {
  if (selectedFlow) {
    const nodeIds = new Set(selectedFlow.nodeIds.map((id) => id as string));
    const matchedEdges = edges.filter((edge) =>
      (selectedFlow.edgeRefs ?? []).some((ref) => edgeMatchesRef(edge, ref)),
    );
    const fallbackEdges =
      matchedEdges.length > 0
        ? matchedEdges
        : edges.filter(
            (edge) =>
              nodeIds.has(edge.sourceNodeId as string) && nodeIds.has(edge.targetNodeId as string),
          );
    const highlightedEdgeIds = new Set(fallbackEdges.map((edge) => edge._id as string));
    const highlightedNodeIds = new Set(nodeIds);
    for (const edge of fallbackEdges) {
      highlightedNodeIds.add(edge.sourceNodeId as string);
      highlightedNodeIds.add(edge.targetNodeId as string);
    }
    return {
      edges: fallbackEdges,
      highlightedEdgeIds,
      highlightedNodeIds,
      hasFocus: true,
    };
  }

  return {
    edges: edges.filter((edge) => edgeMatchesMode(edge, mode)),
    hasFocus: false,
  };
}
