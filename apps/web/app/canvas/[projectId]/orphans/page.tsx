'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, FileQuestion, Plus } from 'lucide-react';

import { api } from '../../../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getNextNodePosition, sortLayers } from '@/lib/architecture-layers';

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
  const layers = useQuery(api.projectLayers.listByProject, { projectId });
  const ensureDefaultLayers = useMutation(api.projectLayers.ensureDefaults);
  const ensuredLayersFor = useRef<string | null>(null);

  // Track which paths the user has just linked so we can hide them
  // optimistically until the next snapshot arrives without that path.
  const [linkedPaths, setLinkedPaths] = useState<Set<string>>(new Set());
  const [pickerPath, setPickerPath] = useState<string | null>(null);
  const [createPath, setCreatePath] = useState<string | null>(null);
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
    return <p className="dark bg-zinc-950 p-8 text-zinc-400">Loading…</p>;
  }
  if (project === null) {
    return null;
  }

  return (
    <main className="dark min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-white/10 bg-zinc-950/90 px-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-zinc-300 hover:bg-white/10 hover:text-zinc-50"
            nativeButton={false}
            render={
              <Link href={`/canvas/${projectId}`}>
                <ChevronLeft className="h-4 w-4" />
                Canvas
              </Link>
            }
          />
          <span className="h-5 w-px bg-white/10" aria-hidden />
          <BrandMark className="text-zinc-100" />
          <span className="text-zinc-600" aria-hidden>
            /
          </span>
          <h1 className="text-sm font-medium tracking-tight">{project.name}</h1>
        </div>
      </header>

      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.12),transparent_42%)]"
      />

      <div className="relative mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300"
            >
              <FileQuestion className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Orphan files</h2>
              <p className="text-sm text-zinc-400">
                Source files in the repo that aren&apos;t linked to any node yet.
              </p>
            </div>
          </div>

          <div className="grid gap-2 text-xs text-zinc-400 sm:grid-cols-3 lg:w-[520px]">
            <span className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              1. Run orphan scan
            </span>
            <span className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              2. Create or link nodes
            </span>
            <span className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              3. Run import scan
            </span>
          </div>
        </div>

        {snapshot === undefined ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-400">
            Loading orphan scan…
          </p>
        ) : snapshot === null || data === null ? (
          <EmptyNoScan />
        ) : (
          <>
            <p className="mb-4 text-xs text-zinc-500">
              Last scanned: {relativeTime(data.scannedAt)}
            </p>

            {data.truncated && (
              <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-300">
                Scan was truncated at {data.orphans.length} results. Create or link the visible
                files, then re-run the orphan scan to continue through the remaining list.
              </div>
            )}

            {data.orphans.length === 0 ? (
              <EmptyAllLinked />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-zinc-950/80 p-3">
                  <div className="min-w-[12rem] flex-1">
                    <Input
                      value={pathFilter}
                      onChange={(e) => setPathFilter(e.target.value)}
                      placeholder="Filter by path substring…"
                      className="border-white/10 bg-white/[0.03] text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                  <select
                    value={extFilter}
                    onChange={(e) => setExtFilter(e.target.value as ExtensionFilter)}
                    className="h-8 rounded-lg border border-white/10 bg-zinc-950 px-2.5 text-sm text-zinc-200 outline-none focus-visible:border-cyan-300 focus-visible:ring-3 focus-visible:ring-cyan-300/20"
                  >
                    {EXTENSION_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === 'all' ? 'All extensions' : opt}
                      </option>
                    ))}
                  </select>
                </div>

                {visibleOrphans.length === 0 ? (
                  <p className="rounded-lg border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-400">
                    No orphans match the current filter.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {visibleOrphans.map((path) => (
                      <li
                        key={path}
                        className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm transition-colors hover:border-cyan-400/30 hover:bg-white/[0.05]"
                      >
                        <span className="truncate font-mono text-xs" title={path}>
                          {path}
                        </span>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCreatePath(path)}
                            className="text-zinc-300 hover:bg-white/10 hover:text-zinc-50"
                          >
                            <Plus className="h-4 w-4" />
                            Create node
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setPickerPath(path)}>
                            Link to node…
                          </Button>
                        </div>
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
      <CreateNodeFromPathDialog
        projectId={projectId}
        path={createPath}
        nodes={nodes ?? null}
        layers={layers ?? null}
        onClose={() => setCreatePath(null)}
        onCreated={(path) => {
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
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] py-12 text-center">
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400/10 text-cyan-300">
        <FileQuestion className="h-4 w-4" />
      </div>
      <p className="text-sm font-medium">No orphan scan yet</p>
      <p className="max-w-md text-xs text-zinc-400">
        Run <code className="font-mono text-[11px]">npx arch-viz-mcp scan-orphans</code> from your
        repo to populate this list.
      </p>
    </div>
  );
}

function EmptyAllLinked() {
  return (
    <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-6 text-center text-sm text-emerald-300">
      All files are linked — canvas is in sync.
    </div>
  );
}

interface LinkToNodeDialogProps {
  path: string | null;
  nodes: Pick<Doc<'nodes'>, '_id' | 'name' | 'type'>[] | null;
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
      <DialogContent className="dark border-white/10 bg-zinc-950 text-zinc-100">
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
            className="border-white/10 bg-white/[0.03] text-zinc-100 placeholder:text-zinc-600"
          />
          {nodes === null ? (
            <p className="py-6 text-sm text-zinc-400">Loading nodes…</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-sm text-zinc-400">No nodes match.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {filtered.map((node) => (
                <li key={node._id}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-zinc-300 hover:bg-white/10 hover:text-zinc-50"
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
                    <span className="mr-2 inline-flex h-4 items-center rounded bg-cyan-400/10 px-1.5 text-[10px] uppercase tracking-wide text-cyan-200">
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

interface CreateNodeFromPathDialogProps {
  projectId: Id<'projects'>;
  path: string | null;
  nodes: Doc<'nodes'>[] | null;
  layers: Doc<'projectLayers'>[] | null;
  onClose: () => void;
  onCreated: (path: string) => void;
}

function suggestedNodeName(path: string) {
  const fileName = path.split(/[\\/]/).at(-1) ?? path;
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  const words = withoutExtension.replace(/[-_.]+/g, ' ').trim();
  return words.length > 0 ? words : fileName;
}

function CreateNodeFromPathDialog({
  projectId,
  path,
  nodes,
  layers,
  onClose,
  onCreated,
}: CreateNodeFromPathDialogProps) {
  const createNode = useMutation(api.nodes.create);
  const linkFile = useMutation(api.nodeFiles.add);
  const sortedLayers = useMemo(() => sortLayers(layers ?? undefined), [layers]);
  const [name, setName] = useState('');
  const [layerId, setLayerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!path) return;
    setName(suggestedNodeName(path));
    setLayerId(sortedLayers[0]?._id ?? '');
    setError(null);
  }, [path, sortedLayers]);

  const canSubmit =
    Boolean(path) &&
    nodes !== null &&
    sortedLayers.length > 0 &&
    layerId.length > 0 &&
    name.trim().length > 0;

  const handleCreate = async () => {
    if (!path || !canSubmit) return;
    const trimmed = name.trim();
    setSubmitting(true);
    setError(null);
    try {
      const position = getNextNodePosition({
        layers: sortedLayers,
        nodes: nodes ?? [],
        layerId,
      });
      const nodeId = await createNode({
        projectId,
        type: 'page',
        name: trimmed,
        layerId: layerId as Id<'projectLayers'>,
        ...position,
      });
      await linkFile({ nodeId, path });
      onCreated(path);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create node');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={path !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="dark border-white/10 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle>Create node from file</DialogTitle>
          <DialogDescription>
            {path ? (
              <span className="font-mono text-xs">{path}</span>
            ) : (
              'Create a canvas node and link this file to it.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="orphan-node-name">Name</Label>
            <Input
              id="orphan-node-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="border-white/10 bg-white/[0.03] text-zinc-100 placeholder:text-zinc-600"
              autoFocus
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="orphan-node-layer">Layer</Label>
            <Select value={layerId} onValueChange={(value) => setLayerId(value ?? '')}>
              <SelectTrigger id="orphan-node-layer" className="border-white/10 bg-white/[0.03]">
                <SelectValue placeholder="Pick a layer" />
              </SelectTrigger>
              <SelectContent className="dark border-white/10 bg-zinc-950 text-zinc-100">
                {sortedLayers.map((layer) => (
                  <SelectItem key={layer._id} value={layer._id}>
                    {layer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate} disabled={!canSubmit || submitting}>
            {submitting ? 'Creating...' : 'Create node'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
