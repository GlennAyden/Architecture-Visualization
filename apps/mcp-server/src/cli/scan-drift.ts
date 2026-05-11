import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConvexMcpClient } from '../client.js';
import { loadConfig } from '../config.js';
import { walkSourceFiles } from './fs-walk.js';
import { collectLinkedFilesWithNode } from './scan-imports.js';
import { progress, summary } from './output.js';

/**
 * Drift entry kinds:
 *  - `missing`           — a linked path no longer exists on disk
 *  - `renamed_candidate` — same basename found elsewhere; user likely moved it
 *
 * The two-kind split lets the canvas UI offer one-click "fix" actions: a
 * pure missing row is a delete, a rename candidate is a path update.
 */
export type DriftEntry =
  | { kind: 'missing'; nodeId: string; path: string }
  | { kind: 'renamed_candidate'; nodeId: string; oldPath: string; newPath: string };

export interface DriftPayload {
  drift: DriftEntry[];
  scannedAt: number;
  truncated?: boolean;
}

const DRIFT_HARD_LIMIT = 1_000;

export interface ComputeDriftInput {
  linked: ReadonlyArray<{ nodeId: string; path: string }>;
  repoFiles: ReadonlyArray<string>;
  exists: (path: string) => boolean;
}

/**
 * Pure drift computation. Test contract:
 *  - Every linked path that fails `exists` is recorded as `missing`.
 *  - If a file with the same basename lives elsewhere in `repoFiles`, an
 *    additional `renamed_candidate` entry is appended pointing at the new
 *    location. The user gets both rows so they can confirm before the
 *    canvas updates anything.
 *
 * Why basename-only heuristic? File renames in a refactor usually preserve
 * the leaf name. A stricter (content-hash) check would be more accurate but
 * also expensive enough to require I/O per file, and we run this on every
 * post-commit hook. Cheap-and-loud wins.
 */
export function computeDrift(input: ComputeDriftInput): DriftEntry[] {
  const out: DriftEntry[] = [];
  const byBasename = new Map<string, string[]>();
  for (const path of input.repoFiles) {
    const base = basename(path);
    const existing = byBasename.get(base);
    if (existing) existing.push(path);
    else byBasename.set(base, [path]);
  }
  for (const link of input.linked) {
    if (input.exists(link.path)) continue;
    out.push({ kind: 'missing', nodeId: link.nodeId, path: link.path });
    const candidates = byBasename.get(basename(link.path));
    if (!candidates) continue;
    for (const newPath of candidates) {
      // Only suggest if the candidate is actually somewhere else than the
      // original. (Same path would mean exists() lied — defensive.)
      if (newPath === link.path) continue;
      out.push({
        kind: 'renamed_candidate',
        nodeId: link.nodeId,
        oldPath: link.path,
        newPath,
      });
    }
  }
  return out;
}

export function buildDriftPayload(
  drift: ReadonlyArray<DriftEntry>,
  scannedAt: number,
): DriftPayload {
  if (drift.length <= DRIFT_HARD_LIMIT) {
    return { drift: drift as DriftEntry[], scannedAt };
  }
  return { drift: drift.slice(0, DRIFT_HARD_LIMIT), scannedAt, truncated: true };
}

export async function runScanDrift(
  argv: string[] = [],
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): Promise<number> {
  void argv;
  const config = loadConfig(env);
  const client = new ConvexMcpClient(config);
  progress(`[scan-drift] project=${config.projectId}`);

  const linked = await collectLinkedFilesWithNode(client);
  progress(`[scan-drift] ${linked.length} linked files in canvas`);

  const { files: repoFiles, truncated: walkTruncated } = walkSourceFiles(cwd);
  if (walkTruncated) {
    progress(`[scan-drift] WARN: walk hit max-files cap, rename heuristic is partial`);
  }

  const drift = computeDrift({
    linked,
    repoFiles,
    exists: (p) => existsSync(resolve(cwd, p)),
  });

  const payload = buildDriftPayload(drift, Date.now());
  await client.post('/api/mcp/scans/push', { kind: 'drift', data: payload });

  const renamedCount = drift.filter((d) => d.kind === 'renamed_candidate').length;
  const missingCount = drift.filter((d) => d.kind === 'missing').length;
  summary(
    `Found ${missingCount} drifted files (${renamedCount} renamed candidates). ` +
      `View in canvas modal "Drift" tab.`,
  );
  return 0;
}

function basename(posixPath: string): string {
  const slash = posixPath.lastIndexOf('/');
  return slash === -1 ? posixPath : posixPath.slice(slash + 1);
}
