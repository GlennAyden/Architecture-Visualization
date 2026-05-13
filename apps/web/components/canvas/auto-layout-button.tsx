'use client';

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { LayoutGrid } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { computeAutoLayout, type LayoutNodeInput } from '@/lib/auto-layout';

interface Props {
  nodes: Doc<'nodes'>[] | undefined;
}

export function AutoLayoutButton({ nodes }: Props) {
  const updateMutation = useMutation(api.nodes.update);
  const [running, setRunning] = useState(false);

  const disabled = !nodes || nodes.length === 0 || running;

  const handleClick = async () => {
    if (!nodes || nodes.length === 0) return;
    setRunning(true);
    try {
      const layoutInput: LayoutNodeInput[] = nodes.map((n) => ({
        id: n._id as string,
        type: n.type,
        parentId: (n.parentId as string | undefined) ?? null,
      }));
      const result = computeAutoLayout(layoutInput);

      // Only dispatch the mutation when a position actually changed —
      // saves a network round-trip per untouched node and keeps the
      // activity log from filling up with no-op moves.
      const byId = new Map(nodes.map((n) => [n._id as string, n]));
      const dispatches: Promise<unknown>[] = [];
      for (const laid of result) {
        const current = byId.get(laid.id);
        if (!current) continue;
        if (
          current.positionX === laid.positionX &&
          current.positionY === laid.positionY
        ) {
          continue;
        }
        dispatches.push(
          updateMutation({
            id: laid.id as Id<'nodes'>,
            positionX: laid.positionX,
            positionY: laid.positionY,
          }),
        );
      }
      await Promise.all(dispatches);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={disabled}
      aria-label="Auto-layout the canvas"
      title="Re-arrange all nodes into a clean tree layout"
    >
      <LayoutGrid className="h-4 w-4" />
      {running ? 'Arranging…' : 'Auto Layout'}
    </Button>
  );
}
