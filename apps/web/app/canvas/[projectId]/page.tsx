'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ChevronLeft, FileQuestion, History, Home, X } from 'lucide-react';
import { DefaultMinimap, type Editor, type TLComponents } from 'tldraw';

import { api } from '../../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import { PageNodeShapeUtil } from '@/components/canvas/page-node-shape';
import { FeatureNodeShapeUtil } from '@/components/canvas/feature-node-shape';
import { AddNodeButton } from '@/components/canvas/add-node-button';
import { CommandPalette } from '@/components/canvas/command-palette';
import { ExportProjectButton } from '@/components/canvas/export-project-button';
import { NodeModal } from '@/components/node-modal/node-modal';
import { useCanvasSync } from '@/hooks/use-canvas-sync';
import { useModalStore } from '@/store/modal-store';
import { useDrillStore } from '@/store/drill-store';

// tldraw uses browser-only APIs; load it client-side only.
const Tldraw = dynamic(() => import('tldraw').then((m) => m.Tldraw), { ssr: false });

const shapeUtils = [PageNodeShapeUtil, FeatureNodeShapeUtil];

// Hide tldraw's default page menu / actions menu since we render our own header.
// Sprint 5H: opt in to tldraw's built-in minimap (it ships hidden by default).
const components: TLComponents = {
  PageMenu: null,
  MainMenu: null,
  ActionsMenu: null,
  Minimap: DefaultMinimap,
};

export default function CanvasPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();
  const projectId = params.projectId as Id<'projects'>;
  const project = useQuery(api.projects.get, { id: projectId });
  const nodes = useQuery(api.nodes.listByProject, { projectId });
  const edges = useQuery(api.nodeEdges.listByProject, { projectId });
  const openModal = useModalStore((s) => s.open);

  const [editor, setEditor] = useState<Editor | null>(null);
  useCanvasSync({ editor, nodes, edges });

  // Sprint 5C drill-down: keep the children map (parentId -> child ids) in the
  // drill store so shape utils can read `hasChildren(nodeId)` to decide
  // drill-vs-modal on double-click. Recomputed only when `nodes` changes.
  const drillNodeId = useDrillStore((s) => s.drillNodeId);
  const setChildren = useDrillStore((s) => s.setChildren);
  const drillUp = useDrillStore((s) => s.drillUp);
  const resetDrill = useDrillStore((s) => s.reset);

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

  // Sprint 5H: auto-fit the camera once per (projectId, editor) pair after the
  // initial nodes load. The ref is keyed by projectId so navigating to a
  // different project re-runs the fit; toggling the editor remount also resets
  // it because the new Editor instance won't have the marker yet.
  const autoFittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (!nodes || nodes.length === 0) return;
    if (autoFittedFor.current === projectId) return;
    // Defer one frame so useCanvasSync has a chance to insert shapes before
    // we measure bounds; otherwise zoomToFit sees an empty page.
    const id = requestAnimationFrame(() => {
      try {
        editor.zoomToFit();
        autoFittedFor.current = projectId;
      } catch {
        // ignore — fit can throw if the editor was disposed mid-frame.
      }
    });
    return () => cancelAnimationFrame(id);
  }, [editor, nodes, projectId]);

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
  // Must run as an effect, not during render, to avoid setState-in-render warnings.
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
          <AddNodeButton projectId={projectId} editor={editor} nodes={nodes} />
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
        <Tldraw shapeUtils={shapeUtils} components={components} onMount={setEditor} />
      </div>
      <CommandPalette editor={editor} projectId={projectId} />
      <NodeModal />
    </main>
  );
}
