'use client';

import { useState } from 'react';
import { useMutation } from 'convex/react';
import {
  Bot,
  Code2,
  GitBranch,
  Layers3,
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

interface Props {
  projectId: Id<'projects'>;
  layers: Doc<'projectLayers'>[] | undefined;
  selectedFlow: ArchitectureFlowId | null;
  onSelectedFlowChange: (flow: ArchitectureFlowId | null) => void;
  selectedNodeName: string | null;
  nodeCount: number;
  edgeCount: number;
}

export function FlowSidebar({
  projectId,
  layers,
  selectedFlow,
  onSelectedFlowChange,
  selectedNodeName,
  nodeCount,
  edgeCount,
}: Props) {
  const createLayer = useMutation(api.projectLayers.create);
  const [newLayerName, setNewLayerName] = useState('');
  const [layerError, setLayerError] = useState<string | null>(null);
  const [creatingLayer, setCreatingLayer] = useState(false);
  const sortedLayers = sortLayers(layers);
  const selectedSteps = selectedFlow ? STEPS[selectedFlow] : [];
  const selectedFlowName = selectedFlow
    ? FLOWS.find((flow) => flow.id === selectedFlow)?.name
    : null;

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

  return (
    <aside className="flex min-h-0 w-[360px] shrink-0 flex-col gap-3 overflow-y-auto pr-1 max-xl:w-[320px] max-lg:h-[360px] max-lg:w-full">
      <section className="rounded-lg border border-white/10 bg-zinc-950/80 p-3 shadow-2xl shadow-black/30">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Layers
          </h2>
          <Layers3 className="h-4 w-4 text-cyan-300" />
        </div>
        <div className="space-y-1.5">
          {sortedLayers.map((layer, index) => (
            <div
              key={layer._id}
              className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5"
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-cyan-400/15 text-[10px] font-semibold text-cyan-200">
                {index + 1}
              </span>
              <span className="truncate text-sm text-zinc-200">{layer.name}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
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
        {layerError && <p className="mt-2 text-xs text-destructive">{layerError}</p>}
      </section>

      <section className="rounded-lg border border-white/10 bg-zinc-950/80 p-3 shadow-2xl shadow-black/30">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">Flows</h2>
          {selectedFlow && (
            <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_16px_rgba(251,191,36,0.8)]" />
          )}
        </div>
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
                  selected && 'bg-amber-400/10 text-amber-200 ring-1 ring-inset ring-amber-400/70',
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
          className="mt-3 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] disabled:opacity-40"
        >
          <X className="h-4 w-4" />
          Clear selection
        </Button>
      </section>

      <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-white/10 bg-zinc-950/80 p-3 shadow-2xl shadow-black/30">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Steps &amp; Inspector
          </h2>
          <GitBranch className="h-4 w-4 text-violet-300" />
        </div>

        {selectedFlow ? (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="mb-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2">
              <p className="text-xs uppercase tracking-[0.14em] text-amber-300">Selected flow</p>
              <p className="mt-1 text-sm font-semibold text-zinc-100">{selectedFlowName}</p>
            </div>
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
                    <span className="block text-sm font-semibold text-zinc-100">{step.title}</span>
                    <span className="mt-1 block text-xs leading-5 text-zinc-500">
                      {step.description}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-white/10 px-6 text-center">
            <p className="text-sm leading-6 text-zinc-500">
              Select a flow to highlight related paths and inspect its steps.
            </p>
          </div>
        )}

        <div className="mt-3 rounded-md border border-violet-400/30 bg-violet-400/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-100">
                Selected: {selectedNodeName ?? selectedFlowName ?? 'None'}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {nodeCount} nodes / {edgeCount} edges
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              live
            </span>
          </div>
        </div>
      </section>
    </aside>
  );
}
