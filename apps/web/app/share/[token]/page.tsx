'use client';

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Eye, Loader2 } from 'lucide-react';
import type { Editor, TLComponents } from 'tldraw';

import { api } from '../../../../../convex/_generated/api';
import { BrandMark } from '@/components/brand-mark';
import { PageNodeShapeUtil } from '@/components/canvas/page-node-shape';
import { FeatureNodeShapeUtil } from '@/components/canvas/feature-node-shape';
import { useShareCanvasSync } from '@/hooks/use-share-canvas-sync';
import { ShareNodeModal } from '@/components/share-node-modal/share-node-modal';

// tldraw uses browser-only APIs; load client-side only.
const Tldraw = dynamic(() => import('tldraw').then((m) => m.Tldraw), { ssr: false });

const shapeUtils = [PageNodeShapeUtil, FeatureNodeShapeUtil];

// Suppress tldraw's page / actions menus; the share viewer is read-only
// and has nothing to put there.
const components: TLComponents = {
  PageMenu: null,
  MainMenu: null,
  ActionsMenu: null,
};

export default function SharePage() {
  const params = useParams<{ token: string }>();
  const rawToken = params.token;
  const data = useQuery(api.shareView.get, { rawToken });

  const [editor, setEditor] = useState<Editor | null>(null);
  useShareCanvasSync({
    editor,
    nodes: data?.nodes,
    edges: data?.edges,
  });

  if (data === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading shared canvas…</span>
        </div>
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-xl border border-border/60 bg-card p-6 text-center shadow-sm">
          <BrandMark />
          <h1 className="mt-4 text-base font-semibold tracking-tight">
            Share link not available
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This share link is not available — it may have been revoked or expired.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block text-xs font-medium text-primary hover:underline"
          >
            Back to homepage
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-background/80 px-4 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Eye className="h-3 w-3" aria-hidden />
            <span>Viewer mode · readonly</span>
          </span>
        </div>
        <h1 className="text-sm font-medium tracking-tight">
          {data.projectName}
          <span className="mx-1.5 text-muted-foreground/60" aria-hidden>
            ·
          </span>
          <span className="text-muted-foreground">{data.shareName}</span>
        </h1>
        <span aria-hidden className="w-0" />
      </header>
      <div className="flex-1">
        <Tldraw shapeUtils={shapeUtils} components={components} onMount={setEditor} />
      </div>
      <ShareNodeModal rawToken={rawToken} />
    </main>
  );
}
