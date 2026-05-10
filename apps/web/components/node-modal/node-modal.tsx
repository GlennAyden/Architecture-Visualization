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

        {selectedNodeId && (
          <Tabs defaultValue="description" className="mt-2">
            <TabsList>
              <TabsTrigger value="description">Description</TabsTrigger>
              <TabsTrigger value="files">Linked files</TabsTrigger>
              <TabsTrigger value="kanban">Kanban</TabsTrigger>
            </TabsList>
            <TabsContent value="description">
              <DescriptionTab nodeId={selectedNodeId} description={node?.description ?? ''} />
            </TabsContent>
            <TabsContent value="files">
              <LinkedFilesTab nodeId={selectedNodeId} />
            </TabsContent>
            <TabsContent value="kanban">
              <KanbanTab nodeId={selectedNodeId} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
