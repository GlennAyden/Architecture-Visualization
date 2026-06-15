'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from 'convex/react';
import {
  Bot,
  CheckCircle2,
  FileCode2,
  Gauge,
  GitBranch,
  Layers3,
  ListChecks,
  Network,
  Plus,
  X,
  type LucideIcon,
} from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { computeLayerUsage, sortLayers } from '@/lib/architecture-layers';
import type { CanvasEdgeMode } from '@/lib/canvas-edge-presentation';
import {
  clusterArchitectureFlows,
  type ArchitectureFlowRow,
  type FlowCluster,
} from '@/lib/flow-clusters';
import { useCanvasViewStore } from '@/store/canvas-view-store';
import { HermesInboxPanel } from './hermes-inbox-panel';

const EDGE_MODES: Array<{ id: CanvasEdgeMode; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'api', label: 'API' },
  { id: 'data', label: 'Data' },
  { id: 'agents', label: 'Agents' },
  { id: 'dependencies', label: 'Deps' },
  { id: 'all', label: 'All' },
];

const FLOW_KIND_LABELS: Record<Doc<'architectureFlows'>['kind'], string> = {
  user_journey: 'User journey',
  system_process: 'System process',
  data_flow: 'Data flow',
  agent_workflow: 'Agent workflow',
  build_deploy: 'Build/deploy',
  integration: 'Integration',
};

type SidebarTab = 'overview' | 'layers' | 'hermes' | 'inspector' | 'flows';
type FlowView = 'featured' | 'all';
type ProductAreaFilter = 'all' | 'public' | 'user' | 'admin' | 'extension' | 'internal';

const TABS: Array<{ id: SidebarTab; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'layers', label: 'Layers', icon: Layers3 },
  { id: 'hermes', label: 'Hermes', icon: Bot },
  { id: 'inspector', label: 'Inspector', icon: ListChecks },
  { id: 'flows', label: 'Flows', icon: GitBranch },
];

const EMPTY_FLOW_CLUSTER_KEYS: string[] = [];

interface Props {
  projectId: Id<'projects'>;
  layers: Doc<'projectLayers'>[] | undefined;
  nodes: Doc<'nodes'>[] | undefined;
  edges: Doc<'nodeEdges'>[] | undefined;
  nodeSummaries:
    | Array<{
        nodeId: string;
        fileCount: number;
        verifiedCount: number;
        roles: Record<string, number>;
      }>
    | undefined;
  inspectedNodeId: Id<'nodes'> | null;
  onInspectedNodeChange: (nodeId: Id<'nodes'> | null) => void;
  health: {
    totalFiles: number;
    mappedFiles: number;
    orphanFiles: number;
    pendingSuggestions: number;
    driftCount: number;
    lastScanAt: number | null;
  };
  flows: ArchitectureFlowRow[] | undefined;
  selectedFlowId: Id<'architectureFlows'> | null;
  onSelectedFlowChange: (flow: Id<'architectureFlows'> | null) => void;
  edgeMode: CanvasEdgeMode;
  onEdgeModeChange: (mode: CanvasEdgeMode) => void;
  selectedNodeName: string | null;
  relatedFlows: ArchitectureFlowRow[];
  nodeCount: number;
  edgeCount: number;
}

export function FlowSidebar({
  projectId,
  layers,
  nodes,
  edges,
  nodeSummaries,
  inspectedNodeId,
  onInspectedNodeChange,
  health,
  flows,
  selectedFlowId,
  onSelectedFlowChange,
  edgeMode,
  onEdgeModeChange,
  selectedNodeName,
  relatedFlows,
  nodeCount,
  edgeCount,
}: Props) {
  const createLayer = useMutation(api.projectLayers.create);
  const markVerified = useMutation(api.nodes.markVerified);
  const inspectedFiles = useQuery(
    api.nodeFiles.listByNode,
    inspectedNodeId ? { nodeId: inspectedNodeId } : 'skip',
  );
  const [newLayerName, setNewLayerName] = useState('');
  const [layerError, setLayerError] = useState<string | null>(null);
  const [creatingLayer, setCreatingLayer] = useState(false);
  const [activeTab, setActiveTab] = useState<SidebarTab>('overview');
  const [flowView, setFlowView] = useState<FlowView>('featured');
  const [productAreaFilter, setProductAreaFilter] = useState<ProductAreaFilter>('all');
  const [verifying, setVerifying] = useState(false);
  const expandedFlowClusterKeys = useCanvasViewStore(
    (s) => s.projects[projectId as string]?.expandedFlowClusterKeys ?? EMPTY_FLOW_CLUSTER_KEYS,
  );
  const setFlowClusterExpanded = useCanvasViewStore((s) => s.setFlowClusterExpanded);
  const expandAllFlowClusters = useCanvasViewStore((s) => s.expandAllFlowClusters);
  const collapseAllFlowClusters = useCanvasViewStore((s) => s.collapseAllFlowClusters);
  const sortedLayers = sortLayers(layers);
  const layerUsage = useMemo(() => computeLayerUsage(layers, nodes), [layers, nodes]);
  const emptySemanticLayers = useMemo(
    () =>
      sortedLayers.filter((layer) => {
        const usage = layerUsage.get(layer._id);
        return isProductSemanticLayer(layer) && (usage?.isEmpty ?? true);
      }),
    [layerUsage, sortedLayers],
  );
  const displayedFlows = useMemo(() => {
    const all = flows ?? [];
    const byView = flowView === 'featured' ? all.filter((flow) => flow.isCurated !== false) : all;
    if (productAreaFilter === 'all') return byView;
    return byView.filter((flow) => flow.productArea === productAreaFilter);
  }, [flowView, flows, productAreaFilter]);
  const flowClusters = useMemo(
    () => clusterArchitectureFlows(displayedFlows, nodes ?? []),
    [displayedFlows, nodes],
  );
  const expandedFlowClusterKeySet = useMemo(
    () => new Set(expandedFlowClusterKeys),
    [expandedFlowClusterKeys],
  );
  const selectedFlow = useMemo(
    () => flows?.find((flow) => flow._id === selectedFlowId) ?? null,
    [flows, selectedFlowId],
  );
  const inspectedNode = useMemo(
    () => (inspectedNodeId && nodes ? nodes.find((node) => node._id === inspectedNodeId) : null),
    [inspectedNodeId, nodes],
  );
  const nodeNameById = useMemo(() => {
    return new Map((nodes ?? []).map((node) => [node._id as string, node.name]));
  }, [nodes]);
  const inspectedEdges = useMemo(() => {
    if (!inspectedNodeId || !edges) return [];
    return edges.filter(
      (edge) => edge.sourceNodeId === inspectedNodeId || edge.targetNodeId === inspectedNodeId,
    );
  }, [edges, inspectedNodeId]);
  const inspectedSummary = useMemo(() => {
    if (!inspectedNodeId) return null;
    return nodeSummaries?.find((summary) => summary.nodeId === inspectedNodeId) ?? null;
  }, [inspectedNodeId, nodeSummaries]);

  useEffect(() => {
    if (inspectedNodeId) setActiveTab('inspector');
  }, [inspectedNodeId]);

  const handleCreateLayer = async () => {
    const name = newLayerName.trim();
    if (!name) {
      setLayerError('Layer name is required');
      return;
    }
    setCreatingLayer(true);
    setLayerError(null);
    try {
      await createLayer({ projectId, name });
      setNewLayerName('');
    } catch (err) {
      setLayerError(err instanceof Error ? err.message : 'Could not create layer');
    } finally {
      setCreatingLayer(false);
    }
  };

  const handleMarkVerified = async () => {
    if (!inspectedNodeId) return;
    setVerifying(true);
    try {
      await markVerified({ id: inspectedNodeId });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <aside className="flex min-h-0 w-[380px] shrink-0 flex-col gap-3 pr-1 max-xl:w-[340px] max-lg:h-[380px] max-lg:w-full">
      <div className="grid grid-cols-5 gap-1 rounded-lg border border-white/10 bg-zinc-950/80 p-1 shadow-2xl shadow-black/30">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex h-9 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-100',
                activeTab === tab.id && 'bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-400/30',
              )}
              title={tab.label}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>

      <section className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/10 bg-zinc-950/80 p-3 shadow-2xl shadow-black/30">
        {activeTab === 'overview' && (
          <div className="space-y-3">
            <PanelTitle icon={Gauge} title="Overview" />
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Total files" value={health.totalFiles} />
              <Metric label="Mapped" value={health.mappedFiles} tone="emerald" />
              <Metric label="Orphans" value={health.orphanFiles} tone="amber" />
              <Metric label="Pending" value={health.pendingSuggestions} tone="cyan" />
              <Metric label="Drift" value={health.driftCount} tone="rose" />
              <Metric label="Nodes" value={nodeCount} />
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Last scan</p>
              <p className="mt-1 text-sm text-zinc-100">
                {health.lastScanAt ? formatRelativeTime(health.lastScanAt) : 'No scan yet'}
              </p>
            </div>
            <div className="rounded-md border border-violet-400/30 bg-violet-400/10 p-3">
              <p className="truncate text-sm font-semibold text-zinc-100">
                Selected: {selectedNodeName ?? selectedFlow?.title ?? 'None'}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {nodeCount} nodes / {edgeCount} relationships
              </p>
            </div>
          </div>
        )}

        {activeTab === 'layers' && (
          <div className="space-y-3">
            <PanelTitle icon={Layers3} title="Layers" />
            <div className="space-y-1.5">
              {sortedLayers.map((layer, index) => {
                const usage = layerUsage.get(layer._id);
                const nodeCount = usage?.nodeCount ?? 0;
                const needsSemanticScan = isProductSemanticLayer(layer) && nodeCount === 0;
                return (
                  <div
                    key={layer._id}
                    className={cn(
                      'rounded-md border px-2 py-2',
                      needsSemanticScan
                        ? 'border-amber-400/20 bg-amber-400/[0.04]'
                        : 'border-white/10 bg-white/[0.03]',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-cyan-400/15 text-[10px] font-semibold text-cyan-200">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                        {layer.name}
                      </span>
                      <span className="shrink-0 rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[10px] text-zinc-400">
                        {nodeCount} nodes
                      </span>
                    </div>
                    {layer.description && (
                      <p className="mt-1 line-clamp-2 pl-7 text-xs text-zinc-500">
                        {layer.description}
                      </p>
                    )}
                    {needsSemanticScan && (
                      <p className="mt-2 pl-7 text-[11px] font-medium text-amber-200">
                        Needs semantic scan
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {emptySemanticLayers.length > 0 && (
              <div className="rounded-md border border-cyan-400/20 bg-cyan-400/[0.06] p-3 text-xs leading-5 text-cyan-100/80">
                Empty product layers stay compact until semantic scan and Hermes mapping add UI
                modules or capabilities.
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={newLayerName}
                onChange={(event) => setNewLayerName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleCreateLayer();
                }}
                placeholder="New layer"
                disabled={creatingLayer}
                className="h-8 border-white/10 bg-white/[0.03] text-zinc-100 placeholder:text-zinc-600"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleCreateLayer}
                disabled={creatingLayer}
                aria-label="Add layer"
                className="shrink-0 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {layerError && <p className="text-xs text-destructive">{layerError}</p>}
          </div>
        )}

        {activeTab === 'hermes' && <HermesInboxPanel projectId={projectId} />}

        {activeTab === 'inspector' && (
          <div className="space-y-3">
            <PanelTitle icon={ListChecks} title="Inspector" />
            {!inspectedNode ? (
              <div className="flex min-h-64 items-center justify-center rounded-md border border-dashed border-white/10 px-6 text-center">
                <p className="text-sm leading-6 text-zinc-500">
                  Click a node on the canvas to inspect linked files, evidence, and relationships.
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-md border border-cyan-400/25 bg-cyan-400/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-100">
                        {inspectedNode.name}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {formatToken(inspectedNode.semanticKind ?? 'unknown')} /{' '}
                        {formatToken(inspectedNode.mappingStatus ?? 'manual')} /{' '}
                        {formatToken(inspectedNode.productArea ?? 'unknown')}
                      </p>
                      {(inspectedNode.capabilityKey || inspectedNode.routeHint) && (
                        <p className="mt-1 truncate text-[11px] text-cyan-200">
                          {inspectedNode.capabilityKey ?? inspectedNode.routeHint}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={verifying}
                      onClick={() => void handleMarkVerified()}
                      className="h-8 shrink-0 border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Verify
                    </Button>
                  </div>
                  {inspectedNode.description && (
                    <p className="mt-2 text-xs leading-5 text-zinc-400">
                      {inspectedNode.description}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Metric label="Files" value={inspectedSummary?.fileCount ?? 0} />
                  <Metric
                    label="Verified"
                    value={inspectedSummary?.verifiedCount ?? 0}
                    tone="emerald"
                  />
                  <Metric label="Relations" value={inspectedEdges.length} tone="cyan" />
                  <Metric
                    label="Confidence"
                    value={
                      inspectedNode.mappingConfidence !== undefined
                        ? `${Math.round(inspectedNode.mappingConfidence * 100)}%`
                        : '-'
                    }
                  />
                </div>

                <InspectorBlock icon={FileCode2} title="Linked files">
                  {inspectedFiles === undefined ? (
                    <p className="text-sm text-zinc-500">Loading files...</p>
                  ) : inspectedFiles.length === 0 ? (
                    <p className="text-sm text-zinc-500">No files linked yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {inspectedFiles.map((file) => (
                        <div
                          key={file._id}
                          className="rounded border border-white/10 bg-white/[0.03] px-2 py-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-[11px] text-zinc-300">
                              {file.path}
                            </span>
                            <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400">
                              {file.role ?? 'support'}
                            </span>
                          </div>
                          {file.reason && (
                            <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{file.reason}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </InspectorBlock>

                <InspectorBlock icon={Network} title="Relationships">
                  {inspectedEdges.length === 0 ? (
                    <p className="text-sm text-zinc-500">No relationships yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {inspectedEdges.map((edge) => {
                        const outgoing = edge.sourceNodeId === inspectedNode._id;
                        const otherId = outgoing ? edge.targetNodeId : edge.sourceNodeId;
                        return (
                          <div
                            key={edge._id}
                            className="rounded border border-white/10 bg-white/[0.03] px-2 py-1.5"
                          >
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="truncate text-zinc-300">
                                {outgoing ? 'To' : 'From'}{' '}
                                {nodeNameById.get(otherId as string) ?? 'Unknown node'}
                              </span>
                              <span className="shrink-0 text-cyan-200">
                                {formatToken(edge.type)}
                              </span>
                            </div>
                            {(edge.label || edge.reason) && (
                              <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                                {edge.label ?? edge.reason}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </InspectorBlock>

                <InspectorBlock icon={GitBranch} title="Related flows">
                  {relatedFlows.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      No architecture flows touch this node yet.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {relatedFlows.slice(0, 8).map((flow) => (
                        <button
                          key={flow._id}
                          type="button"
                          onClick={() => {
                            onSelectedFlowChange(flow._id);
                            setActiveTab('flows');
                          }}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left',
                            selectedFlowId === flow._id
                              ? 'border-amber-400/60 bg-amber-400/10'
                              : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-zinc-200">
                              {flow.shortTitle ?? flow.title}
                            </span>
                            <span className="block truncate text-[11px] text-zinc-500">
                              {FLOW_KIND_LABELS[flow.kind]} / {flow.nodeIds.length} nodes
                            </span>
                          </span>
                          <span className="shrink-0 text-[11px] text-amber-300">
                            {Math.round(flow.confidence * 100)}%
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </InspectorBlock>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onInspectedNodeChange(null)}
                  className="w-full border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07]"
                >
                  <X className="h-4 w-4" />
                  Clear inspector
                </Button>
              </>
            )}
          </div>
        )}

        {activeTab === 'flows' && (
          <div className="space-y-3">
            <PanelTitle icon={GitBranch} title="Flows" />
            <div className="grid grid-cols-3 gap-1 rounded-md border border-white/10 bg-white/[0.03] p-1">
              {EDGE_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => onEdgeModeChange(mode.id)}
                  className={cn(
                    'h-8 rounded text-xs text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-100',
                    edgeMode === mode.id && 'bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-400/30',
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            {flows === undefined ? (
              <p className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm text-zinc-500">
                Loading architecture flows...
              </p>
            ) : flows.length > 0 ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.13em] text-zinc-500">
                    {flowView === 'featured' ? 'Featured flows' : 'All flows'}
                  </p>
                  <div className="grid grid-cols-2 overflow-hidden rounded-md border border-white/10 bg-white/[0.03] p-0.5">
                    {(['featured', 'all'] as const).map((view) => (
                      <button
                        key={view}
                        type="button"
                        onClick={() => setFlowView(view)}
                        className={cn(
                          'h-7 px-3 text-xs text-zinc-500 transition-colors hover:text-zinc-100',
                          flowView === view &&
                            'rounded bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-400/25',
                        )}
                      >
                        {view === 'featured' ? 'Featured' : 'All'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1 rounded-md border border-white/10 bg-white/[0.03] p-1">
                  {(['all', 'user', 'admin', 'public', 'extension', 'internal'] as const).map(
                    (area) => (
                      <button
                        key={area}
                        type="button"
                        onClick={() => setProductAreaFilter(area)}
                        className={cn(
                          'h-7 rounded text-[11px] capitalize text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-100',
                          productAreaFilter === area &&
                            'bg-amber-400/10 text-amber-200 ring-1 ring-amber-400/25',
                        )}
                      >
                        {area}
                      </button>
                    ),
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-zinc-500">
                    {flowClusters.length} clusters / {displayedFlows.length} flows
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 border border-white/10 bg-white/[0.03] px-2 text-xs text-zinc-300 hover:bg-white/[0.07]"
                      onClick={() =>
                        expandAllFlowClusters(
                          projectId,
                          flowClusters.map((cluster) => cluster.key),
                        )
                      }
                    >
                      Expand
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 border border-white/10 bg-white/[0.03] px-2 text-xs text-zinc-300 hover:bg-white/[0.07]"
                      onClick={() => collapseAllFlowClusters(projectId)}
                    >
                      Collapse
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {flowClusters.length > 0 ? (
                    flowClusters.map((cluster) => (
                      <FlowClusterCard
                        key={cluster.key}
                        cluster={cluster}
                        expanded={expandedFlowClusterKeySet.has(cluster.key)}
                        selectedFlowId={selectedFlowId}
                        onToggle={() =>
                          setFlowClusterExpanded(
                            projectId,
                            cluster.key,
                            !expandedFlowClusterKeySet.has(cluster.key),
                          )
                        }
                        onSelectedFlowChange={onSelectedFlowChange}
                      />
                    ))
                  ) : (
                    <div className="p-3 text-sm leading-6 text-zinc-500">
                      No featured flows yet. Switch to All to review legacy edge-level flows.
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSelectedFlowChange(null)}
                  disabled={!selectedFlow}
                  className="border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] disabled:opacity-40"
                >
                  <X className="h-4 w-4" />
                  Clear flow
                </Button>
              </>
            ) : (
              <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-white/10 px-6 text-center">
                <p className="text-sm leading-6 text-zinc-500">
                  No architecture flows yet. Ask Hermes from the Inbox to suggest semantic flows.
                </p>
              </div>
            )}
            {selectedFlow && (
              <div className="space-y-3">
                <div className="rounded-md border border-amber-400/25 bg-amber-400/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-100">
                        {selectedFlow.shortTitle ?? selectedFlow.title}
                      </p>
                      <p className="mt-1 text-xs text-amber-200">
                        {FLOW_KIND_LABELS[selectedFlow.kind]} / {selectedFlow.steps.length} steps /{' '}
                        {Math.round(selectedFlow.confidence * 100)}%
                        {selectedFlow.productArea
                          ? ` / ${formatToken(selectedFlow.productArea)}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  {selectedFlow.goal && (
                    <p className="mt-2 rounded border border-white/10 bg-black/20 p-2 text-xs leading-5 text-amber-100/90">
                      {selectedFlow.goal}
                    </p>
                  )}
                  <p className="mt-2 text-xs leading-5 text-zinc-400">{selectedFlow.description}</p>
                  <p className="mt-2 line-clamp-3 text-xs text-zinc-500">{selectedFlow.reason}</p>
                </div>
                <ol className="space-y-2">
                  {selectedFlow.steps.map((step, index) => (
                    <li
                      key={`${step.title}-${index}`}
                      className="grid grid-cols-[28px_1fr] gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3"
                    >
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-zinc-950 shadow-[0_0_18px_rgba(251,191,36,0.45)]">
                        {index + 1}
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-zinc-100">
                          {step.title}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-zinc-500">
                          {step.description}
                        </span>
                        {step.nodeIds && step.nodeIds.length > 0 && (
                          <span className="mt-1 block truncate text-[11px] text-cyan-300">
                            {selectedFlow.nodeNames?.[step.nodeIds[0] as string] ?? 'Mapped node'}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
                {selectedFlow.evidence && selectedFlow.evidence.length > 0 && (
                  <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-zinc-500">
                      Evidence
                    </p>
                    <div className="space-y-1">
                      {selectedFlow.evidence.slice(0, 5).map((item) => (
                        <p key={item} className="truncate text-xs text-zinc-400">
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </aside>
  );
}

function PanelTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">{title}</h2>
      <Icon className="h-4 w-4 text-cyan-300" />
    </div>
  );
}

function FlowClusterCard({
  cluster,
  expanded,
  selectedFlowId,
  onToggle,
  onSelectedFlowChange,
}: {
  cluster: FlowCluster;
  expanded: boolean;
  selectedFlowId: Id<'architectureFlows'> | null;
  onToggle: () => void;
  onSelectedFlowChange: (flow: Id<'architectureFlows'> | null) => void;
}) {
  const selectedInside = cluster.flows.some((flow) => flow._id === selectedFlowId);
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border',
        selectedInside
          ? 'border-amber-400/60 bg-amber-400/[0.06]'
          : 'border-white/10 bg-white/[0.03]',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-white/[0.04]"
      >
        <span
          className={cn(
            'mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/15 text-zinc-400',
            selectedInside && 'border-amber-400/70 text-amber-300',
          )}
        >
          <GitBranch className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-100">{cluster.title}</span>
            <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-500">
              {cluster.flows.length} flows
            </span>
          </span>
          <span className="mt-1 block truncate text-xs text-zinc-500">
            {cluster.subtitle} / {cluster.nodeCount} nodes /{' '}
            {Math.round(cluster.topConfidence * 100)}%
          </span>
          <span className="mt-1 block truncate text-[11px] text-zinc-600">
            {cluster.topTitles.join(' / ')}
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-cyan-200">
          {expanded ? 'Collapse' : 'Expand'}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-white/10">
          {cluster.flows.map((flow) => {
            const selected = selectedFlowId === flow._id;
            return (
              <button
                key={flow._id}
                type="button"
                onClick={() => onSelectedFlowChange(flow._id)}
                className={cn(
                  'flex w-full items-start gap-2 border-b border-white/10 px-3 py-2 text-left last:border-b-0',
                  'transition-colors hover:bg-white/[0.04]',
                  selected && 'bg-amber-400/10 text-amber-200',
                )}
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-medium text-zinc-100">
                      {flow.shortTitle ?? flow.title}
                    </span>
                    {flow.isCurated === false && (
                      <span className="shrink-0 rounded border border-white/10 px-1 py-0.5 text-[9px] uppercase tracking-[0.08em] text-zinc-500">
                        legacy
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-zinc-500">
                    {FLOW_KIND_LABELS[flow.kind]} / {flow.steps.length} steps /{' '}
                    {flow.nodeIds.length} nodes / {Math.round(flow.confidence * 100)}%
                    {flow.productArea ? ` / ${formatToken(flow.productArea)}` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'zinc',
}: {
  label: string;
  value: number | string;
  tone?: 'zinc' | 'emerald' | 'amber' | 'cyan' | 'rose';
}) {
  const toneClass = {
    zinc: 'text-zinc-100',
    emerald: 'text-emerald-300',
    amber: 'text-amber-300',
    cyan: 'text-cyan-300',
    rose: 'text-rose-300',
  }[tone];
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[11px] uppercase tracking-[0.13em] text-zinc-500">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold tabular-nums', toneClass)}>{value}</p>
    </div>
  );
}

function InspectorBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-zinc-500">
        <Icon className="h-3.5 w-3.5 text-cyan-300" />
        {title}
      </div>
      {children}
    </div>
  );
}

function formatToken(value: string) {
  return value.replace(/_/g, ' ');
}

function isProductSemanticLayer(layer: { name: string; purpose?: string }) {
  return (
    layer.purpose === 'ui_modules' ||
    layer.purpose === 'capabilities' ||
    ['ui modules', 'product capabilities'].includes(layer.name.toLowerCase())
  );
}

function formatRelativeTime(time: number) {
  const diffMs = Date.now() - time;
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (diffMs < minute) return 'just now';
  if (diffMs < hour) return `${Math.round(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.round(diffMs / hour)}h ago`;
  return `${Math.round(diffMs / day)}d ago`;
}
