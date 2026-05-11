'use client';

import { useEffect } from 'react';
import { useQuery } from 'convex/react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bot, ChevronLeft, History, User } from 'lucide-react';

import { api } from '../../../../../../convex/_generated/api';
import type { Id } from '../../../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';

/**
 * Formats a Convex `_creationTime` (ms since epoch) as a relative-time
 * string like "3m ago". Falls back to absolute date if older than a week.
 * Mirrors the helper in components/node-modal/activity-tab.tsx.
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

export default function ProjectActivityPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId as Id<'projects'>;
  const project = useQuery(api.projects.get, { id: projectId });
  const entries = useQuery(api.activity.listByProject, { projectId });

  // Redirect when the project is gone (e.g. cascade-deleted in another tab).
  useEffect(() => {
    if (project === null) router.replace('/projects');
  }, [project, router]);

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
            <History className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Activity feed</h2>
            <p className="text-sm text-muted-foreground">
              Newest entries across every node in this project.
            </p>
          </div>
        </div>

        {entries === undefined ? (
          <p className="py-6 text-sm text-muted-foreground">Loading activity…</p>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 py-12 text-center">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <History className="h-4 w-4" />
            </div>
            <p className="text-sm font-medium">No activity yet</p>
            <p className="max-w-md text-xs text-muted-foreground">
              AI agents log entries via the{' '}
              <code className="font-mono text-[11px]">log_activity</code> MCP tool.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li
                key={entry._id}
                className="rounded-lg border border-border/60 bg-card p-3 text-sm transition-colors hover:border-border"
              >
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground/70">
                      {actorIcon(entry.actor)}
                      {entry.actor}
                    </span>
                    <span className="text-muted-foreground/60">on</span>
                    <Link
                      href={`/canvas/${projectId}?node=${entry.nodeId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {entry.nodeName}
                    </Link>
                  </div>
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
        )}
      </div>
    </main>
  );
}
