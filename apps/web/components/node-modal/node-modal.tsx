'use client';

import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useModalStore } from '@/store/modal-store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DescriptionTab } from './description-tab';
import { LinkedFilesTab } from './linked-files-tab';
import { KanbanTab } from './kanban-tab';
import { ActivityTab } from './activity-tab';
import { DriftTab, useDriftCount } from './drift-tab';
import type { Id } from '../../../../convex/_generated/dataModel';

export function NodeModal() {
  const selectedNodeId = useModalStore((s) => s.selectedNodeId);
  const close = useModalStore((s) => s.close);
  const node = useQuery(api.nodes.get, selectedNodeId ? { id: selectedNodeId } : 'skip');

  const open = selectedNodeId !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{node?.name ?? 'Loading…'}</DialogTitle>
          <DialogDescription>Manage description, linked files, and kanban tasks.</DialogDescription>
        </DialogHeader>

        {selectedNodeId && node && (
          <NodeModalTabs
            nodeId={selectedNodeId}
            projectId={node.projectId}
            description={node.description ?? ''}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface NodeModalTabsProps {
  nodeId: Id<'nodes'>;
  projectId: Id<'projects'>;
  description: string;
}

/**
 * Inner tabs component. Split out so the Drift count hook only runs once we
 * know the projectId — `useDriftCount` calls `useQuery` and must be mounted
 * conditionally on having a real node, not on `selectedNodeId` alone.
 */
function NodeModalTabs({ nodeId, projectId, description }: NodeModalTabsProps) {
  const driftCount = useDriftCount(nodeId, projectId);

  return (
    <Tabs defaultValue="description" className="mt-2">
      <TabsList>
        <TabsTrigger value="description">Description</TabsTrigger>
        <TabsTrigger value="files">Linked files</TabsTrigger>
        <TabsTrigger value="kanban">Kanban</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="drift">
          Drift
          {driftCount > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive/10 px-1 text-[10px] font-semibold text-destructive">
              {driftCount}
            </span>
          )}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="description">
        <DescriptionTab nodeId={nodeId} description={description} />
      </TabsContent>
      <TabsContent value="files">
        <LinkedFilesTab nodeId={nodeId} />
      </TabsContent>
      <TabsContent value="kanban">
        <KanbanTab nodeId={nodeId} />
      </TabsContent>
      <TabsContent value="activity">
        <ActivityTab nodeId={nodeId} />
      </TabsContent>
      <TabsContent value="drift">
        <DriftTab nodeId={nodeId} projectId={projectId} />
      </TabsContent>
    </Tabs>
  );
}
