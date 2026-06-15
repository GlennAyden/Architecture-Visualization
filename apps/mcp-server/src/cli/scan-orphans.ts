import { ConvexMcpClient } from '../client.js';
import { loadConfig } from '../config.js';
import { walkSourceFiles } from './fs-walk.js';
import { createImportResolver } from './import-resolver.js';
import { collectLinkedFiles, extractImportSpecifiers } from './scan-imports.js';
import { progress, summary } from './output.js';
import { verifyProjectScope } from './project-scope.js';
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

export type ProductArea = 'public' | 'user' | 'admin' | 'extension' | 'internal' | 'unknown';

export interface ScanUiBlockFact {
  key: string;
  name: string;
  kind: 'header' | 'panel' | 'cta' | 'widget' | 'section' | 'control';
  labels: string[];
  evidence: string[];
  routeHint?: string;
}

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
  productArea?: ProductArea;
  capabilityHints?: string[];
  textHints?: string[];
  componentRefs?: string[];
  ctaHints?: string[];
  uiBlocks?: ScanUiBlockFact[];
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
const PUSH_PAYLOAD_BYTES_LIMIT = 950_000;

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
  let trimmedFileFacts = compactFileFactsForPayload(fileFacts, new Set(orphans));

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
  return fitPayloadUnderLimit(payload);
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

function truncateString(value: string, max: number) {
  return value.length > max ? value.slice(0, max).trimEnd() : value;
}

function compactFileFactsForPayload(
  fileFacts: ReadonlyArray<ScanFileFact>,
  orphanPaths: ReadonlySet<string>,
): ScanFileFact[] {
  return fileFacts
    .map((fact) => ({
      ...fact,
      imports: fact.imports.slice(0, 12),
      resolvedImports: fact.resolvedImports?.slice(0, 12),
      exports: fact.exports.slice(0, 12),
      capabilityHints: fact.capabilityHints?.slice(0, 8),
      textHints: fact.textHints?.map((hint) => truncateString(hint, 120)).slice(0, 8),
      componentRefs: fact.componentRefs?.slice(0, 8),
      ctaHints: fact.ctaHints?.map((hint) => truncateString(hint, 80)).slice(0, 6),
      uiBlocks: fact.uiBlocks?.slice(0, 6).map((block) => ({
        ...block,
        labels: block.labels.map((label) => truncateString(label, 80)).slice(0, 4),
        evidence: block.evidence.map((item) => truncateString(item, 120)).slice(0, 3),
      })),
    }))
    .sort((a, b) => fileFactPriority(b, orphanPaths) - fileFactPriority(a, orphanPaths));
}

function fileFactPriority(fact: ScanFileFact, orphanPaths: ReadonlySet<string>) {
  let score = 0;
  if (orphanPaths.has(fact.path)) score += 20;
  if ((fact.uiBlocks?.length ?? 0) > 0) score += 40;
  if ((fact.capabilityHints?.length ?? 0) > 0) score += 30;
  if (fact.productArea && fact.productArea !== 'unknown') score += 15;
  if (fact.routeHint) score += 12;
  if (fact.apiHint) score += 10;
  if ((fact.resolvedImports?.length ?? 0) > 0) score += 6;
  if (fact.kind === 'generated' || fact.kind === 'test' || fact.kind === 'config') score -= 15;
  return score;
}

function payloadByteLength(payload: OrphansPayload) {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

function fitPayloadUnderLimit(payload: OrphansPayload): OrphansPayload {
  if (payloadByteLength(payload) <= PUSH_PAYLOAD_BYTES_LIMIT) return payload;

  const next: OrphansPayload = {
    ...payload,
    truncated: true,
    repoFiles: payload.repoFiles.slice(0, REPO_FILES_SOFT_LIMIT),
    orphans: payload.orphans.slice(0, ORPHANS_HARD_LIMIT),
    fileFacts: payload.fileFacts,
  };

  let facts = next.fileFacts ?? [];
  while (facts.length > 0) {
    const candidate: OrphansPayload = { ...next, fileFacts: facts };
    if (payloadByteLength(candidate) <= PUSH_PAYLOAD_BYTES_LIMIT) return candidate;
    facts = facts.slice(0, Math.floor(facts.length * 0.85));
  }

  const withoutFacts: OrphansPayload = {
    repoFiles: next.repoFiles,
    orphans: next.orphans,
    scannedAt: next.scannedAt,
    truncated: true,
  };
  if (payloadByteLength(withoutFacts) <= PUSH_PAYLOAD_BYTES_LIMIT) return withoutFacts;

  return {
    repoFiles: next.repoFiles.slice(0, Math.floor(REPO_FILES_SOFT_LIMIT * 0.75)),
    orphans: next.orphans.slice(0, Math.floor(ORPHANS_HARD_LIMIT * 0.75)),
    scannedAt: next.scannedAt,
    truncated: true,
  };
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
  if (/^(?:apps\/web\/)?(?:src\/)?app\/(?:page|route)\.[cm]?[tj]sx?$/.test(normalized)) {
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

const CAPABILITY_PATTERNS: Array<{
  key: string;
  name: string;
  kind: ScanUiBlockFact['kind'];
  terms: RegExp[];
}> = [
  {
    key: 'onboarding',
    name: 'Onboarding',
    kind: 'panel',
    terms: [/onboarding/i, /get started/i, /welcome/i, /quick steps/i, /setup/i],
  },
  {
    key: 'billing_subscription',
    name: 'Billing & Subscription',
    kind: 'cta',
    terms: [/billing/i, /subscription/i, /plan/i, /redeem/i, /promo/i, /payment/i],
  },
  {
    key: 'notifications',
    name: 'Notifications',
    kind: 'control',
    terms: [/notification/i, /\bbell\b/i, /activity/i],
  },
  {
    key: 'localization',
    name: 'Localization',
    kind: 'control',
    terms: [/language/i, /locale/i, /i18n/i, /\bID\b/, /\bEN\b/, /bilingual/i],
  },
  {
    key: 'profile',
    name: 'Profile',
    kind: 'control',
    terms: [/profile/i, /account/i, /avatar/i, /user menu/i],
  },
  {
    key: 'admin_operations',
    name: 'Admin Operations',
    kind: 'section',
    terms: [/admin/i, /users/i, /settings/i, /management/i],
  },
  {
    key: 'extension_services',
    name: 'Extension Services',
    kind: 'cta',
    terms: [/extension/i, /chrome/i, /install extension/i],
  },
  {
    key: 'feature_updates',
    name: 'Feature Updates',
    kind: 'section',
    terms: [/feature update/i, /updates/i, /changelog/i, /what'?s new/i],
  },
  {
    key: 'user_control',
    name: 'User Control',
    kind: 'section',
    terms: [/user control/i, /user table/i, /bulk action/i, /user filters?/i, /impersonat/i],
  },
  {
    key: 'plan_catalog',
    name: 'Plan Catalog',
    kind: 'section',
    terms: [/plan catalog/i, /service tools?/i, /custom plans?/i, /promo codes?/i, /ai keys?/i],
  },
  {
    key: 'support_ops',
    name: 'Support Operations',
    kind: 'section',
    terms: [/support system/i, /support tickets?/i, /ticket table/i, /triage/i],
  },
  {
    key: 'content_workflow',
    name: 'Content Workflow',
    kind: 'section',
    terms: [/content management/i, /tips canvas/i, /announcements?/i, /content workflow/i],
  },
  {
    key: 'referrals',
    name: 'Referrals',
    kind: 'widget',
    terms: [/referral/i, /affiliate/i],
  },
  {
    key: 'api_keys',
    name: 'API Keys',
    kind: 'control',
    terms: [/api keys?/i, /secret key/i, /access token/i],
  },
  {
    key: 'data_state',
    name: 'Data & State',
    kind: 'section',
    terms: [/database/i, /prisma/i, /schema/i, /query/i, /mutation/i, /storage/i],
  },
  {
    key: 'agent_mission_control',
    name: 'Agent Mission Control',
    kind: 'section',
    terms: [/hermes/i, /agent/i, /mission control/i, /mcp/i, /worker/i],
  },
];

function classifyProductArea(path: string, kind: ScanFileKind, text: string): ProductArea {
  const lowerPath = path.toLowerCase();
  const lowerText = text.slice(0, 4000).toLowerCase();
  const lower = `${lowerPath} ${lowerText}`;
  if (
    lowerPath.includes('/admin') ||
    lowerPath.includes('\\admin') ||
    lowerPath.includes('admin-') ||
    lowerPath.includes('admin_')
  ) {
    return 'admin';
  }
  if (lowerPath.includes('extension') || lowerPath.includes('chrome')) return 'extension';
  if (kind === 'api' || kind === 'convex' || kind === 'mcp' || lower.includes('/server/')) {
    return 'internal';
  }
  if (
    lower.includes('/dashboard') ||
    lower.includes('/account') ||
    lower.includes('/billing') ||
    lower.includes('/profile') ||
    lower.includes('/plan') ||
    lower.includes('/notifications') ||
    lower.includes('/support') ||
    /\buser dashboard\b/.test(lower)
  ) {
    return 'user';
  }
  if (/\/(?:page|layout|template)\.[cm]?[tj]sx?$/.test(path) || kind === 'component') {
    return 'public';
  }
  return 'unknown';
}

function stripMarkup(value: string) {
  return value
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectTextHints(text: string) {
  const jsxText = [...text.matchAll(/>([^<>{}][^<>{]{2,120})</g)].map((match) =>
    stripMarkup(match[1] ?? ''),
  );
  const ariaLabels = [
    ...text.matchAll(/(?:aria-label|title|placeholder)=["']([^"']{2,120})["']/g),
  ].map((match) => match[1] ?? '');
  const stringLabels = [...text.matchAll(/["'`]([^"'`]{4,120})["'`]/g)]
    .map((match) => match[1] ?? '')
    .filter((value) => /[A-Za-z]/.test(value) && /\s/.test(value));
  return uniqueCapped([...jsxText, ...ariaLabels, ...stringLabels], 24);
}

function collectComponentRefs(text: string) {
  return uniqueCapped(
    [...text.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)].map((match) => match[1] ?? ''),
    20,
  );
}

function collectCapabilityHints(text: string, path: string) {
  const haystack = `${path}\n${text.slice(0, 8000)}`;
  return uniqueCapped(
    CAPABILITY_PATTERNS.filter((pattern) => pattern.terms.some((term) => term.test(haystack))).map(
      (pattern) => pattern.key,
    ),
    12,
  );
}

function collectCtaHints(textHints: string[]) {
  return uniqueCapped(
    textHints.filter((hint) =>
      /install|redeem|view|browse|connect|create|upgrade|subscribe|login|sign up|back to/i.test(
        hint,
      ),
    ),
    12,
  );
}

function uiBlocksFor(
  path: string,
  text: string,
  textHints: string[],
  capabilityHints: string[],
  routeHint: string | undefined,
) {
  const haystack = `${path}\n${text.slice(0, 8000)}`;
  const blocks: ScanUiBlockFact[] = [];

  const headerLabels = textHints.filter((hint) =>
    /notification|language|profile|account|back to|admin panel/i.test(hint),
  );
  if (headerLabels.length > 0 || /notification|language|profile|back to home/i.test(haystack)) {
    blocks.push({
      key: 'header_controls',
      name: 'Header Controls',
      kind: 'header',
      labels: uniqueCapped(headerLabels, 6),
      evidence: ['notification/language/profile controls detected'],
      routeHint,
    });
  }

  for (const capabilityKey of capabilityHints) {
    const pattern = CAPABILITY_PATTERNS.find((candidate) => candidate.key === capabilityKey);
    if (!pattern) continue;
    const labels = textHints.filter((hint) => pattern.terms.some((term) => term.test(hint)));
    blocks.push({
      key: capabilityKey,
      name: pattern.name,
      kind: pattern.kind,
      labels: uniqueCapped(labels, 6),
      evidence: [`${pattern.name} keywords detected`],
      routeHint,
    });
  }

  return blocks.slice(0, 10);
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
        ...[...text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1] ?? ''),
      ],
      20,
    );
    const resolvedImports = uniqueCapped(
      imports
        .map((spec) =>
          resolver.isLocal(spec) ? resolver.resolve(join(rootDir, path), spec) : null,
        )
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
    const textHints = collectTextHints(text);
    const componentRefs = collectComponentRefs(text);
    const capabilityHints = collectCapabilityHints(text, path);
    const ctaHints = collectCtaHints(textHints);
    const productArea = classifyProductArea(path, kind, text);
    const uiBlocks = uiBlocksFor(path, text, textHints, capabilityHints, routeHint);
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
    if (productArea !== 'unknown') fact.productArea = productArea;
    if (capabilityHints.length > 0) fact.capabilityHints = capabilityHints;
    if (textHints.length > 0) fact.textHints = textHints;
    if (componentRefs.length > 0) fact.componentRefs = componentRefs;
    if (ctaHints.length > 0) fact.ctaHints = ctaHints;
    if (uiBlocks.length > 0) fact.uiBlocks = uiBlocks;
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
  await verifyProjectScope(client, config, 'scan-orphans');

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
