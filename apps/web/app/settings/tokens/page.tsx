'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from 'convex/react';
import { UserButton } from '@clerk/nextjs';

import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <main className="mx-auto max-w-3xl p-8">
      <div className="absolute right-4 top-4">
        <UserButton />
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">API tokens</h1>
          <p className="text-sm text-muted-foreground">
            Used by MCP clients (Claude Code, Codex, Cursor) to update the canvas.{' '}
            <Link href="/projects" className="underline">
              Back to projects
            </Link>
          </p>
        </div>
        <CreateTokenDialog
          onCreated={(rawToken, name) => setReveal({ rawToken, name })}
        />
      </div>

      {tokens === undefined && <p className="text-muted-foreground">Loading…</p>}
      {tokens && tokens.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No tokens yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Create a project first, then issue a token to let an MCP client write to its canvas.
            </p>
          </CardContent>
        </Card>
      )}
      {tokens && tokens.length > 0 && (
        <ul className="space-y-2">
          {tokens.map((t) => (
            <li
              key={t._id}
              className="flex items-center justify-between rounded-md border p-4"
            >
              <div className="space-y-1">
                <div className="font-medium">
                  {t.name}
                  {t.revokedAt && (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                      revoked
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Project: {t.projectName} · Last used:{' '}
                  {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'never'}
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
    </main>
  );
}
