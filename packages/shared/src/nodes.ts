import { z } from 'zod';

export const nodeNameSchema = z
  .string()
  .trim()
  .min(1, 'Node name is required')
  .max(80, 'Node name must be 80 characters or fewer');

export type NodeName = z.infer<typeof nodeNameSchema>;

export const nodeTypeSchema = z.union([z.literal('page'), z.literal('feature')]);
export type NodeType = z.infer<typeof nodeTypeSchema>;

export const PAGE_NODE_DEFAULT_WIDTH = 220;
export const PAGE_NODE_DEFAULT_HEIGHT = 96;

export const FEATURE_NODE_DEFAULT_WIDTH = 180;
export const FEATURE_NODE_DEFAULT_HEIGHT = 72;
