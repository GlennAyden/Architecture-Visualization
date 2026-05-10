'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from 'convex/react';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { UserButton } from '@clerk/nextjs';

import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import { CreateTokenDialog } from '@/components/tokens/create-token-dialog';
import { TokenRevealDialog } from '@/components/tokens/token-reveal-dialog';
import { RevokeTokenDialog } from '@/components/tokens/revoke-token-dialog';

export default function TokensPage() {
  const tokens = useQuery(api.apiTokens.list);
  const [reveal, setReveal] = useState<{ rawToken: string; name: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{
    id: Id<'apiTokens'>;
    name: string;
  } | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <BrandMark href="/projects" />
          <UserButton />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Link
                href="/projects"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-3 w-3" />
                Projects
              </Link>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">API tokens</h1>
            <p className="max-w-lg text-sm text-muted-foreground">
              Used by MCP clients (Claude Code, Codex, Cursor) to update a project canvas. Each
              token is scoped to one project.
            </p>
          </div>
          <CreateTokenDialog
            onCreated={(rawToken, name) => setReveal({ rawToken, name })}
          />
        </div>

        {tokens === undefined && (
          <div className="rounded-lg border border-border/60 bg-card p-8 text-sm text-muted-foreground">
            Loading tokens…
          </div>
        )}

        {tokens && tokens.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
            <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <KeyRound className="h-5 w-5" />
            </div>
            <h2 className="text-base font-medium">No tokens yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a project first, then issue a token to let an MCP client write to its canvas.
            </p>
          </div>
        )}

        {tokens && tokens.length > 0 && (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
            {tokens.map((t) => (
              <li key={t._id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.name}</span>
                    {t.revokedAt ? (
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Revoked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        Active
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Project: {t.projectName}</span>
                    <span aria-hidden>·</span>
                    <span>
                      Last used:{' '}
                      {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'never'}
                    </span>
                  </div>
                </div>
                {!t.revokedAt && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRevokeTarget({ id: t._id, name: t.name })}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>

      {reveal && (
        <TokenRevealDialog
          open
          onOpenChange={(open) => !open && setReveal(null)}
          rawToken={reveal.rawToken}
          tokenName={reveal.name}
        />
      )}
      {revokeTarget && (
        <RevokeTokenDialog
          open
          onOpenChange={(open) => !open && setRevokeTarget(null)}
          tokenId={revokeTarget.id}
          tokenName={revokeTarget.name}
        />
      )}
    </div>
  );
}
