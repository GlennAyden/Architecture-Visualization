'use client';

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Plus, MoreVertical } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { KANBAN_STATUSES, KANBAN_STATUS_LABEL, type KanbanStatus } from '@arch-viz/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  nodeId: Id<'nodes'>;
}

export function KanbanTab({ nodeId }: Props) {
  const tasks = useQuery(api.kanban.listByNode, { nodeId });

  return (
    <div className="grid grid-cols-3 gap-3 py-2">
      {KANBAN_STATUSES.map((status) => (
        <Column
          key={status}
          nodeId={nodeId}
          status={status}
          tasks={(tasks ?? []).filter((t) => t.status === status)}
        />
      ))}
    </div>
  );
}

interface ColumnProps {
  nodeId: Id<'nodes'>;
  status: KanbanStatus;
  tasks: Doc<'kanbanTasks'>[];
}

const STATUS_DOT: Record<KanbanStatus, string> = {
  todo: 'bg-muted-foreground/40',
  doing: 'bg-primary',
  done: 'bg-emerald-500',
};

function Column({ nodeId, status, tasks }: ColumnProps) {
  const create = useMutation(api.kanban.create);
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const onAdd = async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    await create({ nodeId, title: trimmed, status });
    setTitle('');
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-2">
      <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
        <span>{KANBAN_STATUS_LABEL[status]}</span>
        <span className="text-muted-foreground/60">{tasks.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {tasks.map((task) => (
          <TaskCard key={task._id} task={task} />
        ))}
      </div>
      {adding ? (
        <div className="space-y-2">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAdd();
              } else if (e.key === 'Escape') {
                setAdding(false);
                setTitle('');
              }
            }}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={onAdd}>
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setTitle('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-muted-foreground"
          onClick={() => setAdding(true)}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add task
        </Button>
      )}
    </div>
  );
}

interface TaskCardProps {
  task: Doc<'kanbanTasks'>;
}

function TaskCard({ task }: TaskCardProps) {
  const update = useMutation(api.kanban.update);
  const remove = useMutation(api.kanban.remove);

  return (
    <div className="group rounded-lg border border-border/60 bg-background p-2 text-sm shadow-sm transition-colors hover:border-border">
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 whitespace-pre-wrap leading-snug">{task.title}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="Task actions" className="h-6 w-6">
                <MoreVertical className="h-3 w-3" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {KANBAN_STATUSES.filter((s) => s !== task.status).map((target) => (
              <DropdownMenuItem
                key={target}
                onClick={() => update({ id: task._id, status: target })}
              >
                Move to {KANBAN_STATUS_LABEL[target]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => remove({ id: task._id })}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
