'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from 'convex/react';
import { MoreVertical, ArrowUpRight, Settings } from 'lucide-react';
import { UserButton } from '@clerk/nextjs';

import { api } from '../../../../convex/_generated/api';
import type { Doc } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import { RenameProjectDialog } from '@/components/projects/rename-project-dialog';
import { DeleteProjectDialog } from '@/components/projects/delete-project-dialog';
import { InviteBanner } from '@/components/projects/invite-banner';

export default function ProjectsPage() {
  const projects = useQuery(api.projects.list);
  const [renameTarget, setRenameTarget] = useState<Doc<'projects'> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Doc<'projects'> | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <BrandMark />
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={
                <Link href="/settings/tokens">
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
              }
            />
            <UserButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
            <p className="text-sm text-muted-foreground">
              Each project gets its own living architecture canvas.
            </p>
          </div>
          <CreateProjectDialog />
        </div>

        <InviteBanner />

        {projects === undefined && (
          <div className="rounded-lg border border-border/60 bg-card p-8 text-sm text-muted-foreground">
            Loading projects…
          </div>
        )}

        {projects && projects.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
            <h2 className="text-base font-medium">No projects yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first project to begin mapping your architecture.
            </p>
            <div className="mt-6">
              <CreateProjectDialog />
            </div>
          </div>
        )}

        {projects && projects.length > 0 && (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
            {projects.map((p) => (
              <li
                key={p._id}
                className="group flex items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <Link
                  href={`/canvas/${p._id}`}
                  className="flex flex-1 items-center justify-between gap-3"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium">{p.name}</div>
                      {p.role === 'member' && (
                        <span className="inline-flex items-center rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                          Member
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">{p.slug}</div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
                {p.role === 'owner' && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon" aria-label="Project actions">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setRenameTarget(p)}>
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setDeleteTarget(p)}
                        className="text-destructive"
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>

      {renameTarget && (
        <RenameProjectDialog
          projectId={renameTarget._id}
          currentName={renameTarget.name}
          open
          onOpenChange={(open) => !open && setRenameTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteProjectDialog
          projectId={deleteTarget._id}
          projectName={deleteTarget.name}
          open
          onOpenChange={(open) => !open && setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
