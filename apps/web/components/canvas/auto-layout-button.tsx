'use client';

import { useEffect, useState } from 'react';
import { useMutation } from 'convex/react';
import { LayoutGrid } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { computeAutoLayout, type LayoutNodeInput } from '@/lib/auto-layout';
import { computeLayerLayout } from '@/lib/architecture-layers';

interface Props {
  nodes: Doc<'nodes'>[] | undefined;
  layers?: Doc<'projectLayers'>[] | undefined;
}

const STATUS_FADE_MS = 4000;

interface StatusMessage {
  kind: 'success' | 'failure';
  text: string;
}

export function AutoLayoutButton({ nodes, layers }: Props) {
  const updatePositionsMutation = useMutation(api.nodes.updatePositions);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  // Auto-dismiss the inline status pill after a moment so it doesn't sit
  // there forever once the user has read it.
  useEffect(() => {
    if (!status) return;
    const t = window.setTimeout(() => setStatus(null), STATUS_FADE_MS);
    return () => window.clearTimeout(t);
  }, [status]);

  const disabled = !nodes || nodes.length === 0 || running;

  const handleClick = async () => {
    if (!nodes || nodes.length === 0) return;
    setRunning(true);
    setStatus(null);

    try {
      const result =
        layers && layers.length > 0
          ? computeLayerLayout(layers, nodes)
          : computeAutoLayout(
              nodes.map(
                (n): LayoutNodeInput => ({
                  id: n._id as string,
                  type: n.type,
                  parentId: (n.parentId as string | undefined) ?? null,
                }),
              ),
            );

      const byId = new Map(nodes.map((n) => [n._id as string, n]));
      const updates: Array<{ id: Id<'nodes'>; positionX: number; positionY: number }> = [];
      for (const laid of result) {
        const current = byId.get(laid.id);
        if (!current) continue;
        if (current.positionX === laid.positionX && current.positionY === laid.positionY) {
          continue;
        }
        updates.push({
          id: laid.id as Id<'nodes'>,
          positionX: laid.positionX,
          positionY: laid.positionY,
        });
      }

      if (updates.length === 0) {
        setStatus({ kind: 'success', text: 'Already laid out.' });
        return;
      }

      const outcome = await updatePositionsMutation({ updates });
      setStatus({ kind: 'success', text: `Arranged ${outcome.updated} nodes.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[AutoLayout] aborted:', msg);
      setStatus({ kind: 'failure', text: 'Layer layout aborted. Check console.' });
    } finally {
      setRunning(false);
    }
  };

  const statusColor = status?.kind === 'failure' ? 'text-destructive' : 'text-zinc-400';

  return (
    <div className="flex items-center gap-2">
      {status && (
        <p className={`text-xs ${statusColor}`} role="status">
          {status.text}
        </p>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
        onClick={handleClick}
        disabled={disabled}
        aria-label="Arrange the canvas by layer"
        title="Arrange nodes inside their layers"
      >
        <LayoutGrid className="h-4 w-4" />
        {running ? 'Arranging...' : 'Layer Layout'}
      </Button>
    </div>
  );
}
