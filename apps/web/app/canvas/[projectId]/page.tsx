'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, FileQuestion, History, Home, Search, Share2, X } from 'lucide-react';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
} from '@xyflow/react';

import { api } from '../../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import { PageNode } from '@/components/canvas/page-node';
import { FeatureNode } from '@/components/canvas/feature-node';
import { AddNodeButton } from '@/components/canvas/add-node-button';
import { AutoLayoutButton } from '@/components/canvas/auto-layout-button';
import { CommandPalette } from '@/components/canvas/command-palette';
import { ExportProjectButton } from '@/components/canvas/export-project-button';
import { LayerLanes } from '@/components/canvas/layer-lanes';
import { FlowSidebar } from '@/components/canvas/flow-sidebar';
import { NodeModal } from '@/components/node-modal/node-modal';
import { useCanvasSync, type ArchNode } from '@/hooks/use-canvas-sync';
import type { CanvasEdgeMode } from '@/lib/canvas-edge-presentation';
import { useModalStore } from '@/store/modal-store';
import { useDrillStore } from '@/store/drill-store';

const nodeTypes: NodeTypes = {
  'page-node': PageNode,
  'feature-node': FeatureNode,
};

// Inner component sits inside <ReactFlowProvider> so `useReactFlow` can
// reach the editor context (fitView, setCenter, screenToFlowPosition).
function CanvasInner({ projectId }: { projectId: Id<'projects'> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const project = useQuery(api.projects.get, { id: projectId });
  const nodes = useQuery(api.nodes.listByProject, { projectId });
  const edges = useQuery(api.nodeEdges.listByProject, { projectId });
  const layers = useQuery(api.projectLayers.listByProject, { projectId });
  const nodeSummaries = useQuery(api.nodeFiles.summaryByProject, { projectId });
  const orphanSnapshot = useQuery(api.scans.getLatestByKind, { projectId, kind: 'orphans' });
  const driftSnapshot = useQuery(api.scans.getLatestByKind, { projectId, kind: 'drift' });
  const architectureFlows = useQuery(api.architectureFlows.listByProject, {
    projectId,
    status: 'applied',
  });
  const pendingSuggestions = useQuery(api.codebaseSuggestions.listByProject, {
    projectId,
    status: 'pending',
  });
  const pendingRelationshipSuggestions = useQuery(api.relationshipSuggestions.listByProject, {
    projectId,
    status: 'pending',
  });
  const pendingSemanticSuggestions = useQuery(api.semanticNodeSuggestions.listByProject, {
    projectId,
    status: 'pending',
  });
  const ensureDefaultLayers = useMutation(api.projectLayers.ensureDefaults);
  const openModal = useModalStore((s) => s.open);
  const selectedNodeId = useModalStore((s) => s.selectedNodeId);
  const [edgeMode, setEdgeMode] = useState<CanvasEdgeMode>('overview');
  const [selectedFlowId, setSelectedFlowId] = useState<Id<'architectureFlows'> | null>(null);
  const [inspectedNodeId, setInspectedNodeId] = useState<Id<'nodes'> | null>(null);

  const drillNodeId = useDrillStore((s) => s.drillNodeId);
  const setChildren = useDrillStore((s) => s.setChildren);
  const drillUp = useDrillStore((s) => s.drillUp);
  const resetDrill = useDrillStore((s) => s.reset);

  const { rfNodes, rfEdges, onNodesChange, onEdgesChange, onNodeDragStop, onConnect } =
    useCanvasSync({
      nodes,
      edges,
      nodeSummaries,
      edgeMode,
      selectedFlow:
        architectureFlows?.find((flow) => flow._id === selectedFlowId) ??
        (selectedFlowId ? null : undefined),
    });

  const rf = useReactFlow();
  const ensuredLayersFor = useRef<string | null>(null);

  useEffect(() => {
    if (!project || !layers || !nodes) return;
    const needsLayerSetup = layers.length === 0 || nodes.some((node) => !node.layerId);
    if (!needsLayerSetup) return;
    if (ensuredLayersFor.current === projectId) return;
    ensuredLayersFor.current = projectId;
    void ensureDefaultLayers({ projectId }).catch((error) => {
      ensuredLayersFor.current = null;
      console.error('Failed to ensure default project layers', error);
    });
  }, [ensureDefaultLayers, layers, nodes, project, projectId]);

  // Sprint 5C drill-down: keep the children map (parentId → child ids) in the
  // drill store so shape utils can read `hasChildren(nodeId)` to decide
  // drill-vs-modal on double-click. Recomputed only when `nodes` changes.
  useEffect(() => {
    if (!nodes) return;
    const map = new Map<string, string[]>();
    for (const n of nodes) {
      if (!n.parentId) continue;
      const key = n.parentId as string;
      const list = map.get(key);
      if (list) list.push(n._id as string);
      else map.set(key, [n._id as string]);
    }
    setChildren(map);
  }, [nodes, setChildren]);

  // Reset drill when switching projects so we don't try to drill into a node
  // that doesn't exist in the new project.
  useEffect(() => {
    resetDrill();
  }, [projectId, resetDrill]);

  // Auto-fit the camera once per (projectId, mount) pair after the initial
  // nodes load. Ref is keyed by projectId so navigating between projects
  // re-fits, while a Convex re-emit on the same project does not.
  const autoFittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (rfNodes.length === 0) return;
    if (autoFittedFor.current === projectId) return;
    // Defer one frame so React Flow has measured node sizes before fitView.
    const id = requestAnimationFrame(() => {
      try {
        rf.fitView({ padding: 0.2, duration: 0 });
        autoFittedFor.current = projectId;
      } catch {
        // fitView can throw if the canvas is mid-unmount; safe to ignore.
      }
    });
    return () => cancelAnimationFrame(id);
  }, [rfNodes, projectId, rf]);

  // Refit when drill scope changes so the new visible set fills the view.
  useEffect(() => {
    if (rfNodes.length === 0) return;
    const id = requestAnimationFrame(() => {
      try {
        rf.fitView({ padding: 0.2, duration: 200 });
      } catch {
        // ignore
      }
    });
    return () => cancelAnimationFrame(id);
  }, [drillNodeId, rf, rfNodes.length]);

  // Esc exits drill — but only when drilled in, so we don't hijack Esc for
  // the modal (which has its own handler) when on the flat view.
  useEffect(() => {
    if (drillNodeId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resetDrill();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drillNodeId, resetDrill]);

  // Build the breadcrumb path by walking up the parentId chain from
  // drillNodeId. Roots first, current drill last.
  const breadcrumb = useMemo<Doc<'nodes'>[]>(() => {
    if (!drillNodeId || !nodes) return [];
    const byId = new Map(nodes.map((n) => [n._id as string, n]));
    const chain: Doc<'nodes'>[] = [];
    let current: Doc<'nodes'> | undefined = byId.get(drillNodeId as string);
    while (current) {
      chain.unshift(current);
      current = current.parentId ? byId.get(current.parentId as string) : undefined;
    }
    return chain;
  }, [drillNodeId, nodes]);

  const selectedNodeName = useMemo(() => {
    if (!selectedNodeId || !nodes) return null;
    return nodes.find((n) => n._id === selectedNodeId)?.name ?? null;
  }, [nodes, selectedNodeId]);

  const health = useMemo(() => {
    const orphanData = orphanSnapshot?.data as
      | { repoFiles?: string[]; orphans?: string[]; scannedAt?: number }
      | undefined;
    const driftData = driftSnapshot?.data as { drift?: unknown[]; scannedAt?: number } | undefined;
    return {
      totalFiles: orphanData?.repoFiles?.length ?? 0,
      mappedFiles: (nodeSummaries ?? []).reduce((sum, row) => sum + row.fileCount, 0),
      orphanFiles: orphanData?.orphans?.length ?? 0,
      pendingSuggestions:
        (pendingSuggestions?.length ?? 0) +
        (pendingSemanticSuggestions?.length ?? 0) +
        (pendingRelationshipSuggestions?.length ?? 0),
      driftCount: driftData?.drift?.length ?? 0,
      lastScanAt: orphanData?.scannedAt ?? orphanSnapshot?.createdAt ?? null,
    };
  }, [
    driftSnapshot,
    nodeSummaries,
    orphanSnapshot,
    pendingRelationshipSuggestions,
    pendingSemanticSuggestions,
    pendingSuggestions,
  ]);

  // Redirect when the project is gone (e.g. cascade-deleted in another tab).
  useEffect(() => {
    if (project === null) router.replace('/projects');
  }, [project, router]);

  // Allow deep-linking from the activity feed: `?node=<id>` opens the modal
  // for that node, then strips the param so refreshing doesn't re-trigger.
  const nodeParam = searchParams.get('node');
  useEffect(() => {
    if (!nodeParam || !nodes) return;
    const exists = nodes.some((n) => n._id === nodeParam);
    if (!exists) return;
    openModal(nodeParam as Id<'nodes'>);
    router.replace(`/canvas/${projectId}`);
  }, [nodeParam, nodes, openModal, router, projectId]);

  if (project === undefined) {
    return (
      <main className="dark flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading...
      </main>
    );
  }
  if (project === null) {
    return null;
  }

  return (
    <main className="dark flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-zinc-950/90 px-4 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
            nativeButton={false}
            render={
              <Link href="/projects">
                <ChevronLeft className="h-4 w-4" />
                Projects
              </Link>
            }
          />
          <span className="h-5 w-px bg-white/10" aria-hidden />
          <BrandMark className="text-zinc-100" />
          <span className="text-zinc-600" aria-hidden>
            /
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium tracking-tight text-zinc-100">
              {project.name}
            </h1>
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              Architecture Flows
            </p>
          </div>
          <div className="hidden items-center gap-2 text-[11px] text-zinc-500 2xl:flex">
            <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1">
              {health.mappedFiles}/{health.totalFiles} mapped
            </span>
            <span className="rounded border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-amber-200">
              {health.orphanFiles} orphan
            </span>
            <span className="rounded border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-cyan-200">
              {health.pendingSuggestions} review
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
            aria-label="Search nodes"
            onClick={() => {
              window.dispatchEvent(
                new KeyboardEvent('keydown', {
                  key: 'k',
                  ctrlKey: true,
                  metaKey: true,
                  bubbles: true,
                }),
              );
            }}
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
            nativeButton={false}
            render={
              <Link href={`/canvas/${projectId}/orphans`}>
                <FileQuestion className="h-4 w-4" />
                Orphans
              </Link>
            }
          />
          <Button
            variant="ghost"
            size="sm"
            className="border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
            nativeButton={false}
            render={
              <Link href={`/canvas/${projectId}/activity`}>
                <History className="h-4 w-4" />
                Activity
              </Link>
            }
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
            aria-label="Share project"
            nativeButton={false}
            render={
              <Link href="/settings/share">
                <Share2 className="h-4 w-4" />
              </Link>
            }
          />
          <AutoLayoutButton nodes={nodes} layers={layers} />
          <ExportProjectButton projectId={projectId} />
          <AddNodeButton projectId={projectId} nodes={nodes} layers={layers} />
        </div>
      </header>
      {drillNodeId !== null && breadcrumb.length > 0 && (
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-zinc-900/80 px-4">
          <div className="flex items-center gap-1 overflow-hidden text-sm">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-zinc-300 hover:bg-white/10 hover:text-zinc-50"
              onClick={() => resetDrill()}
              aria-label="Exit drill-down"
            >
              <Home className="h-4 w-4" />
            </Button>
            {breadcrumb.map((node, i) => {
              const isLast = i === breadcrumb.length - 1;
              return (
                <div key={node._id} className="flex items-center gap-1">
                  <span className="text-zinc-600" aria-hidden>
                    /
                  </span>
                  {isLast ? (
                    <span className="truncate px-1.5 font-medium">{node.name}</span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-zinc-300 hover:bg-white/10 hover:text-zinc-50"
                      onClick={() => drillUp(node._id as Id<'nodes'>)}
                    >
                      <span className="truncate">{node.name}</span>
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-zinc-300 hover:bg-white/10 hover:text-zinc-50"
            onClick={() => resetDrill()}
          >
            <X className="h-4 w-4" />
            Exit
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-3 p-3 max-lg:flex-col">
        <section className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-zinc-950 shadow-2xl shadow-black/30">
          <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.12),transparent_42%)]" />

          <ReactFlow<ArchNode>
            className="relative z-10"
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_, node) => setInspectedNodeId(node.id as Id<'nodes'>)}
            onConnect={onConnect}
            nodesDraggable={false}
            nodesConnectable={false}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.1}
            maxZoom={2}
          >
            <LayerLanes layers={layers} nodes={nodes} />
            <Background gap={22} color="rgba(255,255,255,0.06)" />
            <Controls
              showInteractive={false}
              className="!bottom-5 !left-5 !rounded-lg !border !border-white/10 !bg-zinc-950/90 !shadow-2xl [&_button]:!border-white/10 [&_button]:!bg-transparent [&_button]:!text-zinc-300 hover:[&_button]:!bg-white/10"
            />
          </ReactFlow>

          <div className="pointer-events-none absolute bottom-5 left-24 z-20 flex flex-wrap items-center gap-5 rounded-lg border border-white/10 bg-zinc-950/90 px-4 py-3 text-xs text-zinc-400 shadow-2xl shadow-black/30">
            <LegendItem color="border-zinc-500" label="hierarchy" dashed />
            <LegendItem color="border-zinc-500" label="dependency" dashed />
            <LegendItem color="border-cyan-400" label="navigation" />
            <LegendItem color="border-amber-400" label="data flow" />
            <LegendItem color="border-violet-400" label="agent update" />
          </div>
        </section>

        <FlowSidebar
          projectId={projectId}
          layers={layers}
          nodes={nodes}
          edges={edges}
          nodeSummaries={nodeSummaries}
          inspectedNodeId={inspectedNodeId}
          onInspectedNodeChange={setInspectedNodeId}
          health={health}
          flows={architectureFlows}
          selectedFlowId={selectedFlowId}
          onSelectedFlowChange={setSelectedFlowId}
          edgeMode={edgeMode}
          onEdgeModeChange={setEdgeMode}
          selectedNodeName={selectedNodeName}
          nodeCount={nodes?.length ?? 0}
          edgeCount={edges?.length ?? 0}
        />
      </div>
      <CommandPalette projectId={projectId} />
      <NodeModal />
    </main>
  );
}

function LegendItem({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-px w-9 border-t-2 ${color} ${dashed ? 'border-dashed' : ''}`} />
      <span>{label}</span>
    </span>
  );
}

export default function CanvasPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId as Id<'projects'>;
  return (
    <ReactFlowProvider>
      <CanvasInner projectId={projectId} />
    </ReactFlowProvider>
  );
}
