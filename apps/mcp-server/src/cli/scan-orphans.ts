import { ConvexMcpClient } from '../client.js';
import { loadConfig } from '../config.js';
import { walkSourceFiles } from './fs-walk.js';
import { collectLinkedFiles } from './scan-imports.js';
import { progress, summary } from './output.js';

/**
 * The orphans payload schema agreed with the backend. The shape is mirrored
 * in `convex/scans.ts`; if you change either side, change both.
 */
export interface OrphansPayload {
  repoFiles: string[];
  orphans: string[];
  scannedAt: number;
  truncated?: boolean;
}

/**
 * Hard cap on entries written into the payload. The /scans/push endpoint
 * enforces a 1MB body limit; at ~80 bytes per relative path that gives a
 * theoretical ceiling around 12k entries, so we stay well under it to leave
 * room for JSON overhead and future schema fields.
 */
const REPO_FILES_SOFT_LIMIT = 8_000;
const ORPHANS_HARD_LIMIT = 5_000;

export interface ComputeOrphansInput {
  repoFiles: ReadonlyArray<string>;
  linked: ReadonlySet<string>;
}

/**
 * Compute the orphan list from a filesystem listing and the canvas-linked
 * set. Pure function so the test can pin down the exact diff semantics —
 * which matters because orphan = "code that exists on disk but no node in
 * the canvas owns it". Getting the direction of the diff wrong would
 * silently surface every file as orphaned and drown the user in noise.
 */
export function computeOrphans(input: ComputeOrphansInput): string[] {
  const out: string[] = [];
  for (const path of input.repoFiles) {
    if (!input.linked.has(path)) out.push(path);
  }
  return out;
}

/**
 * Build the {@link OrphansPayload} that goes on the wire. Applies the
 * truncation rules so the payload always fits under the 1MB cap.
 */
export function buildOrphansPayload(
  repoFiles: ReadonlyArray<string>,
  orphans: ReadonlyArray<string>,
  scannedAt: number,
): OrphansPayload {
  let truncated = false;
  let trimmedRepoFiles = repoFiles as string[];
  let trimmedOrphans = orphans as string[];

  if (repoFiles.length > REPO_FILES_SOFT_LIMIT) {
    truncated = true;
    trimmedRepoFiles = repoFiles.slice(0, REPO_FILES_SOFT_LIMIT);
    trimmedOrphans = orphans.slice(0, ORPHANS_HARD_LIMIT);
  }

  const payload: OrphansPayload = {
    repoFiles: trimmedRepoFiles,
    orphans: trimmedOrphans,
    scannedAt,
  };
  if (truncated) payload.truncated = true;
  return payload;
}

export async function runScanOrphans(
  argv: string[] = [],
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): Promise<number> {
  void argv;
  const config = loadConfig(env);
  const client = new ConvexMcpClient(config);
  progress(`[scan-orphans] project=${config.projectId}`);

  const linked = await collectLinkedFiles(client);
  progress(`[scan-orphans] ${linked.size} linked files in canvas`);

  const { files: repoFiles, truncated: walkTruncated } = walkSourceFiles(cwd);
  if (walkTruncated) {
    progress(`[scan-orphans] WARN: walk hit max-files cap, results are partial`);
  }
  progress(`[scan-orphans] ${repoFiles.length} source files on disk`);

  const orphans = computeOrphans({ repoFiles, linked });
  const payload = buildOrphansPayload(repoFiles, orphans, Date.now());

  await client.post('/api/mcp/scans/push', { kind: 'orphans', data: payload });

  summary(
    `Found ${orphans.length} orphans (out of ${repoFiles.length} source files). ` +
      `Pushed snapshot to project. View at /canvas/${config.projectId}/orphans`,
  );
  return 0;
}
