'use client';

import { useMutation, useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';

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

export function InviteBanner() {
  const invites = useQuery(api.projectMembers.listInvitesForCurrentUser);
  const accept = useMutation(api.projectMembers.accept);
  const decline = useMutation(api.projectMembers.decline);

  if (!invites || invites.length === 0) return null;

  const onAccept = async (id: Id<'projectMembers'>) => {
    await accept({ id });
  };
  const onDecline = async (id: Id<'projectMembers'>) => {
    await decline({ id });
  };

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4 text-foreground">
      <p className="text-sm font-medium">
        {invites.length} invitation{invites.length > 1 ? 's' : ''} pending
      </p>
      <ul className="space-y-2">
        {invites.map((inv) => (
          <li
            key={inv._id}
            className="flex items-center justify-between gap-4 rounded-md bg-background/60 px-3 py-2"
          >
            <div className="min-w-0 text-sm">
              <span className="font-medium">{inv.projectName}</span>
              <span className="text-muted-foreground">
                {' '}
                · invited {relativeTime(inv.invitedAt)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => onAccept(inv._id)}>
                Accept
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDecline(inv._id)}>
                Decline
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
