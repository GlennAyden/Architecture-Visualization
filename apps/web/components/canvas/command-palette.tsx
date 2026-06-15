'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { useReactFlow } from '@xyflow/react';
import { FileText, Square } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useModalStore } from '@/store/modal-store';
import { useCanvasViewStore } from '@/store/canvas-view-store';

interface Props {
  projectId: Id<'projects'>;
}

const MAX_RESULTS = 50;
const RECENT_FALLBACK = 10;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

type Ranked = { node: Doc<'nodes'>; rank: number };

function rankMatches(nodes: Doc<'nodes'>[], query: string): Doc<'nodes'>[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    // Empty query: most-recent first.
    return [...nodes].sort((a, b) => b._creationTime - a._creationTime).slice(0, RECENT_FALLBACK);
  }
  const out: Ranked[] = [];
  for (const node of nodes) {
    const name = node.name.toLowerCase();
    const idx = name.indexOf(q);
    if (idx === -1) continue;
    // 0 = exact prefix; 1 = substring; tie-break by name length (shorter first).
    const rank = idx === 0 ? 0 : 1;
    out.push({ node, rank });
  }
  out.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.node.name.length - b.node.name.length;
  });
  return out.slice(0, MAX_RESULTS).map((r) => r.node);
}

export function CommandPalette({ projectId }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openModal = useModalStore((s) => s.open);
  const expandNode = useCanvasViewStore((s) => s.expandNode);
  const rf = useReactFlow();

  // Only fetch nodes when the palette is open; on first open we rely on the
  // canvas page already having warmed Convex' query cache, so this is cheap.
  const nodes = useQuery(api.nodes.listByProject, open ? { projectId } : 'skip');

  const matches = useMemo(() => rankMatches(nodes ?? [], query), [nodes, query]);

  // Reset highlight whenever the visible match list shifts.
  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  // Global Cmd/Ctrl+K toggle. Esc closes. Don't intercept if the user is
  // typing in an input/textarea outside our palette — the palette's own
  // input lives inside this component and lets Esc reach us via the dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === 'k' || e.key === 'K')) {
        if (!open && isEditableTarget(e.target)) return;
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Reset query when the palette closes so the next open starts clean.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const selectNode = (node: Doc<'nodes'>) => {
    let parentId = node.parentId as Id<'nodes'> | undefined;
    const byId = new Map((nodes ?? []).map((item) => [item._id as string, item]));
    const seenParents = new Set<string>();
    while (parentId) {
      const key = parentId as string;
      if (seenParents.has(key)) break;
      seenParents.add(key);
      expandNode(projectId, parentId);
      const parent = byId.get(parentId as string);
      parentId = parent?.parentId as Id<'nodes'> | undefined;
    }
    try {
      // Center the camera on the node's position; React Flow handles the
      // animation. setCenter takes world coords, which is what we store.
      rf.setCenter(node.positionX, node.positionY, { zoom: 1, duration: 250 });
    } catch {
      // setCenter can throw if the canvas is mid-unmount; safe to ignore.
    }
    openModal(node._id);
    setOpen(false);
  };

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, matches.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const node = matches[highlight];
      if (node) selectNode(node);
    }
  };

  // Keep the highlighted row in view as the user arrows through results.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="top-[20%] max-w-md gap-0 p-0 sm:max-w-md">
        <div className="border-b border-border/60 p-3" onKeyDown={onListKeyDown}>
          <Input
            autoFocus
            placeholder="Search nodes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search nodes"
          />
        </div>
        <div
          ref={listRef}
          className="max-h-72 overflow-y-auto p-1"
          onKeyDown={onListKeyDown}
          tabIndex={-1}
        >
          {nodes === undefined ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No nodes match.</p>
          ) : (
            matches.map((node, i) => {
              const Icon = node.type === 'page' ? FileText : Square;
              const active = i === highlight;
              return (
                <button
                  key={node._id}
                  type="button"
                  data-index={i}
                  onClick={() => selectNode(node)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                    active ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/60',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{node.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {node.type}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
