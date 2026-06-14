'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from 'convex/react';
import {
  Bot,
  CheckCircle2,
  Code2,
  FileCode2,
  Gauge,
  GitBranch,
  Layers3,
  ListChecks,
  Network,
  Plus,
  PlusSquare,
  Share2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { sortLayers } from '@/lib/architecture-layers';
import { HermesInboxPanel } from './hermes-inbox-panel';

export type ArchitectureFlowId =
  | 'agent-updates-canvas'
  | 'scan-imports'
  | 'create-node'
  | 'share-canvas'
  | 'invite-collaborator';

type EdgeType = 'hierarchy' | 'dependency' | 'navigation' | 'data_flow';

export const FLOW_EDGE_TYPES: Record<ArchitectureFlowId, EdgeType[]> = {
  'agent-updates-canvas': ['dependency', 'data_flow'],
  'scan-imports': ['dependency'],
  'create-node': ['hierarchy'],
  'share-canvas': ['navigation', 'data_flow'],
  'invite-collaborator': ['data_flow'],
};

const FLOWS: Array<{
  id: ArchitectureFlowId;
  name: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    id: 'agent-updates-canvas',
    name: 'Agent updates canvas',
    description: 'AI work is reflected on the architecture map.',
    icon: Bot,
  },
  {
    id: 'scan-imports',
    name: 'Scan imports',
    description: 'Import edges are reconciled from the code graph.',
    icon: Code2,
  },
  {
    id: 'create-node',
    name: 'Create node',
    description: 'A page or feature is added to the canvas.',
    icon: PlusSquare,
  },
  {
    id: 'share-canvas',
    name: 'Share canvas',
    description: 'A read-only viewer link is created.',
    icon: Share2,
  },
  {
    id: 'invite-collaborator',
    name: 'Invite collaborator',
    description: 'A signed-in teammate gets project access.',
    icon: Users,
  },
];

const STEPS: Record<ArchitectureFlowId, Array<{ title: string; description: string }>> = {
  'agent-updates-canvas': [
    {
      title: 'Agent edits files',
      description: 'AI agent modifies project files in the repo.',
    },
    {
      title: 'Hook links changed paths',
      description: 'Post-commit hooks detect changed paths.',
    },
    {
      title: 'MCP writes node activity',
      description: 'MCP records activity for affected nodes.',
    },
    {
      title: 'Convex updates nodeEdges',
      description: 'Convex stores edge and metadata changes.',
    },
    {
      title: 'Canvas sync highlights flow',
      description: 'React Flow receives live updates.',
    },
  ],
  'scan-imports': [
    {
      title: 'Scanner reads imports',
      description: 'The MCP CLI walks source files for imports.',
    },
    {
      title: 'Paths map to nodes',
      description: 'Linked files resolve imports back to features.',
    },
    {
      title: 'Edges reconcile',
      description: 'Auto dependency edges converge without manual drift.',
    },
  ],
  'create-node': [
    {
      title: 'User adds node',
      description: 'A page or feature is created at the viewport center.',
    },
    {
      title: 'Convex persists it',
      description: 'The node position and type become the source of truth.',
    },
    {
      title: 'Canvas updates live',
      description: 'Other tabs receive the new node through reactive queries.',
    },
  ],
  'share-canvas': [
    {
      title: 'Owner creates link',
      description: 'A revocable share token is generated.',
    },
    {
      title: 'Viewer opens canvas',
      description: 'The public route resolves a sanitized project snapshot.',
    },
    {
      title: 'Read-only map renders',
      description: 'Pan and zoom stay available while edits are disabled.',
    },
  ],
  'invite-collaborator': [
    {
      title: 'Owner sends invite',
      description: 'A collaborator is linked to the project by email.',
    },
    {
      title: 'Member accepts',
      description: 'Accepted membership enables canvas access.',
    },
    {
      title: 'Shared work stays live',
      description: 'Both users read the same Convex-backed project.',
    },
  ],
};

type SidebarTab = 'overview' | 'layers' | 'hermes' | 'inspector' | 'flows';

const TABS: Array<{ id: SidebarTab; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'layers', label: 'Layers', icon: Layers3 },
  { id: 'hermes', label: 'Hermes', icon: Bot },
  { id: 'inspector', label: 'Inspector', icon: ListChecks },
  { id: 'flows', label: 'Flows', icon: GitBranch },
];

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
  selectedFlow: ArchitectureFlowId | null;
  onSelectedFlowChange: (flow: ArchitectureFlowId | null) => void;
  selectedNodeName: string | null;
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
  selectedFlow,
  onSelectedFlowChange,
  selectedNodeName,
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
  const [verifying, setVerifying] = useState(false);
  const sortedLayers = sortLayers(layers);
  const selectedSteps = selectedFlow ? STEPS[selectedFlow] : [];
  const selectedFlowName = selectedFlow
    ? FLOWS.find((flow) => flow.id === selectedFlow)?.name
    : null;
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
                Selected: {selectedNodeName ?? selectedFlowName ?? 'None'}
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
              {sortedLayers.map((layer, index) => (
                <div
                  key={layer._id}
                  className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-cyan-400/15 text-[10px] font-semibold text-cyan-200">
                      {index + 1}
                    </span>
                    <span className="truncate text-sm text-zinc-200">{layer.name}</span>
                  </div>
                  {layer.description && (
                    <p className="mt-1 line-clamp-2 pl-7 text-xs text-zinc-500">
                      {layer.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
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
                        {formatToken(inspectedNode.mappingStatus ?? 'manual')}
                      </p>
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
            <div className="overflow-hidden rounded-md border border-white/10">
              {FLOWS.map((flow) => {
                const Icon = flow.icon;
                const selected = selectedFlow === flow.id;
                return (
                  <button
                    key={flow.id}
                    type="button"
                    onClick={() => onSelectedFlowChange(flow.id)}
                    className={cn(
                      'flex w-full items-center gap-3 border-b border-white/10 px-3 py-3 text-left last:border-b-0',
                      'transition-colors hover:bg-white/[0.04]',
                      selected &&
                        'bg-amber-400/10 text-amber-200 ring-1 ring-inset ring-amber-400/70',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/15 text-zinc-400',
                        selected && 'border-amber-400/70 text-amber-300',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-100">
                        {flow.name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-zinc-500">
                        {flow.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSelectedFlowChange(null)}
              disabled={!selectedFlow}
              className="border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] disabled:opacity-40"
            >
              <X className="h-4 w-4" />
              Clear selection
            </Button>
            {selectedFlow ? (
              <ol className="space-y-2">
                {selectedSteps.map((step, index) => (
                  <li
                    key={step.title}
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
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-white/10 px-6 text-center">
                <p className="text-sm leading-6 text-zinc-500">
                  Select a flow to highlight related paths and inspect its steps.
                </p>
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
