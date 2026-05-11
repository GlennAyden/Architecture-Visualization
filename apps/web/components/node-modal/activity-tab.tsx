'use client';

import { useQuery } from 'convex/react';
import { User, Bot, History } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';

interface Props {
  nodeId: Id<'nodes'>;
}

/**
 * Formats a Convex `_creationTime` (ms since epoch) as a relative-time
 * string like "3m ago". Falls back to absolute date if older than a week.
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

function actorIcon(actor: string) {
  if (actor.startsWith('mcp:')) return <Bot className="h-3.5 w-3.5" />;
  return <User className="h-3.5 w-3.5" />;
}

export function ActivityTab({ nodeId }: Props) {
  const entries = useQuery(api.activity.listByNode, { nodeId });

  if (entries === undefined) {
    return <p className="py-6 text-sm text-muted-foreground">Loading activity…</p>;
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <History className="h-4 w-4" />
        </div>
        <p className="text-sm font-medium">No activity yet</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          AI agents call <code className="font-mono text-[11px]">log_activity</code> via MCP after
          meaningful work on this node. Entries appear here newest first.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2 py-2">
      {entries.map((entry) => (
        <li
          key={entry._id}
          className="rounded-lg border border-border/60 bg-card p-3 text-sm transition-colors hover:border-border"
        >
          <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground/70">
              {actorIcon(entry.actor)}
              {entry.actor}
            </span>
            <span>{relativeTime(entry._creationTime)}</span>
          </div>
          <p className="whitespace-pre-wrap leading-snug">{entry.message}</p>
          {entry.metadata !== undefined && entry.metadata !== null && (
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted/50 p-2 text-[11px] leading-tight text-muted-foreground">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}
