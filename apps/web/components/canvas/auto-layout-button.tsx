'use client';

import { useEffect, useState } from 'react';
import { useMutation } from 'convex/react';
import { LayoutGrid } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { computeAutoLayout, type LayoutNodeInput } from '@/lib/auto-layout';

interface Props {
  nodes: Doc<'nodes'>[] | undefined;
}

// Inter-mutation delay. Spreads the burst that the previous Promise.all
// implementation would fire at the server in a single tick. With Clerk
// running on dev keys (strict rate limits on identity refresh), bursting
// 24+ authenticated mutations in parallel reliably tripped the throttle
// and silently aborted the whole batch. Sequencing them at 60ms apart
// gives Clerk's JWT cache room to breathe while still finishing a full
// re-layout in well under 2 seconds for the projects we care about.
const DISPATCH_INTERVAL_MS = 60;
const STATUS_FADE_MS = 4000;

interface StatusMessage {
  kind: 'success' | 'partial' | 'failure';
  text: string;
}

export function AutoLayoutButton({ nodes }: Props) {
  const updateMutation = useMutation(api.nodes.update);
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
      const layoutInput: LayoutNodeInput[] = nodes.map((n) => ({
        id: n._id as string,
        type: n.type,
        parentId: (n.parentId as string | undefined) ?? null,
      }));
      const result = computeAutoLayout(layoutInput);

      const byId = new Map(nodes.map((n) => [n._id as string, n]));
      const tasks: Array<{ id: Id<'nodes'>; positionX: number; positionY: number }> = [];
      for (const laid of result) {
        const current = byId.get(laid.id);
        if (!current) continue;
        if (
          current.positionX === laid.positionX &&
          current.positionY === laid.positionY
        ) {
          continue;
        }
        tasks.push({
          id: laid.id as Id<'nodes'>,
          positionX: laid.positionX,
          positionY: laid.positionY,
        });
      }

      if (tasks.length === 0) {
        setStatus({ kind: 'success', text: 'Already laid out.' });
        return;
      }

      // Sequenced dispatch with allSettled — a single failure no longer
      // poisons the batch. Each mutation is its own promise; we collect
      // outcomes and surface the partial-success state to the user.
      const dispatched: Array<Promise<unknown>> = [];
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (!t) continue;
        const promise =
          i === 0
            ? updateMutation(t)
            : new Promise((resolve) => window.setTimeout(resolve, DISPATCH_INTERVAL_MS)).then(
                () => updateMutation(t),
              );
        dispatched.push(promise);
      }

      const outcomes = await Promise.allSettled(dispatched);
      const failed = outcomes.filter((o) => o.status === 'rejected').length;
      const ok = outcomes.length - failed;

      if (failed === 0) {
        setStatus({ kind: 'success', text: `Arranged ${ok} nodes.` });
        return;
      }

      // Log the first few failures to the console so the user can dig in
      // via DevTools if they want; the UI just carries the count.
      const sample = outcomes
        .filter((o): o is PromiseRejectedResult => o.status === 'rejected')
        .slice(0, 3)
        .map((o) => (o.reason instanceof Error ? o.reason.message : String(o.reason)));
      console.warn('[AutoLayout] partial failures:', sample);

      setStatus({
        kind: failed === outcomes.length ? 'failure' : 'partial',
        text:
          failed === outcomes.length
            ? `All ${failed} updates failed. Check console / try again.`
            : `${ok} of ${outcomes.length} nodes arranged. ${failed} failed — try again.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[AutoLayout] aborted:', msg);
      setStatus({ kind: 'failure', text: 'Auto layout aborted. Check console.' });
    } finally {
      setRunning(false);
    }
  };

  const statusColor =
    status?.kind === 'failure'
      ? 'text-destructive'
      : status?.kind === 'partial'
        ? 'text-amber-600'
        : 'text-muted-foreground';

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
        onClick={handleClick}
        disabled={disabled}
        aria-label="Auto-layout the canvas"
        title="Re-arrange all nodes into a clean tree layout"
      >
        <LayoutGrid className="h-4 w-4" />
        {running ? 'Arranging…' : 'Auto Layout'}
      </Button>
    </div>
  );
}
