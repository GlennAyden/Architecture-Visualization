import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { Project, SyntaxKind, type SourceFile } from 'ts-morph';
import { ConvexMcpClient } from '../client.js';
import { loadConfig } from '../config.js';
import { SOURCE_EXTENSIONS } from './fs-walk.js';
import { createImportResolver, type ImportResolver } from './import-resolver.js';
import { progress, summary } from './output.js';
import { emitDependencyEdges } from './walkers/dependency.js';
import { emitNavigationEdges } from './walkers/navigation.js';
import { emitDataFlowEdges } from './walkers/data-flow.js';
import {
  dedupeEdges,
  type EdgeCandidate,
  type NodeSnapshot,
} from './walkers/shared.js';

/**
 * Maximum number of resolved imports per /api/mcp/files/auto_link call.
 * The endpoint accepts more, but chunking keeps each request small enough
 * to retry independently and keeps a single rogue file from ballooning the
 * payload past the 1MB body cap shared by all MCP routes.
 */
const AUTO_LINK_CHUNK_SIZE = 20;

/**
 * Server-side cap on a single /edges/reconcile payload. We mirror it here
 * so we can truncate visibly rather than letting the server 4xx.
 */
const EDGE_RECONCILE_CAP = 2000;

interface NodeListResponse {
  nodes: { id: string; name: string; type: string; parentId: string | null }[];
}

/**
 * `/api/mcp/nodes/get` response. The `metadata` field is optional because
 * the Sprint 3 backend may or may not surface it yet — when missing, the
 * navigation / data-flow walkers see `undefined` and emit nothing, which
 * is the conservative failure mode (don't invent edges).
 */
interface NodeDetailResponse {
  node: {
    id: string;
    name: string;
    files: { id: string; path: string }[];
    metadata?: { route?: string; apiPaths?: string[] } | null;
  };
}

interface AutoLinkResponse {
  linked: number;
  alreadyLinked: number;
  skipped: number;
  matchedNodes: number;
}

interface ReconcileResponse {
  inserted: number;
  deleted: number;
  manualKept: number;
}

export interface ScanImportsResult {
  filesScanned: number;
  linked: number;
  alreadyLinked: number;
  skipped: number;
}

export interface ScanImportsOptions {
  /** When true, skip the Sprint 3 edge walkers + reconcile call. */
  skipEdges?: boolean;
}

/**
 * Parse `--skip-edges` out of an argv slice. Exposed for testing — the
 * flag is the only CLI surface this subcommand owns, but we'd rather
 * pin the parsing contract in a unit test than rely on integration runs.
 */
export function parseScanImportsArgs(argv: ReadonlyArray<string>): ScanImportsOptions {
  return { skipEdges: argv.includes('--skip-edges') };
}

/* ------------------------------------------------------------------------- */
/* Pure helpers (exported for testing)                                        */
/*                                                                            */
/* These are the bits where the business logic lives and where a regression  */
/* would silently desync the canvas from the codebase. They get unit tests.   */
/* ------------------------------------------------------------------------- */

/**
 * Extract every import-like module specifier from a TypeScript / JavaScript
 * source file. Includes `import x from ...`, `import('...')` calls, and
 * re-exports — anything that creates a code-level dependency.
 *
 * Returned specifiers are *raw* (e.g. `./foo`, `../bar/baz`, `react`). Use
 * `resolveLocalImport` to turn relatives into filesystem paths.
 */
export function extractImportSpecifiers(
  sourceText: string,
  filePath: string,
): string[] {
  // We use ts-morph rather than a regex so JSX, generic, and type-only
  // import syntax all parse cleanly. A regex over JSX explodes immediately.
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 1 },
  });
  const src = project.createSourceFile(filePath, sourceText, { overwrite: true });

  const out: string[] = [];
  for (const decl of src.getImportDeclarations()) {
    out.push(decl.getModuleSpecifierValue());
  }
  for (const decl of src.getExportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (spec) out.push(spec);
  }
  // Dynamic imports: `import('...')`. ts-morph exposes them as a CallExpression
  // whose expression is the ImportKeyword token, so just scan all calls.
  for (const call of src.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.ImportKeyword) continue;
    const args = call.getArguments();
    if (args.length === 0) continue;
    const raw = args[0]!.getText();
    // Only handle literal `import('./foo')` — variable dynamic imports can't
    // be resolved statically anyway.
    if (
      (raw.startsWith("'") && raw.endsWith("'")) ||
      (raw.startsWith('"') && raw.endsWith('"'))
    ) {
      out.push(raw.slice(1, -1));
    }
  }
  return out;
}

/**
 * Decide whether a specifier is a local (relative) import that points
 * inside the repo. Package imports (`react`, `@scope/x`) and absolute
 * outside-repo paths are excluded.
 */
export function isLocalImport(spec: string, resolver?: ImportResolver): boolean {
  if (resolver) return resolver.isLocal(spec);
  if (spec.length === 0) return false;
  if (spec.startsWith('.')) return true;
  // Treat absolute paths cautiously — they may or may not be inside the
  // repo. Defer to the resolver which will reject anything outside.
  if (isAbsolute(spec)) return true;
  return false;
}

/**
 * Resolve a relative import to a repo-relative POSIX path on disk.
 *
 * Tries each candidate extension (then `index.<ext>` for folders). Returns
 * `null` when no candidate exists on disk — this is the "silently desyncs"
 * case that motivates the test in scan-imports.test.ts: if we returned a
 * fabricated path here, the backend would happily create a file row
 * pointing at nothing.
 */
export function resolveLocalImport(
  importerAbs: string,
  spec: string,
  repoRoot: string,
  extensions: ReadonlyArray<string> = SOURCE_EXTENSIONS,
): string | null {
  return createImportResolver(repoRoot, extensions).resolve(importerAbs, spec);
}

/** Split `items` into chunks of at most `size` elements (preserves order). */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Command entry point                                                        */
/* ------------------------------------------------------------------------- */

export async function runScanImports(
  argv: string[] = [],
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): Promise<number> {
  const opts = parseScanImportsArgs(argv);
  const config = loadConfig(env);
  const client = new ConvexMcpClient(config);
  progress(`[scan-imports] project=${config.projectId}`);

  // Sprint 3 needs the (path → owners) map AND each node's metadata; the
  // legacy `collectLinkedFiles` only returned a flat path set. Build both
  // shapes from a single pass so we don't double the nodes/get round trips.
  const { nodes, fileToOwners } = await collectNodesAndFiles(client);
  const totalLinkedFiles = countLinkedFiles(fileToOwners);
  progress(`[scan-imports] ${totalLinkedFiles} linked files in canvas`);

  const result: ScanImportsResult = { filesScanned: 0, linked: 0, alreadyLinked: 0, skipped: 0 };
  const edgeCandidates: EdgeCandidate[] = [];
  const importResolver = createImportResolver(cwd);

  for (const [relPath, ownerNodeIds] of fileToOwners) {
    if (!hasSourceExtension(relPath)) continue;
    const abs = resolve(cwd, relPath);
    if (!existsSync(abs)) continue;

    let sourceText: string;
    try {
      sourceText = await readFileSafe(abs);
    } catch {
      continue;
    }

    const specifiers = extractImportSpecifiers(sourceText, abs);
    const resolved = new Set<string>();
    for (const spec of specifiers) {
      if (!isLocalImport(spec, importResolver)) continue;
      const target = importResolver.resolve(abs, spec);
      if (!target) continue;
      if (target === relPath) continue; // self-import guard
      resolved.add(target);
    }

    result.filesScanned += 1;

    if (resolved.size > 0) {
      for (const batch of chunk(Array.from(resolved), AUTO_LINK_CHUNK_SIZE)) {
        const res = await client.post<AutoLinkResponse>('/api/mcp/files/auto_link', {
          originFilePath: relPath,
          importedFilePaths: batch,
        });
        result.linked += res.linked;
        result.alreadyLinked += res.alreadyLinked;
        result.skipped += res.skipped;
      }
    }

    if (opts.skipEdges) continue;

    // --- Sprint 3 edge emission --------------------------------------------
    //
    // Dependency walker runs even when the file imports nothing inside the
    // repo (it just returns []), so we always call it. Navigation +
    // data-flow walkers re-parse via ts-morph once to share a SourceFile.
    edgeCandidates.push(
      ...emitDependencyEdges({
        originFilePath: relPath,
        originOwnerNodeIds: ownerNodeIds,
        resolvedImports: Array.from(resolved),
        fileToOwners,
      }),
    );

    const sourceFile = parseSourceFile(sourceText, abs);
    edgeCandidates.push(
      ...emitNavigationEdges({
        filePath: relPath,
        ownerNodeIds,
        sourceFile,
        allNodes: nodes,
      }),
    );
    edgeCandidates.push(
      ...emitDataFlowEdges({
        filePath: relPath,
        ownerNodeIds,
        sourceFile,
        allNodes: nodes,
      }),
    );
  }

  summary(
    `Scanned ${result.filesScanned} files → linked ${result.linked} new imports ` +
      `(${result.alreadyLinked} already linked, ${result.skipped} skipped)`,
  );

  if (opts.skipEdges) return 0;

  const deduped = dedupeEdges(edgeCandidates);
  const capped = deduped.length > EDGE_RECONCILE_CAP ? deduped.slice(0, EDGE_RECONCILE_CAP) : deduped;
  if (deduped.length > EDGE_RECONCILE_CAP) {
    progress(
      `[scan-imports] WARN: emitted ${deduped.length} edges, capping at ${EDGE_RECONCILE_CAP}`,
    );
  }

  const reconciled = await client.post<ReconcileResponse>('/api/mcp/edges/reconcile', {
    edges: capped,
  });
  summary(
    `Edges: scanned ${result.filesScanned} files → reconciled ` +
      `{inserted: ${reconciled.inserted}, deleted: ${reconciled.deleted}, ` +
      `manualKept: ${reconciled.manualKept}}`,
  );
  return 0;
}

/* ------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* ------------------------------------------------------------------------- */

async function readFileSafe(absPath: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(absPath, 'utf8');
}

function hasSourceExtension(path: string): boolean {
  const lower = path.toLowerCase();
  for (const ext of SOURCE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Pulls `nodes/list` + per-node `nodes/get` to assemble the set of every
 * file currently linked in the canvas. Exposed for the orphans / drift
 * scanners which need the same data.
 */
export async function collectLinkedFiles(
  client: ConvexMcpClient,
): Promise<Set<string>> {
  const list = await client.post<NodeListResponse>('/api/mcp/nodes/list', {});
  const out = new Set<string>();
  for (const node of list.nodes) {
    const detail = await client.post<NodeDetailResponse>('/api/mcp/nodes/get', {
      nodeId: node.id,
    });
    for (const file of detail.node.files) out.add(file.path);
  }
  return out;
}

/**
 * Variant of {@link collectLinkedFiles} that preserves the (nodeId, path)
 * association — needed by scan-drift to report which node owns each
 * missing file.
 */
export async function collectLinkedFilesWithNode(
  client: ConvexMcpClient,
): Promise<{ nodeId: string; path: string }[]> {
  const list = await client.post<NodeListResponse>('/api/mcp/nodes/list', {});
  const out: { nodeId: string; path: string }[] = [];
  for (const node of list.nodes) {
    const detail = await client.post<NodeDetailResponse>('/api/mcp/nodes/get', {
      nodeId: node.id,
    });
    for (const file of detail.node.files) {
      out.push({ nodeId: node.id, path: file.path });
    }
  }
  return out;
}

/**
 * Sprint 3 — fetch every project node's metadata + linked files, then
 * invert into (filePath → owner node ids). The walkers need both shapes:
 *  - `nodes` for `route` / `apiPaths` lookups during nav + data-flow walks
 *  - `fileToOwners` for dependency-edge construction (origin file → which
 *    node owns it, imported file → which node owns it)
 *
 * One nodes/get round trip per node, same cost as the legacy
 * `collectLinkedFiles`. The extra `metadata` field on the response is
 * free when present and `undefined` when not — the walkers tolerate both.
 */
export async function collectNodesAndFiles(client: ConvexMcpClient): Promise<{
  nodes: NodeSnapshot[];
  fileToOwners: Map<string, string[]>;
}> {
  const list = await client.post<NodeListResponse>('/api/mcp/nodes/list', {});
  const nodes: NodeSnapshot[] = [];
  const fileToOwners = new Map<string, string[]>();
  for (const node of list.nodes) {
    const detail = await client.post<NodeDetailResponse>('/api/mcp/nodes/get', {
      nodeId: node.id,
    });
    const paths = new Set<string>();
    for (const file of detail.node.files) {
      paths.add(file.path);
      const existing = fileToOwners.get(file.path);
      if (existing) {
        if (!existing.includes(node.id)) existing.push(node.id);
      } else {
        fileToOwners.set(file.path, [node.id]);
      }
    }
    const meta = detail.node.metadata ?? undefined;
    nodes.push({
      id: node.id,
      filePaths: paths,
      route: typeof meta?.route === 'string' ? meta.route : undefined,
      apiPaths: Array.isArray(meta?.apiPaths)
        ? meta!.apiPaths.filter((p): p is string => typeof p === 'string')
        : undefined,
    });
  }
  return { nodes, fileToOwners };
}

function countLinkedFiles(fileToOwners: ReadonlyMap<string, ReadonlyArray<string>>): number {
  return fileToOwners.size;
}

/**
 * Build a ts-morph SourceFile once and hand it to the navigation +
 * data-flow walkers. Shares the configuration block with
 * {@link extractImportSpecifiers} — JSX allowed (`jsx: 1` = preserve),
 * JS allowed, no tsconfig pickup.
 *
 * Intentionally NOT folded into `extractImportSpecifiers` so the
 * existing function — which has its own unit tests — keeps its exact
 * behavior and the Sprint 3 path can grow independently.
 */
function parseSourceFile(sourceText: string, filePath: string): SourceFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 1 },
  });
  return project.createSourceFile(filePath, sourceText, { overwrite: true });
}
