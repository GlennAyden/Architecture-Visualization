'use client';

import { useMutation } from 'convex/react';
import type { Editor } from 'tldraw';
import { Plus } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';

interface Props {
  projectId: Id<'projects'>;
  editor: Editor | null;
}

export function AddPageButton({ projectId, editor }: Props) {
  const create = useMutation(api.nodes.create);

  const onClick = async () => {
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
    <Button size="sm" onClick={onClick}>
      <Plus className="mr-1 h-4 w-4" />
      Add page
    </Button>
  );
}
