'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from 'convex/react';
import { ArrowLeft, Users } from 'lucide-react';
import { UserButton } from '@clerk/nextjs';

import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import { InviteMemberDialog } from '@/components/members/invite-member-dialog';
import { RevokeMemberDialog } from '@/components/members/revoke-member-dialog';

const MAX_MEMBERS = 3;

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

function StatusPill({ accepted }: { accepted: boolean }) {
  if (accepted) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Accepted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Pending
    </span>
  );
}

function MembersForProject({
  projectId,
  projectName,
  onRevoke,
}: {
  projectId: Id<'projects'>;
  projectName: string;
  onRevoke: (
    id: Id<'projectMembers'>,
    email: string,
    accepted: boolean,
  ) => void;
}) {
  const members = useQuery(api.projectMembers.listByProject, { projectId });
  const count = members?.length ?? 0;
  const atCap = count >= MAX_MEMBERS;

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm font-medium">{projectName}</div>
          <div className="text-xs text-muted-foreground">
            {members === undefined ? 'Loading…' : `${count} / ${MAX_MEMBERS} members`}
          </div>
        </div>
        <InviteMemberDialog
          projectId={projectId}
          projectName={projectName}
          disabled={atCap}
        />
      </div>

      {members === undefined && (
        <div className="px-4 py-6 text-sm text-muted-foreground">Loading…</div>
      )}

      {members && members.length === 0 && (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          No members yet. Invite a teammate by email — they need to have signed in to Arch Viz at
          least once.
        </div>
      )}

      {members && members.length > 0 && (
        <ul className="divide-y divide-border/60">
          {members.map((m) => {
            const accepted = m.acceptedAt !== undefined;
            return (
              <li key={m._id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{m.email}</span>
                    <StatusPill accepted={accepted} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Invited {relativeTime(m.invitedAt)}</span>
                    {accepted && m.acceptedAt !== undefined && (
                      <>
                        <span aria-hidden>·</span>
                        <span>Joined {relativeTime(m.acceptedAt)}</span>
                      </>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRevoke(m._id, m.email, accepted)}
                >
                  {accepted ? 'Remove' : 'Revoke'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function SettingsMembersPage() {
  const projects = useQuery(api.projects.list);
  const [revokeTarget, setRevokeTarget] = useState<{
    id: Id<'projectMembers'>;
    email: string;
    accepted: boolean;
  } | null>(null);

  const owned = projects?.filter((p) => p.role === 'owner');

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <BrandMark href="/projects" />
          <UserButton />
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
          <h1 className="text-3xl font-semibold tracking-tight">Members</h1>
          <p className="max-w-lg text-sm text-muted-foreground">
            Invite up to {MAX_MEMBERS} teammates per project. Members can edit the canvas — share
            links are for view-only access.
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
              <Users className="h-5 w-5" />
            </div>
            <h2 className="text-base font-medium">No projects to invite to</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <Link href="/projects" className="underline underline-offset-4">
                Create a project
              </Link>{' '}
              first to invite teammates.
            </p>
          </div>
        )}

        {owned && owned.length > 0 && (
          <div className="space-y-4">
            {owned.map((p) => (
              <MembersForProject
                key={p._id}
                projectId={p._id}
                projectName={p.name}
                onRevoke={(id, email, accepted) => setRevokeTarget({ id, email, accepted })}
              />
            ))}
          </div>
        )}
      </main>

      {revokeTarget && (
        <RevokeMemberDialog
          open
          onOpenChange={(open) => !open && setRevokeTarget(null)}
          memberId={revokeTarget.id}
          memberEmail={revokeTarget.email}
          accepted={revokeTarget.accepted}
        />
      )}
    </div>
  );
}
