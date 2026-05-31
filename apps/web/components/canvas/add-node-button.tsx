'use client';

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import { useReactFlow } from '@xyflow/react';
import { ChevronDown, Plus } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AddFeatureDialog } from '@/components/canvas/add-feature-dialog';

interface Props {
  projectId: Id<'projects'>;
  nodes: Doc<'nodes'>[] | undefined;
}

export function AddNodeButton({ projectId, nodes }: Props) {
  const create = useMutation(api.nodes.create);
  const [featureDialogOpen, setFeatureDialogOpen] = useState(false);
  const rf = useReactFlow();

  const pageNodes = useMemo(() => (nodes ?? []).filter((n) => n.type === 'page'), [nodes]);
  const hasPages = pageNodes.length > 0;

  const handleAddPage = async () => {
    // Place the new page at the current viewport center so the user
    // doesn't have to chase a node spawned off-screen.
    const canvas = document.querySelector<HTMLElement>('.react-flow');
    const rect = canvas?.getBoundingClientRect();
    const center = rf.screenToFlowPosition({
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
    });
    await create({
      projectId,
      type: 'page',
      name: 'New page',
      positionX: Math.round(center.x),
      positionY: Math.round(center.y),
    });
  };

  return (
    <>
      <div className="inline-flex items-stretch">
        <Button
          size="sm"
          onClick={handleAddPage}
          className="rounded-r-none border-r border-primary-foreground/20"
        >
          <Plus className="mr-1 h-4 w-4" />
          Add Node
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="sm" className="rounded-l-none px-1.5" aria-label="More add options">
                <ChevronDown className="h-4 w-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleAddPage}>Add page</DropdownMenuItem>
            <DropdownMenuItem
              disabled={!hasPages}
              onClick={() => {
                if (hasPages) setFeatureDialogOpen(true);
              }}
            >
              Add feature…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AddFeatureDialog
        projectId={projectId}
        pageNodes={pageNodes}
        open={featureDialogOpen}
        onOpenChange={setFeatureDialogOpen}
      />
    </>
  );
}
