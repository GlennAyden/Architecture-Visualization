'use client';

import { useEffect, useState } from 'react';
import { useQuery } from 'convex/react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { Editor, TLComponents } from 'tldraw';

import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import { PageNodeShapeUtil } from '@/components/canvas/page-node-shape';
import { FeatureNodeShapeUtil } from '@/components/canvas/feature-node-shape';
import { AddPageButton } from '@/components/canvas/add-page-button';
import { NodeModal } from '@/components/node-modal/node-modal';
import { useCanvasSync } from '@/hooks/use-canvas-sync';

// tldraw uses browser-only APIs; load it client-side only.
const Tldraw = dynamic(() => import('tldraw').then((m) => m.Tldraw), { ssr: false });

const shapeUtils = [PageNodeShapeUtil, FeatureNodeShapeUtil];

// Hide tldraw's default page menu / actions menu since we render our own header.
const components: TLComponents = {
  PageMenu: null,
  MainMenu: null,
  ActionsMenu: null,
};

export default function CanvasPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId as Id<'projects'>;
  const project = useQuery(api.projects.get, { id: projectId });
  const nodes = useQuery(api.nodes.listByProject, { projectId });

  const [editor, setEditor] = useState<Editor | null>(null);
  useCanvasSync({ editor, nodes });

  // Redirect when the project is gone (e.g. cascade-deleted in another tab).
  // Must run as an effect, not during render, to avoid setState-in-render warnings.
  useEffect(() => {
    if (project === null) router.replace('/projects');
  }, [project, router]);

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
        <div>
          <AddPageButton projectId={projectId} editor={editor} />
        </div>
      </header>
      <div className="flex-1">
        <Tldraw shapeUtils={shapeUtils} components={components} onMount={setEditor} />
      </div>
      <NodeModal />
    </main>
  );
}
