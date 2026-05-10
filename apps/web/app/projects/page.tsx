'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from 'convex/react';
import { MoreVertical } from 'lucide-react';
import { UserButton } from '@clerk/nextjs';

import { api } from '../../../../convex/_generated/api';
import type { Doc } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import { RenameProjectDialog } from '@/components/projects/rename-project-dialog';
import { DeleteProjectDialog } from '@/components/projects/delete-project-dialog';

export default function ProjectsPage() {
  const projects = useQuery(api.projects.list);
  const [renameTarget, setRenameTarget] = useState<Doc<'projects'> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Doc<'projects'> | null>(null);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="absolute right-4 top-4">
        <UserButton />
      </div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <CreateProjectDialog />
      </div>

      {projects === undefined && <p className="text-muted-foreground">Loading…</p>}
      {projects && projects.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No projects yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Create your first project to begin.</p>
          </CardContent>
        </Card>
      )}
      {projects && projects.length > 0 && (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p._id} className="flex items-center justify-between rounded-md border p-4">
              <Link href={`/canvas/${p._id}`} className="flex-1 hover:underline">
                {p.name}
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label="Project actions">
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
            </li>
          ))}
        </ul>
      )}

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
    </main>
  );
}
