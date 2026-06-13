'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from 'convex/react';
import { ArrowLeft, Link2 } from 'lucide-react';

import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import { LocalUserMenu } from '@/components/auth/local-user-menu';
import { CreateShareDialog } from '@/components/share/create-share-dialog';
import { ShareRevealDialog } from '@/components/share/share-reveal-dialog';
import { RevokeShareDialog } from '@/components/share/revoke-share-dialog';

/**
 * Formats a Convex `_creationTime` (ms since epoch) as a relative-time
 * string like "3m ago". Falls back to absolute date if older than a week.
 * Inlined per CLAUDE.md Rule 3 — mirrors activity/page.tsx.
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

type ShareState = 'active' | 'revoked' | 'expired';

function shareState(t: { revokedAt?: number; expiresAt?: number }): ShareState {
  if (t.revokedAt) return 'revoked';
  if (t.expiresAt !== undefined && t.expiresAt <= Date.now()) return 'expired';
  return 'active';
}

function StatePill({ state }: { state: ShareState }) {
  if (state === 'active') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
      {state === 'revoked' ? 'Revoked' : 'Expired'}
    </span>
  );
}

function ShareTokensForProject({
  projectId,
  projectName,
  onReveal,
  onRevoke,
}: {
  projectId: Id<'projects'>;
  projectName: string;
  onReveal: (raw: string, name: string) => void;
  onRevoke: (id: Id<'shareTokens'>, name: string) => void;
}) {
  const tokens = useQuery(api.shareTokens.listByProject, { projectId });

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm font-medium">{projectName}</div>
          <div className="text-xs text-muted-foreground">
            {tokens === undefined
              ? 'Loading…'
              : `${tokens.length} share link${tokens.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <CreateShareDialog projectId={projectId} projectName={projectName} onCreated={onReveal} />
      </div>

      {tokens === undefined && (
        <div className="px-4 py-6 text-sm text-muted-foreground">Loading…</div>
      )}

      {tokens && tokens.length === 0 && (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          No share links yet. A share link lets anyone with the URL view this canvas in read-only
          mode.
        </div>
      )}

      {tokens && tokens.length > 0 && (
        <ul className="divide-y divide-border/60">
          {tokens.map((t) => {
            const state = shareState(t);
            return (
              <li key={t._id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.name}</span>
                    <StatePill state={state} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Created {relativeTime(t._creationTime)}</span>
                    {t.expiresAt !== undefined && (
                      <>
                        <span aria-hidden>·</span>
                        <span>
                          {t.expiresAt <= Date.now()
                            ? `Expired ${relativeTime(t.expiresAt)}`
                            : `Expires ${new Date(t.expiresAt).toLocaleDateString()}`}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {state === 'active' && (
                  <Button variant="outline" size="sm" onClick={() => onRevoke(t._id, t.name)}>
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function SettingsSharePage() {
  const projects = useQuery(api.projects.list);
  const [reveal, setReveal] = useState<{ rawToken: string; name: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{
    id: Id<'shareTokens'>;
    name: string;
  } | null>(null);

  const owned = projects?.filter((p) => p.role === 'owner');

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <BrandMark href="/projects" />
          <LocalUserMenu />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8 space-y-1.5">
          <div className="flex items-center gap-2">
            <Link
              href="/projects"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              Projects
            </Link>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Share links</h1>
          <p className="max-w-lg text-sm text-muted-foreground">
            Mint a URL that anyone can use to view one of your projects read-only. Each link can be
            revoked or set to auto-expire.
          </p>
        </div>

        {projects === undefined && (
          <div className="rounded-lg border border-border/60 bg-card p-8 text-sm text-muted-foreground">
            Loading…
          </div>
        )}

        {owned && owned.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
            <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Link2 className="h-5 w-5" />
            </div>
            <h2 className="text-base font-medium">No projects to share</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <Link href="/projects" className="underline underline-offset-4">
                Create a project
              </Link>{' '}
              first to share it.
            </p>
          </div>
        )}

        {owned && owned.length > 0 && (
          <div className="space-y-4">
            {owned.map((p) => (
              <ShareTokensForProject
                key={p._id}
                projectId={p._id}
                projectName={p.name}
                onReveal={(rawToken, name) => setReveal({ rawToken, name })}
                onRevoke={(id, name) => setRevokeTarget({ id, name })}
              />
            ))}
          </div>
        )}
      </main>

      {reveal && (
        <ShareRevealDialog
          open
          onOpenChange={(open) => !open && setReveal(null)}
          rawToken={reveal.rawToken}
          shareName={reveal.name}
        />
      )}
      {revokeTarget && (
        <RevokeShareDialog
          open
          onOpenChange={(open) => !open && setRevokeTarget(null)}
          shareId={revokeTarget.id}
          shareName={revokeTarget.name}
        />
      )}
    </div>
  );
}
