'use client';

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Bot, Check, X } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';

interface Props {
  projectId: Id<'projects'>;
}

export function HermesInboxPanel({ projectId }: Props) {
  const pending = useQuery(api.codebaseSuggestions.listByProject, {
    projectId,
    status: 'pending',
  });
  const applied = useQuery(api.codebaseSuggestions.listByProject, {
    projectId,
    status: 'applied',
  });
  const apply = useMutation(api.codebaseSuggestions.apply);
  const reject = useMutation(api.codebaseSuggestions.reject);
  const [busyId, setBusyId] = useState<string | null>(null);
  const visiblePending = pending?.slice(0, 4) ?? [];
  const visibleApplied = applied?.slice(0, 3) ?? [];

  const handleApply = async (id: Id<'codebaseSuggestions'>) => {
    setBusyId(id);
    try {
      await apply({ id });
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id: Id<'codebaseSuggestions'>) => {
    setBusyId(id);
    try {
      await reject({ id });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-lg border border-white/10 bg-zinc-950/80 p-3 shadow-2xl shadow-black/30">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
          Hermes Inbox
        </h2>
        <Bot className="h-4 w-4 text-emerald-300" />
      </div>

      {pending === undefined ? (
        <p className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm text-zinc-500">
          Loading suggestions...
        </p>
      ) : visiblePending.length === 0 ? (
        <p className="rounded-md border border-dashed border-white/10 p-3 text-sm text-zinc-500">
          No pending suggestions.
        </p>
      ) : (
        <div className="space-y-2">
          {visiblePending.map((suggestion) => (
            <div
              key={suggestion._id}
              className="rounded-md border border-emerald-400/20 bg-emerald-400/5 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-100">
                    {suggestion.suggestedNodeName}
                  </p>
                  <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">
                    {suggestion.filePath}
                  </p>
                </div>
                <span className="shrink-0 rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200">
                  {Math.round(suggestion.confidence * 100)}%
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-cyan-200">{suggestion.layerName}</span>
                <span className="truncate text-zinc-500">{suggestion.reason}</span>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                  disabled={busyId !== null}
                  onClick={() => void handleApply(suggestion._id)}
                >
                  <Check className="h-3.5 w-3.5" />
                  Apply
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
                  disabled={busyId !== null}
                  onClick={() => void handleReject(suggestion._id)}
                >
                  <X className="h-3.5 w-3.5" />
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {visibleApplied.length > 0 && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Recent applied
          </p>
          <div className="space-y-1">
            {visibleApplied.map((suggestion) => (
              <div
                key={suggestion._id}
                className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1.5"
              >
                <span className="truncate text-xs text-zinc-300">
                  {suggestion.suggestedNodeName}
                </span>
                <span className="shrink-0 text-[11px] text-emerald-300">applied</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
