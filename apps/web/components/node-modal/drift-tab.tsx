'use client';

import { useMemo } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Archive, FileX, Trash2, GitBranch } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';

/**
 * Shape of the data Convex returns for the `drift` scan kind. Mirrors the
 * union documented in convex/scans.ts; we narrow it locally so we don't have
 * to plumb a shared type through `packages/shared` for a single tab.
 */
interface DriftEntry {
  nodeId: string;
  path: string;
  kind: 'missing' | 'renamed_candidate';
  oldPath?: string;
  newPath?: string;
}
interface DriftSnapshotData {
  scannedAt: number;
  drift: DriftEntry[];
  truncated?: boolean;
}

interface Props {
  nodeId: Id<'nodes'>;
  projectId: Id<'projects'>;
}

export function DriftTab({ nodeId, projectId }: Props) {
  const snapshot = useQuery(api.scans.getLatestByKind, { projectId, kind: 'drift' });
  const files = useQuery(api.nodeFiles.listByNode, { nodeId });
  const remove = useMutation(api.nodeFiles.remove);
  const setArchived = useMutation(api.nodeFiles.setArchived);
  const add = useMutation(api.nodeFiles.add);

  const data = (snapshot?.data ?? null) as DriftSnapshotData | null;

  const entries = useMemo(() => {
    if (!data) return [];
    return data.drift.filter((d) => d.nodeId === nodeId);
  }, [data, nodeId]);

  if (snapshot === undefined || files === undefined) {
    return <p className="py-6 text-sm text-muted-foreground">Loading drift scan…</p>;
  }

  if (snapshot === null || data === null || entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FileX className="h-4 w-4" />
        </div>
        <p className="text-sm font-medium">No drift detected for this node</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Run <code className="font-mono text-[11px]">npx arch-viz-mcp scan-drift</code> from your
          repo to refresh.
        </p>
      </div>
    );
  }

  // Map path -> nodeFiles row id so the action buttons can resolve which
  // row to remove/archive. Archived rows are excluded so already-acked drift
  // never re-appears with active buttons.
  const pathToFileId = new Map<string, Id<'nodeFiles'>>();
  for (const f of files) {
    if (f.archived) continue;
    pathToFileId.set(f.path, f._id);
  }

  return (
    <ul className="space-y-2 py-2">
      {entries.map((entry) => {
        const fileId = pathToFileId.get(entry.path);
        return (
          <li
            key={`${entry.nodeId}:${entry.path}`}
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            <div className="mb-2 flex items-center gap-2">
              <FileX className="h-4 w-4 text-destructive" aria-hidden />
              <span className="truncate font-mono text-xs" title={entry.path}>
                {entry.path}
              </span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              {entry.kind === 'missing' ? (
                <span>Missing on disk</span>
              ) : (
                <span>
                  Possibly renamed{' '}
                  {entry.newPath && (
                    <>
                      → <span className="font-mono">{entry.newPath}</span>
                    </>
                  )}
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={!fileId}
                onClick={() => {
                  if (!fileId) return;
                  remove({ id: fileId });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete link
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!fileId}
                onClick={() => {
                  if (!fileId) return;
                  setArchived({ id: fileId, archived: true });
                }}
              >
                <Archive className="h-3.5 w-3.5" />
                Archive (keep as history)
              </Button>
              {entry.kind === 'renamed_candidate' && entry.newPath && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!fileId}
                  onClick={async () => {
                    if (!fileId || !entry.newPath) return;
                    await setArchived({ id: fileId, archived: true });
                    await add({ nodeId, path: entry.newPath });
                  }}
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  Adopt rename
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Standalone hook-style helper for computing the unarchived drift count for a
 * given (nodeId, projectId). The node modal uses this to decide whether to
 * render the badge on the Drift tab trigger.
 */
export function useDriftCount(nodeId: Id<'nodes'>, projectId: Id<'projects'>): number {
  const snapshot = useQuery(api.scans.getLatestByKind, { projectId, kind: 'drift' });
  const files = useQuery(api.nodeFiles.listByNode, { nodeId });

  return useMemo(() => {
    const data = (snapshot?.data ?? null) as DriftSnapshotData | null;
    if (!data) return 0;
    const archived = new Set<string>();
    for (const f of files ?? []) {
      if (f.archived) archived.add(f.path);
    }
    return data.drift.filter((d) => d.nodeId === nodeId && !archived.has(d.path)).length;
  }, [snapshot, files, nodeId]);
}
