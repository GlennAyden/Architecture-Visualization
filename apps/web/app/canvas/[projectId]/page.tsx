'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from 'convex/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, FileQuestion, History, Home, X } from 'lucide-react';
import {
  Background,
  Controls,
  MiniMap,
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
import { CommandPalette } from '@/components/canvas/command-palette';
import { ExportProjectButton } from '@/components/canvas/export-project-button';
import { NodeModal } from '@/components/node-modal/node-modal';
import { useCanvasSync, type ArchNode } from '@/hooks/use-canvas-sync';
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
  const openModal = useModalStore((s) => s.open);

  const drillNodeId = useDrillStore((s) => s.drillNodeId);
  const setChildren = useDrillStore((s) => s.setChildren);
  const drillUp = useDrillStore((s) => s.drillUp);
  const resetDrill = useDrillStore((s) => s.reset);

  const { rfNodes, rfEdges, onNodesChange, onEdgesChange, onNodeDragStop, onConnect } =
    useCanvasSync({ nodes, edges });

  const rf = useReactFlow();

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
    return <p className="p-8 text-muted-foreground">Loading…</p>;
  }
  if (project === null) {
    return null;
  }

  return (
    <main className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-background/80 px-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={
              <Link href="/projects">
                <ChevronLeft className="h-4 w-4" />
                Projects
              </Link>
            }
          />
          <span className="h-5 w-px bg-border" aria-hidden />
          <BrandMark />
          <span className="text-muted-foreground/60" aria-hidden>
            /
          </span>
          <h1 className="text-sm font-medium tracking-tight">{project.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
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
            nativeButton={false}
            render={
              <Link href={`/canvas/${projectId}/activity`}>
                <History className="h-4 w-4" />
                Activity
              </Link>
            }
          />
          <ExportProjectButton projectId={projectId} />
          <AddNodeButton projectId={projectId} nodes={nodes} />
        </div>
      </header>
      {drillNodeId !== null && breadcrumb.length > 0 && (
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 bg-muted/30 px-4">
          <div className="flex items-center gap-1 overflow-hidden text-sm">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => resetDrill()}
              aria-label="Exit drill-down"
            >
              <Home className="h-4 w-4" />
            </Button>
            {breadcrumb.map((node, i) => {
              const isLast = i === breadcrumb.length - 1;
              return (
                <div key={node._id} className="flex items-center gap-1">
                  <span className="text-muted-foreground/60" aria-hidden>
                    /
                  </span>
                  {isLast ? (
                    <span className="truncate px-1.5 font-medium">{node.name}</span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => drillUp(node._id as Id<'nodes'>)}
                    >
                      <span className="truncate">{node.name}</span>
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <Button variant="ghost" size="sm" onClick={() => resetDrill()}>
            <X className="h-4 w-4" />
            Exit
          </Button>
        </div>
      )}
      <div className="flex-1">
        <ReactFlow<ArchNode>
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
        >
          <Background gap={20} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <CommandPalette projectId={projectId} />
      <NodeModal />
    </main>
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
