import { z } from 'zod';
import { kanbanStatusSchema } from './kanban';

const nodeIdSchema = z.string().min(1);
const taskIdSchema = z.string().min(1);

const namePattern = z.string().trim().min(1, 'name is required').max(80);
const descriptionPattern = z.string().max(4000).optional();
const pathPattern = z.string().trim().min(1).max(500);

export const listNodesInput = z.object({}).strict();

export const getNodeInput = z.object({ nodeId: nodeIdSchema }).strict();

export const createNodeInput = z
  .object({
    type: z.enum(['page', 'feature']),
    name: namePattern,
    parentId: z.string().optional(),
    description: descriptionPattern,
    files: z.array(pathPattern).optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
  })
  .strict();

export const updateNodeInput = z
  .object({
    nodeId: nodeIdSchema,
    name: namePattern.optional(),
    description: descriptionPattern,
    positionX: z.number().optional(),
    positionY: z.number().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      v.positionX !== undefined ||
      v.positionY !== undefined,
    { message: 'At least one field must be updated' },
  );

export const deleteNodeInput = z.object({ nodeId: nodeIdSchema }).strict();

export const linkFilesInput = z
  .object({
    nodeId: nodeIdSchema,
    paths: z.array(pathPattern).min(1, 'paths must not be empty'),
  })
  .strict();

export const addKanbanTaskInput = z
  .object({
    nodeId: nodeIdSchema,
    title: z.string().trim().min(1, 'title required').max(200),
    description: z.string().max(2000).optional(),
    status: kanbanStatusSchema.default('todo'),
  })
  .strict();

export const updateKanbanStatusInput = z
  .object({
    taskId: taskIdSchema,
    status: kanbanStatusSchema,
  })
  .strict();

export const logActivityInput = z
  .object({
    nodeId: nodeIdSchema,
    actor: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(2000),
    metadata: z.unknown().optional(),
  })
  .strict();

export const logActivityByFileInput = z
  .object({
    filePath: pathPattern,
    actor: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(2000),
    metadata: z.unknown().optional(),
  })
  .strict();
