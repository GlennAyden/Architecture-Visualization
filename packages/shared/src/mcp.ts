import { z } from 'zod';
import { kanbanStatusSchema } from './kanban';

const nodeIdSchema = z.string().min(1);
const taskIdSchema = z.string().min(1);

const namePattern = z.string().trim().min(1, 'name is required').max(80);
const descriptionPattern = z.string().max(4000).optional();
const pathPattern = z.string().trim().min(1).max(500);
const evidenceSchema = z.array(z.string().trim().min(1).max(240)).max(8);

export const listNodesInput = z.object({}).strict();
export const listLayersInput = z.object({}).strict();

export const getNodeInput = z.object({ nodeId: nodeIdSchema }).strict();

export const createNodeInput = z
  .object({
    type: z.enum(['page', 'feature']),
    name: namePattern,
    layerId: z.string().optional(),
    parentId: z.string().optional(),
    description: descriptionPattern,
    files: z.array(pathPattern).optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
  })
  .strict();

// Metadata is a free-form JSON object used for Sprint 3 heuristic edges:
// `route` (string) feeds the navigation walker (`<Link href=>`); `apiPaths`
// (string[]) feeds the data-flow walker (`fetch('/api/...')`). Other fields
// are reserved for future heuristics — keep the shape open.
export const updateNodeInput = z
  .object({
    nodeId: nodeIdSchema,
    name: namePattern.optional(),
    description: descriptionPattern,
    positionX: z.number().optional(),
    positionY: z.number().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      v.positionX !== undefined ||
      v.positionY !== undefined ||
      v.metadata !== undefined,
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

// Sprint 2 — auto-link by import analysis. Hook / CLI passes a single origin
// (the file just edited) plus the resolved import targets. Server looks up
// the nodes that own the origin and link_files-deduplicates the imports onto
// the same nodes. Cap 20 imports per call so a runaway parse can't fan out.
export const autoLinkImportsInput = z
  .object({
    originFilePath: pathPattern,
    importedFilePaths: z.array(pathPattern).min(1).max(20),
  })
  .strict();

// Sprint 5 item J — bulk lookup of file paths against the project's
// nodeFiles set. Called by the post-commit hook to surface unlinked files
// as candidate nodes. Cap 500 so a giant rename commit doesn't fan out.
export const lookupFilesInput = z
  .object({
    paths: z.array(pathPattern).min(1).max(500),
  })
  .strict();

// Sprint 2 — orphan/drift scan snapshot push. Caller is the CLI; the server
// stores the most recent payload per (projectId, kind). Payload shape is
// open-ended on purpose (validated client-side); we cap size at 1MB at the
// HTTP layer so a misbehaving CLI can't fill the table.
const scanKindSchema = z.enum(['orphans', 'drift']);
export const scanFileKindSchema = z.enum([
  'component',
  'api',
  'convex',
  'mcp',
  'config',
  'test',
  'generated',
  'script',
  'unknown',
]);

export const scanSnapshotPushInput = z
  .object({
    kind: scanKindSchema,
    data: z.unknown(),
  })
  .strict();

export const scanSnapshotGetInput = z
  .object({
    kind: scanKindSchema,
  })
  .strict();

export const codebaseSuggestionActionSchema = z.enum([
  'create_node',
  'link_existing_node',
  'group_into_node',
  'ignore',
]);

const codebaseSuggestionSchema = z
  .object({
    filePath: pathPattern,
    action: codebaseSuggestionActionSchema.default('create_node'),
    layerId: z.string().trim().min(1).optional(),
    targetNodeId: z.string().trim().min(1).optional(),
    groupKey: z.string().trim().min(1).max(160).optional(),
    suggestedNodeName: namePattern.optional(),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(1, 'reason is required').max(1000),
    evidence: evidenceSchema.optional(),
    source: z.string().trim().min(1).max(80).default('hermes'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.action === 'create_node' || value.action === 'group_into_node') && !value.layerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['layerId'],
        message: 'layerId is required for create_node and group_into_node',
      });
    }
    if (value.action === 'link_existing_node' && !value.targetNodeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetNodeId'],
        message: 'targetNodeId is required for link_existing_node',
      });
    }
    if (value.action === 'group_into_node' && !value.groupKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['groupKey'],
        message: 'groupKey is required for group_into_node',
      });
    }
  });

export const pushCodebaseSuggestionsInput = z
  .object({
    runId: z.string().trim().min(1).optional(),
    suggestions: z.array(codebaseSuggestionSchema).min(1).max(500),
  })
  .strict();

export const hermesMappingRunCompleteInput = z
  .object({
    runId: z.string().trim().min(1),
    submitToken: z.string().trim().min(32),
    status: z.enum(['completed', 'failed']),
    errorMessage: z.string().trim().min(1).max(1000).optional(),
    suggestions: z.array(codebaseSuggestionSchema).max(500).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'failed' && !value.errorMessage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['errorMessage'],
        message: 'errorMessage is required for failed runs',
      });
    }
  });

// Sprint 3 — non-hierarchy edge types. Hierarchy is auto-mirrored from
// `parentId` and never manipulated through these endpoints.
export const manualEdgeTypeSchema = z.enum(['dependency', 'navigation', 'data_flow']);

// AI/user-driven edge creation. Reconciles "manually classified" relations
// the import scanner can't see (cross-language, cross-process).
export const linkNodesInput = z
  .object({
    sourceNodeId: nodeIdSchema,
    targetNodeId: nodeIdSchema,
    type: manualEdgeTypeSchema,
  })
  .strict()
  .refine((v) => v.sourceNodeId !== v.targetNodeId, {
    message: 'source and target must differ',
  });

export const unlinkNodesInput = linkNodesInput;

// CLI reconcile payload from `arch-viz-mcp scan-imports`. Server diffs each
// (type, projectId) tuple against the auto-inserted rows and converges.
// Manual edges (source='manual') survive the reconcile because they encode
// classifications the import graph can't observe.
const reconcileEdgeEntry = z
  .object({
    sourceNodeId: nodeIdSchema,
    targetNodeId: nodeIdSchema,
    type: manualEdgeTypeSchema,
  })
  .strict();

export const reconcileEdgesInput = z
  .object({
    edges: z.array(reconcileEdgeEntry).max(2000),
  })
  .strict();
