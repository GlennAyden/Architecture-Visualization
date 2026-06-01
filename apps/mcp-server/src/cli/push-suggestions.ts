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
  skipped: Array<{ filePath: string; reason: string }>;
}

export interface PushSuggestionsClient {
  post(path: string, body: unknown): Promise<PushSuggestionsResponse>;
}

const suggestionSchema = z
  .object({
    filePath: z.string().trim().min(1).max(500),
    layerId: z.string().trim().min(1),
    suggestedNodeName: z.string().trim().min(1).max(80),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(1000),
    source: z.string().trim().min(1).max(80).default('hermes'),
  })
  .strict();

const pushSuggestionsSchema = z
  .object({
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
      `pending ${result.pending}, skipped ${result.skipped.length}.`,
  );
  return 0;
}
