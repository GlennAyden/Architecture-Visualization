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

// Features lost their "↳ parent" subtitle when rendered inside a cluster
// container (the container's title already shows the parent), so a single
// line of name is all the card has to fit — hence the slimmer dimensions.
// Standalone features (drill-down view, ad-hoc adds) still render fine at
// this size; the name field is capped at 80 chars by the Zod schema.
export const FEATURE_NODE_DEFAULT_WIDTH = 160;
export const FEATURE_NODE_DEFAULT_HEIGHT = 56;
