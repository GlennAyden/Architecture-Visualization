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

const pushSuggestionsSchema = z
  .object({
    runId: z.string().trim().min(1).optional(),
    suggestions: z.array(suggestionSchema).min(1).max(500),
  })
  .strict();

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
  progress(`[push-suggestions] suggestions=${payload.suggestions.length}`);

  const result = await client.post('/api/mcp/codebase_suggestions/push', payload);
  summary(
    `Suggestions: accepted ${result.accepted}, applied ${result.applied}, ` +
      `pending ${result.pending}, ignored ${result.ignored ?? 0}, ` +
      `skipped ${result.skipped.length}.`,
  );
  return 0;
}
