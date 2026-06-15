import { z } from 'zod';

export const nodeNameSchema = z
  .string()
  .trim()
  .min(1, 'Node name is required')
  .max(80, 'Node name must be 80 characters or fewer');

export type NodeName = z.infer<typeof nodeNameSchema>;

export const nodeTypeSchema = z.union([z.literal('page'), z.literal('feature')]);
export type NodeType = z.infer<typeof nodeTypeSchema>;

export const layerPurposeSchema = z.enum([
  'surfaces',
  'ui_modules',
  'capabilities',
  'application',
  'backend',
  'data',
  'agents',
  'infra',
  'external',
  'custom',
]);
export type LayerPurpose = z.infer<typeof layerPurposeSchema>;

export const nodeSemanticKindSchema = z.enum([
  'surface',
  'ui_module',
  'capability',
  'api',
  'data_logic',
  'agent',
  'worker',
  'storage',
  'external_service',
  'config',
  'test_harness',
  'unknown',
]);
export type NodeSemanticKind = z.infer<typeof nodeSemanticKindSchema>;

export const productAreaSchema = z.enum([
  'public',
  'user',
  'admin',
  'extension',
  'internal',
  'unknown',
]);
export type ProductArea = z.infer<typeof productAreaSchema>;

export const linkedFileRoleSchema = z.enum([
  'primary',
  'ui',
  'route',
  'api',
  'schema',
  'query',
  'mutation',
  'worker',
  'config',
  'test',
  'support',
]);
export type LinkedFileRole = z.infer<typeof linkedFileRoleSchema>;

export const mappingStatusSchema = z.enum([
  'manual',
  'suggested',
  'auto_mapped',
  'verified',
  'ignored',
  'drifted',
]);
export type MappingStatus = z.infer<typeof mappingStatusSchema>;

export const PAGE_NODE_DEFAULT_WIDTH = 220;
export const PAGE_NODE_DEFAULT_HEIGHT = 96;

// Features lost their "↳ parent" subtitle when rendered inside a cluster
// container (the container's title already shows the parent), so a single
// line of name is all the card has to fit — hence the slimmer dimensions.
// Standalone features (drill-down view, ad-hoc adds) still render fine at
// this size; the name field is capped at 80 chars by the Zod schema.
export const FEATURE_NODE_DEFAULT_WIDTH = 160;
export const FEATURE_NODE_DEFAULT_HEIGHT = 56;
