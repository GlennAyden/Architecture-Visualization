import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { ConvexMcpClient } from '../client.js';
import { loadConfig } from '../config.js';
import { progress, summary } from './output.js';

export interface PushSuggestionsArgs {
  fromJson: string;
}

interface PushSuggestionsResponse {
  accepted: number;
  pending: number;
  applied: number;
  ignored?: number;
  semanticPending?: number;
  semanticApplied?: number;
  relationshipPending?: number;
  relationshipApplied?: number;
  flowPending?: number;
  flowApplied?: number;
  skipped: Array<{ filePath: string; reason: string }>;
}

export interface PushSuggestionsClient {
  post(path: string, body: unknown): Promise<PushSuggestionsResponse>;
}

const suggestionSchema = z
  .object({
    filePath: z.string().trim().min(1).max(500),
    action: z
      .enum(['create_node', 'link_existing_node', 'group_into_node', 'ignore'])
      .default('create_node'),
    layerId: z.string().trim().min(1).optional(),
    targetNodeId: z.string().trim().min(1).optional(),
    groupKey: z.string().trim().min(1).max(160).optional(),
    suggestedNodeName: z.string().trim().min(1).max(80).optional(),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(1000),
    evidence: z.array(z.string().trim().min(1).max(240)).max(8).optional(),
    semanticKind: z
      .enum([
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
      ])
      .optional(),
    fileRole: z
      .enum([
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
      ])
      .optional(),
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

const relationshipSuggestionSchema = z
  .object({
    sourceNodeId: z.string().trim().min(1),
    targetNodeId: z.string().trim().min(1),
    type: z.enum([
      'dependency',
      'navigation',
      'data_flow',
      'contains',
      'uses',
      'triggers',
      'reads',
      'writes',
      'integrates',
    ]),
    label: z.string().trim().min(1).max(120).optional(),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(1000),
    evidence: z.array(z.string().trim().min(1).max(240)).max(8).optional(),
    source: z.string().trim().min(1).max(80).default('hermes'),
  })
  .strict()
  .refine((value) => value.sourceNodeId !== value.targetNodeId, {
    message: 'sourceNodeId and targetNodeId must differ',
  });

const flowEdgeRefSchema = z
  .object({
    edgeId: z.string().trim().min(1).optional(),
    sourceNodeId: z.string().trim().min(1).optional(),
    targetNodeId: z.string().trim().min(1).optional(),
    type: z
      .enum([
        'hierarchy',
        'dependency',
        'navigation',
        'data_flow',
        'contains',
        'uses',
        'triggers',
        'reads',
        'writes',
        'integrates',
      ])
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.edgeId) || Boolean(value.sourceNodeId && value.targetNodeId && value.type),
    { message: 'edgeRef requires edgeId or sourceNodeId/targetNodeId/type' },
  )
  .refine(
    (value) =>
      !value.sourceNodeId || !value.targetNodeId || value.sourceNodeId !== value.targetNodeId,
    { message: 'edgeRef sourceNodeId and targetNodeId must differ' },
  );

const flowStepSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(600),
    nodeIds: z.array(z.string().trim().min(1)).max(12).optional(),
    edgeRefs: z.array(flowEdgeRefSchema).max(20).optional(),
  })
  .strict();

const flowSuggestionSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    shortTitle: z.string().trim().min(1).max(64).optional(),
    goal: z.string().trim().min(1).max(240).optional(),
    importance: z.number().min(0).max(1).optional(),
    curationKey: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000),
    kind: z.enum([
      'user_journey',
      'system_process',
      'data_flow',
      'agent_workflow',
      'build_deploy',
      'integration',
    ]),
    nodeIds: z.array(z.string().trim().min(1)).min(2).max(40),
    edgeRefs: z.array(flowEdgeRefSchema).max(100).optional(),
    steps: z.array(flowStepSchema).min(1).max(12),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(1000),
    evidence: z.array(z.string().trim().min(1).max(240)).max(8).optional(),
    productArea: z.enum(['public', 'user', 'admin', 'extension', 'internal', 'unknown']).optional(),
    source: z.string().trim().min(1).max(80).default('hermes'),
  })
  .strict();

const semanticNodeSuggestionSchema = z
  .object({
    sourceFilePath: z.string().trim().min(1).max(500),
    semanticKey: z.string().trim().min(1).max(180),
    suggestedNodeName: z.string().trim().min(1).max(80),
    semanticKind: z.enum([
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
    ]),
    productArea: z
      .enum(['public', 'user', 'admin', 'extension', 'internal', 'unknown'])
      .default('unknown'),
    capabilityKey: z.string().trim().min(1).max(120).optional(),
    routeHint: z.string().trim().min(1).max(160).optional(),
    layerId: z.string().trim().min(1),
    parentNodeId: z.string().trim().min(1).optional(),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(1000),
    evidence: z.array(z.string().trim().min(1).max(240)).max(8).optional(),
    source: z.string().trim().min(1).max(80).default('hermes'),
  })
  .strict();

const pushSuggestionsSchema = z
  .object({
    runId: z.string().trim().min(1).optional(),
    suggestions: z.array(suggestionSchema).max(500).default([]),
    semanticNodeSuggestions: z.array(semanticNodeSuggestionSchema).max(500).default([]),
    relationshipSuggestions: z.array(relationshipSuggestionSchema).max(500).default([]),
    flowSuggestions: z.array(flowSuggestionSchema).max(100).default([]),
  })
  .strict()
  .refine(
    (value) =>
      value.suggestions.length > 0 ||
      value.semanticNodeSuggestions.length > 0 ||
      value.relationshipSuggestions.length > 0 ||
      value.flowSuggestions.length > 0,
    { message: 'At least one suggestion is required' },
  );

export function parsePushSuggestionsArgs(argv: string[]): PushSuggestionsArgs {
  const fromJsonIndex = argv.indexOf('--from-json');
  if (fromJsonIndex === -1) {
    throw new Error('push-suggestions requires --from-json <path>');
  }
  const fromJson = argv[fromJsonIndex + 1];
  if (!fromJson) {
    throw new Error('push-suggestions --from-json requires a path');
  }
  return { fromJson };
}

export function readSuggestionsPayload(path: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in ${path}: ${msg}`, { cause: err });
  }

  const validated = pushSuggestionsSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `Invalid suggestions payload: ${validated.error.issues[0]?.message ?? 'invalid'}`,
    );
  }
  return validated.data;
}

export async function runPushSuggestions(
  argv: string[] = [],
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
  injectedClient?: PushSuggestionsClient,
): Promise<number> {
  const args = parsePushSuggestionsArgs(argv);
  const config = loadConfig(env);
  const client = injectedClient ?? new ConvexMcpClient(config);
  const filePath = isAbsolute(args.fromJson) ? args.fromJson : resolve(cwd, args.fromJson);
  const payload = readSuggestionsPayload(filePath);

  progress(`[push-suggestions] project=${config.projectId}`);
  progress(
    `[push-suggestions] suggestions=${payload.suggestions.length}, semantic=${payload.semanticNodeSuggestions.length}, relationships=${payload.relationshipSuggestions.length}, flows=${payload.flowSuggestions.length}`,
  );

  const result = await client.post('/api/mcp/codebase_suggestions/push', payload);
  summary(
    `Suggestions: accepted ${result.accepted}, applied ${result.applied}, ` +
      `pending ${result.pending}, ignored ${result.ignored ?? 0}, ` +
      `semantic applied ${result.semanticApplied ?? 0}, ` +
      `semantic pending ${result.semanticPending ?? 0}, ` +
      `relationship applied ${result.relationshipApplied ?? 0}, ` +
      `relationship pending ${result.relationshipPending ?? 0}, ` +
      `flow applied ${result.flowApplied ?? 0}, ` +
      `flow pending ${result.flowPending ?? 0}, ` +
      `skipped ${result.skipped.length}.`,
  );
  return 0;
}
