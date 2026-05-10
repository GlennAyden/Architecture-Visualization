import { z } from 'zod';

export const kanbanStatusSchema = z.union([
  z.literal('todo'),
  z.literal('doing'),
  z.literal('done'),
]);
export type KanbanStatus = z.infer<typeof kanbanStatusSchema>;

export const KANBAN_STATUSES: ReadonlyArray<KanbanStatus> = ['todo', 'doing', 'done'];

export const KANBAN_STATUS_LABEL: Record<KanbanStatus, string> = {
  todo: 'To do',
  doing: 'Doing',
  done: 'Done',
};

export const taskTitleSchema = z
  .string()
  .trim()
  .min(1, 'Task title is required')
  .max(200, 'Task title must be 200 characters or fewer');

export const taskDescriptionSchema = z.string().max(2000, '2000 characters max').optional();

export const nodeDescriptionSchema = z
  .string()
  .max(4000, 'Description must be 4000 characters or fewer');
