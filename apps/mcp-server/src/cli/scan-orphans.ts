import { ConvexMcpClient } from '../client.js';
import { loadConfig } from '../config.js';
import { walkSourceFiles } from './fs-walk.js';
import { createImportResolver } from './import-resolver.js';
import { collectLinkedFiles, extractImportSpecifiers } from './scan-imports.js';
import { progress, summary } from './output.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ScanFileKind =
  | 'component'
  | 'api'
  | 'convex'
  | 'mcp'
  | 'config'
  | 'test'
  | 'generated'
  | 'script'
  | 'unknown';

export interface ScanFileFact {
  path: string;
  kind: ScanFileKind;
  imports: string[];
  resolvedImports?: string[];
  exports: string[];
  routeHint?: string;
  apiHint?: string;
  featureHint?: string;
  pathGroup?: string;
  testTargetHint?: string;
}

/**
 * The orphans payload schema agreed with the backend. The shape is mirrored
 * in `convex/scans.ts`; if you change either side, change both.
 */
export interface OrphansPayload {
  repoFiles: string[];
  orphans: string[];
  fileFacts?: ScanFileFact[];
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
  fileFacts: ReadonlyArray<ScanFileFact> = [],
): OrphansPayload {
  let truncated = false;
  let trimmedRepoFiles = repoFiles as string[];
  let trimmedOrphans = orphans as string[];
  let trimmedFileFacts = fileFacts as ScanFileFact[];

  if (repoFiles.length > REPO_FILES_SOFT_LIMIT) {
    truncated = true;
    trimmedRepoFiles = repoFiles.slice(0, REPO_FILES_SOFT_LIMIT);
    trimmedOrphans = orphans.slice(0, ORPHANS_HARD_LIMIT);
    trimmedFileFacts = fileFacts.slice(0, REPO_FILES_SOFT_LIMIT);
  }

  const payload: OrphansPayload = {
    repoFiles: trimmedRepoFiles,
    orphans: trimmedOrphans,
    scannedAt,
  };
  if (trimmedFileFacts.length > 0) payload.fileFacts = trimmedFileFacts;
  if (truncated) payload.truncated = true;
  return payload;
}

function uniqueCapped(values: Iterable<string>, cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

function classifyFile(path: string): ScanFileKind {
  const lower = path.toLowerCase();
  if (lower.includes('/_generated/') || lower.includes('\\_generated\\')) return 'generated';
  if (
    /\.(test|spec)\.[cm]?[tj]sx?$/.test(lower) ||
    lower.includes('/tests/') ||
    lower.includes('/__tests__/')
  ) {
    return 'test';
  }
  if (
    /(^|\/)(eslint|vitest|next|postcss|tailwind|tsconfig|playwright)\.config\./.test(lower) ||
    /(^|\/)(tsconfig|jsconfig)\.json$/.test(lower) ||
    lower.endsWith('package.json')
  ) {
    return 'config';
  }
  if (lower.startsWith('convex/')) return 'convex';
  if (lower.startsWith('apps/mcp-server/')) return 'mcp';
  if (lower.includes('/scripts/')) return 'script';
  if (
    lower.startsWith('apps/web/app/api/') ||
    lower.startsWith('src/app/api/') ||
    lower.startsWith('src/pages/api/') ||
    lower.startsWith('pages/api/')
  ) {
    return 'api';
  }
  if (
    lower.startsWith('apps/web/components/') ||
    lower.startsWith('src/components/') ||
    lower.startsWith('components/') ||
    lower.includes('/components/') ||
    lower.startsWith('src/features/') ||
    lower.startsWith('features/') ||
    /(^|\/)(page|layout|template)\.[cm]?[tj]sx?$/.test(lower)
  ) {
    return 'component';
  }
  if (lower.startsWith('src/server/') || lower.startsWith('server/')) return 'api';
  return 'unknown';
}

function routeHintFor(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/');
  if (
    /^(?:apps\/web\/)?(?:src\/)?app\/(?:page|route)\.[cm]?[tj]sx?$/.test(normalized)
  ) {
    return '/';
  }
  const routeMatch =
    normalized.match(/^apps\/web\/app\/(.+)\/(?:page|route)\.[cm]?[tj]sx?$/) ??
    normalized.match(/^apps\/web\/src\/app\/(.+)\/(?:page|route)\.[cm]?[tj]sx?$/) ??
    normalized.match(/^src\/app\/(.+)\/(?:page|route)\.[cm]?[tj]sx?$/) ??
    normalized.match(/^app\/(.+)\/(?:page|route)\.[cm]?[tj]sx?$/) ??
    normalized.match(/^apps\/web\/src\/pages\/(.+)\.[cm]?[tj]sx?$/) ??
    normalized.match(/^src\/pages\/(.+)\.[cm]?[tj]sx?$/) ??
    normalized.match(/^pages\/(.+)\.[cm]?[tj]sx?$/);
  if (!routeMatch) return undefined;
  const route = routeMatch[1]!
    .replace(/^index$/, '')
    .replace(/\/index$/, '')
    .replace(/\/\[\[\.\.\..+?\]\]/g, '')
    .replace(/\/\(.+?\)/g, '')
    .replace(/\/page$/, '');
  return route.length === 0 ? '/' : `/${route}`;
}

function featureHintFor(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/');
  const route = routeHintFor(normalized);
  if (route) return route === '/' ? 'home' : route.split('/').filter(Boolean).at(-1);
  const parts = normalized.split('/');
  const componentIndex = parts.findIndex((part) => part === 'components');
  if (componentIndex >= 0 && parts[componentIndex + 1]) return parts[componentIndex + 1];
  const featuresIndex = parts.findIndex((part) => part === 'features');
  if (featuresIndex >= 0 && parts[featuresIndex + 1]) return parts[featuresIndex + 1];
  const appIndex = parts.findIndex((part) => part === 'app');
  if (appIndex >= 0 && parts[appIndex + 1]) return parts[appIndex + 1];
  const pagesIndex = parts.findIndex((part) => part === 'pages');
  if (pagesIndex >= 0 && parts[pagesIndex + 1]) return parts[pagesIndex + 1];
  const serverIndex = parts.findIndex((part) => part === 'server');
  if (serverIndex >= 0 && parts[serverIndex + 1]) return parts[serverIndex + 1];
  const libIndex = parts.findIndex((part) => part === 'lib');
  if (libIndex >= 0 && parts[libIndex + 1]) return parts[libIndex + 1];
  const convexIndex = parts.findIndex((part) => part === 'convex');
  if (convexIndex >= 0 && parts[convexIndex + 1]) {
    return parts[convexIndex + 1]!.replace(/\.[^.]+$/, '');
  }
  const srcIndex = parts.findIndex((part) => part === 'src');
  if (srcIndex >= 0 && parts[srcIndex + 1]) return parts[srcIndex + 1];
  return parts.at(-1)?.replace(/\.[^.]+$/, '');
}

function pathGroupFor(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (normalized.startsWith('apps/web/app/api/')) return 'web-api';
  if (normalized.startsWith('apps/web/app/')) return 'web-app';
  if (normalized.startsWith('apps/web/components/')) return 'web-components';
  if (normalized.startsWith('src/app/api/')) return 'web-api';
  if (normalized.startsWith('src/pages/api/')) return 'web-api';
  if (normalized.startsWith('src/app/')) return 'web-app';
  if (normalized.startsWith('src/pages/')) return 'web-pages';
  if (normalized.startsWith('src/components/')) return 'web-components';
  if (normalized.startsWith('src/features/') && parts[2]) return `features/${parts[2]}`;
  if (normalized.startsWith('src/server/')) return 'server';
  if (normalized.startsWith('src/lib/')) return 'lib';
  if (normalized.startsWith('src/hooks/')) return 'hooks';
  if (normalized.startsWith('apps/vps-api/')) return 'vps-api';
  if (normalized.startsWith('apps/mcp-server/')) return 'mcp-server';
  if (normalized.startsWith('packages/shared/')) return 'shared-contracts';
  if (normalized.startsWith('convex/')) return 'convex';
  return parts.slice(0, 2).join('/') || undefined;
}

function testTargetHintFor(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/');
  if (!/\.(test|spec)\.[cm]?[tj]sx?$/.test(normalized.toLowerCase())) return undefined;
  return normalized
    .replace(/(^|\/)__tests__\//g, '$1')
    .replace(/\/tests\//g, '/')
    .replace(/\.(test|spec)(\.[cm]?[tj]sx?)$/, '$2');
}

export function buildFileFacts(rootDir: string, files: ReadonlyArray<string>): ScanFileFact[] {
  const resolver = createImportResolver(rootDir);
  return files.map((path) => {
    let text = '';
    try {
      text = readFileSync(join(rootDir, path), 'utf8');
    } catch {
      // Best-effort: Hermes can still reason from the path and kind.
    }

    let extractedImports: string[];
    try {
      extractedImports = extractImportSpecifiers(text, join(rootDir, path));
    } catch {
      extractedImports = [];
    }
    const imports = uniqueCapped(
      [
        ...extractedImports,
        ...[...text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
          (match) => match[1] ?? '',
        ),
      ],
      20,
    );
    const resolvedImports = uniqueCapped(
      imports
        .map((spec) => (resolver.isLocal(spec) ? resolver.resolve(join(rootDir, path), spec) : null))
        .filter((value): value is string => typeof value === 'string' && value !== path),
      20,
    );
    const namedExports = [
      ...text.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g),
    ]
      .map((match) => match[1] ?? '')
      .filter(Boolean);
    const exports = uniqueCapped(
      text.includes('export default') ? ['default', ...namedExports] : namedExports,
      20,
    );
    const routeHint = routeHintFor(path);
    const kind = classifyFile(path);
    const fact: ScanFileFact = { path, kind, imports, exports };
    if (resolvedImports.length > 0) fact.resolvedImports = resolvedImports;
    const featureHint = featureHintFor(path);
    const pathGroup = pathGroupFor(path);
    const testTargetHint = testTargetHintFor(path);
    if (routeHint) fact.routeHint = routeHint;
    if (kind === 'api' && routeHint) fact.apiHint = routeHint;
    if (featureHint) fact.featureHint = featureHint;
    if (pathGroup) fact.pathGroup = pathGroup;
    if (testTargetHint) fact.testTargetHint = testTargetHint;
    return fact;
  });
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
  const payload = buildOrphansPayload(
    repoFiles,
    orphans,
    Date.now(),
    buildFileFacts(cwd, repoFiles),
  );

  await client.post('/api/mcp/scans/push', { kind: 'orphans', data: payload });

  summary(
    `Found ${orphans.length} orphans (out of ${repoFiles.length} source files). ` +
      `Pushed snapshot to project. View at /canvas/${config.projectId}/orphans`,
  );
  return 0;
}
