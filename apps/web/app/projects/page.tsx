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
    <div className="dark relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:44px_44px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_50%_0%,rgba(69,191,255,0.22),transparent_58%)]"
      />

      <header className="sticky top-0 z-10 border-b border-white/10 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-[52px] max-w-5xl items-center justify-between px-4 sm:px-6">
          <BrandMark className="text-foreground" />
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
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

      <main className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
              Workspace
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Projects</h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              Each project gets its own living architecture canvas.
            </p>
          </div>
          <CreateProjectDialog />
        </div>

        <InviteBanner />

        {projects === undefined && (
          <div className="rounded-lg border border-white/10 bg-card/70 p-8 text-sm text-muted-foreground shadow-2xl shadow-black/20">
            Loading projects…
          </div>
        )}

        {projects && projects.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/15 bg-card/70 p-10 text-center shadow-2xl shadow-black/20">
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
          <ul className="space-y-2">
            {projects.map((p) => (
              <li
                key={p._id}
                className="group flex items-center gap-2 rounded-xl border border-white/10 bg-card/70 px-4 py-3 shadow-2xl shadow-black/10 transition-colors hover:border-primary/35 hover:bg-muted/70"
              >
                <Link
                  href={`/canvas/${p._id}`}
                  className="flex flex-1 items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      {p.role === 'member' && (
                        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                          Member
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {p.slug}
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:text-primary group-hover:opacity-100" />
                </Link>
                {p.role === 'owner' && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Project actions"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setRenameTarget(p)}>Rename</DropdownMenuItem>
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
