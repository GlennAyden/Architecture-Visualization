'use client';

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { Editor, TLComponents } from 'tldraw';

import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { PageNodeShapeUtil } from '@/components/canvas/page-node-shape';
import { AddPageButton } from '@/components/canvas/add-page-button';
import { useCanvasSync } from '@/hooks/use-canvas-sync';

// tldraw uses browser-only APIs; load it client-side only.
const Tldraw = dynamic(() => import('tldraw').then((m) => m.Tldraw), { ssr: false });

const shapeUtils = [PageNodeShapeUtil];

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

  if (project === undefined) {
    return <p className="p-8 text-muted-foreground">Loading…</p>;
  }
  if (project === null) {
    router.replace('/projects');
    return null;
  }

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/projects">
            <Button variant="ghost" size="sm">
              ← Projects
            </Button>
          </Link>
          <h1 className="text-lg font-medium">{project.name}</h1>
        </div>
        <div>
          <AddPageButton projectId={projectId} editor={editor} />
        </div>
      </header>
      <div className="flex-1">
        <Tldraw shapeUtils={shapeUtils} components={components} onMount={setEditor} />
      </div>
    </main>
  );
}
