'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, FileQuestion } from 'lucide-react';

import { api } from '../../../../../../convex/_generated/api';
import type { Id } from '../../../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Shape of the data Convex returns for the `orphans` scan kind. Mirrors the
 * union documented in convex/scans.ts; we narrow it locally so we don't have
 * to plumb a shared type through `packages/shared` for a single page.
 */
interface OrphansSnapshotData {
  scannedAt: number;
  repoFiles: string[];
  orphans: string[];
  truncated?: boolean;
}

/**
 * Formats a Convex `_creationTime` (ms since epoch) as a relative-time
 * string like "3m ago". Falls back to absolute date if older than a week.
 * Copied from activity/page.tsx — not factored out per CLAUDE.md Rule 3.
 */
function relativeTime(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

const EXTENSION_OPTIONS = ['all', '.ts', '.tsx', '.js', '.jsx'] as const;
type ExtensionFilter = (typeof EXTENSION_OPTIONS)[number];

export default function ProjectOrphansPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId as Id<'projects'>;
  const project = useQuery(api.projects.get, { id: projectId });
  const snapshot = useQuery(api.scans.getLatestByKind, { projectId, kind: 'orphans' });
  const nodes = useQuery(api.nodes.listByProject, { projectId });

  // Track which paths the user has just linked so we can hide them
  // optimistically until the next snapshot arrives without that path.
  const [linkedPaths, setLinkedPaths] = useState<Set<string>>(new Set());
  const [pickerPath, setPickerPath] = useState<string | null>(null);
  const [pathFilter, setPathFilter] = useState('');
  const [extFilter, setExtFilter] = useState<ExtensionFilter>('all');

  // Redirect when the project is gone (e.g. cascade-deleted in another tab).
  useEffect(() => {
    if (project === null) router.replace('/projects');
  }, [project, router]);

  // Reset the optimistic set whenever a fresh snapshot arrives — paths the
  // backend now considers linked will simply not appear in `orphans` anyway.
  useEffect(() => {
    setLinkedPaths(new Set());
  }, [snapshot?.id]);

  const data = (snapshot?.data ?? null) as OrphansSnapshotData | null;

  const visibleOrphans = useMemo(() => {
    if (!data) return [];
    const trimmedFilter = pathFilter.trim().toLowerCase();
    return data.orphans.filter((path) => {
      if (linkedPaths.has(path)) return false;
      if (extFilter !== 'all' && !path.endsWith(extFilter)) return false;
      if (trimmedFilter && !path.toLowerCase().includes(trimmedFilter)) return false;
      return true;
    });
  }, [data, pathFilter, extFilter, linkedPaths]);

  if (project === undefined) {
    return <p className="p-8 text-muted-foreground">Loading…</p>;
  }
  if (project === null) {
    return null;
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/60 bg-background/80 px-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={
              <Link href={`/canvas/${projectId}`}>
                <ChevronLeft className="h-4 w-4" />
                Canvas
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
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <FileQuestion className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Orphan files</h2>
            <p className="text-sm text-muted-foreground">
              Source files in the repo that aren&apos;t linked to any node yet.
            </p>
          </div>
        </div>

        {snapshot === undefined ? (
          <p className="py-6 text-sm text-muted-foreground">Loading orphan scan…</p>
        ) : snapshot === null || data === null ? (
          <EmptyNoScan />
        ) : (
          <>
            <p className="mb-4 text-xs text-muted-foreground">
              Last scanned: {relativeTime(data.scannedAt)}
            </p>

            {data.truncated && (
              <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                Scan was truncated at {data.orphans.length} results. Re-run with{' '}
                <code className="font-mono">scan-orphans --all</code> to see the rest.
              </div>
            )}

            {data.orphans.length === 0 ? (
              <EmptyAllLinked />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-[12rem]">
                    <Input
                      value={pathFilter}
                      onChange={(e) => setPathFilter(e.target.value)}
                      placeholder="Filter by path substring…"
                    />
                  </div>
                  <select
                    value={extFilter}
                    onChange={(e) => setExtFilter(e.target.value as ExtensionFilter)}
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  >
                    {EXTENSION_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === 'all' ? 'All extensions' : opt}
                      </option>
                    ))}
                  </select>
                </div>

                {visibleOrphans.length === 0 ? (
                  <p className="py-6 text-sm text-muted-foreground">
                    No orphans match the current filter.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {visibleOrphans.map((path) => (
                      <li
                        key={path}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-sm transition-colors hover:border-border"
                      >
                        <span className="truncate font-mono text-xs" title={path}>
                          {path}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPickerPath(path)}
                        >
                          Link to node…
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>

      <LinkToNodeDialog
        path={pickerPath}
        nodes={nodes ?? null}
        onClose={() => setPickerPath(null)}
        onLinked={(path) => {
          setLinkedPaths((prev) => {
            const next = new Set(prev);
            next.add(path);
            return next;
          });
        }}
      />
    </main>
  );
}

function EmptyNoScan() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 py-12 text-center">
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <FileQuestion className="h-4 w-4" />
      </div>
      <p className="text-sm font-medium">No orphan scan yet</p>
      <p className="max-w-md text-xs text-muted-foreground">
        Run <code className="font-mono text-[11px]">npx arch-viz-mcp scan-orphans</code> from
        your repo to populate this list.
      </p>
    </div>
  );
}

function EmptyAllLinked() {
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center text-sm text-emerald-700 dark:text-emerald-300">
      All files are linked — canvas is in sync.
    </div>
  );
}

interface LinkToNodeDialogProps {
  path: string | null;
  nodes: { _id: Id<'nodes'>; name: string; type: 'page' | 'feature' }[] | null;
  onClose: () => void;
  onLinked: (path: string) => void;
}

function LinkToNodeDialog({ path, nodes, onClose, onLinked }: LinkToNodeDialogProps) {
  const add = useMutation(api.nodeFiles.add);
  const [busyNodeId, setBusyNodeId] = useState<Id<'nodes'> | null>(null);
  const [query, setQuery] = useState('');

  // Reset filter whenever the dialog reopens for a different path.
  useEffect(() => {
    if (path !== null) setQuery('');
  }, [path]);

  const filtered = useMemo(() => {
    if (!nodes) return [];
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return nodes;
    return nodes.filter((n) => n.name.toLowerCase().includes(trimmed));
  }, [nodes, query]);

  const open = path !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link file to node</DialogTitle>
          <DialogDescription>
            {path ? (
              <span className="font-mono text-xs">{path}</span>
            ) : (
              'Pick a node to link this file to.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter nodes by name…"
          />
          {nodes === null ? (
            <p className="py-6 text-sm text-muted-foreground">Loading nodes…</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">No nodes match.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {filtered.map((node) => (
                <li key={node._id}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    disabled={busyNodeId !== null}
                    onClick={async () => {
                      if (!path) return;
                      setBusyNodeId(node._id);
                      try {
                        await add({ nodeId: node._id, path });
                        onLinked(path);
                        onClose();
                      } finally {
                        setBusyNodeId(null);
                      }
                    }}
                  >
                    <span className="mr-2 inline-flex h-4 items-center rounded bg-muted px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {node.type}
                    </span>
                    <span className="truncate">{node.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
