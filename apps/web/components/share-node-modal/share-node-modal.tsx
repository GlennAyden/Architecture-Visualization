'use client';

import { useQuery } from 'convex/react';
import { Bot, History, User } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { KANBAN_STATUSES, KANBAN_STATUS_LABEL, type KanbanStatus } from '@arch-viz/shared';
import { useModalStore } from '@/store/modal-store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Props {
  rawToken: string;
}

/**
 * Read-only sibling of `<NodeModal>`. Reads from the public `shareView`
 * endpoint and renders no edit affordances. Subscribes to the same Zustand
 * `useModalStore` that the page-node / feature-node shape utils dispatch
 * into on double-click — share-view double-clicks open this modal because
 * the owner `<NodeModal>` is not mounted on `/share/*`.
 */
export function ShareNodeModal({ rawToken }: Props) {
  const selectedNodeId = useModalStore((s) => s.selectedNodeId);
  const close = useModalStore((s) => s.close);
  const open = selectedNodeId !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl">
        {selectedNodeId ? (
          <ShareNodeModalBody rawToken={rawToken} nodeId={selectedNodeId} />
        ) : (
          <DialogHeader>
            <DialogTitle>Loading…</DialogTitle>
            <DialogDescription>Fetching node details.</DialogDescription>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface BodyProps {
  rawToken: string;
  nodeId: Id<'nodes'>;
}

function ShareNodeModalBody({ rawToken, nodeId }: BodyProps) {
  const detail = useQuery(api.shareView.getNodeDetail, { rawToken, nodeId });

  if (detail === undefined) {
    return (
      <DialogHeader>
        <DialogTitle>Loading…</DialogTitle>
        <DialogDescription>Fetching node details.</DialogDescription>
      </DialogHeader>
    );
  }

  if (detail === null) {
    return (
      <DialogHeader>
        <DialogTitle>Node unavailable</DialogTitle>
        <DialogDescription>
          This node is no longer accessible from this share link.
        </DialogDescription>
      </DialogHeader>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{detail.name}</DialogTitle>
        <DialogDescription>Read-only view: description, files, kanban, activity.</DialogDescription>
      </DialogHeader>

      <Tabs defaultValue="description" className="mt-2">
        <TabsList>
          <TabsTrigger value="description">Description</TabsTrigger>
          <TabsTrigger value="files">Linked files</TabsTrigger>
          <TabsTrigger value="kanban">Kanban</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="description">
          <DescriptionPanel description={detail.description} />
        </TabsContent>
        <TabsContent value="files">
          <FilesPanel files={detail.files} />
        </TabsContent>
        <TabsContent value="kanban">
          <KanbanPanel tasks={detail.kanbanTasks} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityPanel activity={detail.activity} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function DescriptionPanel({ description }: { description: string | null }) {
  if (!description || description.trim().length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">No description.</p>;
  }
  return (
    <p className="py-2 whitespace-pre-wrap text-sm leading-snug text-foreground">{description}</p>
  );
}

interface ShareFile {
  id: string;
  path: string;
}

function FilesPanel({ files }: { files: ShareFile[] }) {
  if (files.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">No linked files.</p>;
  }
  return (
    <ul className="space-y-1 py-2">
      {files.map((f) => (
        <li
          key={f.id}
          className="rounded-md border px-3 py-2 text-sm font-mono"
        >
          <span className="truncate">{f.path}</span>
        </li>
      ))}
    </ul>
  );
}

interface ShareKanbanTask {
  id: string;
  title: string;
  description: string | null;
  status: KanbanStatus;
  position: number;
}

const STATUS_DOT: Record<KanbanStatus, string> = {
  todo: 'bg-muted-foreground/40',
  doing: 'bg-primary',
  done: 'bg-emerald-500',
};

function KanbanPanel({ tasks }: { tasks: ShareKanbanTask[] }) {
  if (tasks.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">No kanban tasks.</p>;
  }
  return (
    <div className="grid grid-cols-3 gap-3 py-2">
      {KANBAN_STATUSES.map((status) => {
        const columnTasks = tasks.filter((t) => t.status === status);
        return (
          <div
            key={status}
            className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-2"
          >
            <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
              <span>{KANBAN_STATUS_LABEL[status]}</span>
              <span className="text-muted-foreground/60">{columnTasks.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {columnTasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-lg border border-border/60 bg-background p-2 text-sm shadow-sm"
                >
                  <span className="whitespace-pre-wrap leading-snug">{task.title}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface ShareActivityEntry {
  id: string;
  creationTime: number;
  actor: string;
  message: string;
  metadata: unknown;
}

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

function ActivityPanel({ activity }: { activity: ShareActivityEntry[] }) {
  if (activity.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <History className="h-4 w-4" />
        </div>
        <p className="text-sm font-medium">No activity yet.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2 py-2">
      {activity.map((entry) => (
        <li
          key={entry.id}
          className="rounded-lg border border-border/60 bg-card p-3 text-sm"
        >
          <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground/70">
              {actorIcon(entry.actor)}
              {entry.actor}
            </span>
            <span>{relativeTime(entry.creationTime)}</span>
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
