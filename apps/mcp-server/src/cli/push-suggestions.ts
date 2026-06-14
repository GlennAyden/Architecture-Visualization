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
  relationshipPending?: number;
  relationshipApplied?: number;
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
    type: z.enum(['dependency', 'navigation', 'data_flow']),
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

const pushSuggestionsSchema = z
  .object({
    runId: z.string().trim().min(1).optional(),
    suggestions: z.array(suggestionSchema).max(500).default([]),
    relationshipSuggestions: z.array(relationshipSuggestionSchema).max(500).default([]),
  })
  .strict()
  .refine((value) => value.suggestions.length > 0 || value.relationshipSuggestions.length > 0, {
    message: 'At least one suggestion is required',
  });

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
    `[push-suggestions] suggestions=${payload.suggestions.length}, relationships=${payload.relationshipSuggestions.length}`,
  );

  const result = await client.post('/api/mcp/codebase_suggestions/push', payload);
  summary(
    `Suggestions: accepted ${result.accepted}, applied ${result.applied}, ` +
      `pending ${result.pending}, ignored ${result.ignored ?? 0}, ` +
      `relationship applied ${result.relationshipApplied ?? 0}, ` +
      `relationship pending ${result.relationshipPending ?? 0}, ` +
      `skipped ${result.skipped.length}.`,
  );
  return 0;
}
