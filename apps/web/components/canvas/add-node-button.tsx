'use client';

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import type { Editor } from 'tldraw';
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
  editor: Editor | null;
  nodes: Doc<'nodes'>[] | undefined;
}

export function AddNodeButton({ projectId, editor, nodes }: Props) {
  const create = useMutation(api.nodes.create);
  const [featureDialogOpen, setFeatureDialogOpen] = useState(false);

  const pageNodes = useMemo(() => (nodes ?? []).filter((n) => n.type === 'page'), [nodes]);
  const hasPages = pageNodes.length > 0;

  const handleAddPage = async () => {
    const center = editor ? editor.screenToPage(editor.getViewportScreenCenter()) : { x: 0, y: 0 };
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
          Add page
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                className="rounded-l-none px-1.5"
                aria-label="More add options"
              >
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
