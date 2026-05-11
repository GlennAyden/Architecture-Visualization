import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Project, SyntaxKind } from 'ts-morph';
import { ConvexMcpClient } from '../client.js';
import { loadConfig } from '../config.js';
import { SOURCE_EXTENSIONS } from './fs-walk.js';
import { progress, summary } from './output.js';

/**
 * Maximum number of resolved imports per /api/mcp/files/auto_link call.
 * The endpoint accepts more, but chunking keeps each request small enough
 * to retry independently and keeps a single rogue file from ballooning the
 * payload past the 1MB body cap shared by all MCP routes.
 */
const AUTO_LINK_CHUNK_SIZE = 20;

interface NodeListResponse {
  nodes: { id: string; name: string; type: string; parentId: string | null }[];
}

interface NodeDetailResponse {
  node: { id: string; name: string; files: { id: string; path: string }[] };
}

interface AutoLinkResponse {
  linked: number;
  alreadyLinked: number;
  skipped: number;
  matchedNodes: number;
}

export interface ScanImportsResult {
  filesScanned: number;
  linked: number;
  alreadyLinked: number;
  skipped: number;
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
export function isLocalImport(spec: string): boolean {
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
  // Strip importer filename → directory containing it.
  const importerDir = importerAbs.substring(0, importerAbs.lastIndexOf(sep));
  const baseAbs = isAbsolute(spec) ? spec : resolve(importerDir, spec);

  const candidates: string[] = [];
  // Exact-match (only if it has an explicit extension — otherwise this
  // would match a directory and short-circuit the index.<ext> search).
  const hasExplicitExt = extensions.some((e) => baseAbs.toLowerCase().endsWith(e));
  if (hasExplicitExt) candidates.push(baseAbs);
  // Add extension
  for (const ext of extensions) candidates.push(baseAbs + ext);
  // Treat as directory → index.<ext>
  for (const ext of extensions) candidates.push(baseAbs + sep + 'index' + ext);

  for (const c of candidates) {
    if (!existsSync(c)) continue;
    let s;
    try {
      s = statSync(c);
    } catch {
      continue;
    }
    if (!s.isFile()) continue;
    const rel = relative(repoRoot, c);
    // Reject if it resolved outside the repo (e.g. ../../other-project)
    if (rel.startsWith('..') || isAbsolute(rel)) return null;
    return rel.split(sep).join('/');
  }
  return null;
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
  void argv;
  const config = loadConfig(env);
  const client = new ConvexMcpClient(config);
  progress(`[scan-imports] project=${config.projectId}`);

  const linkedFiles = await collectLinkedFiles(client);
  progress(`[scan-imports] ${linkedFiles.size} linked files in canvas`);

  const result: ScanImportsResult = { filesScanned: 0, linked: 0, alreadyLinked: 0, skipped: 0 };

  for (const relPath of linkedFiles) {
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
      if (!isLocalImport(spec)) continue;
      const target = resolveLocalImport(abs, spec, cwd);
      if (!target) continue;
      if (target === relPath) continue; // self-import guard
      resolved.add(target);
    }

    result.filesScanned += 1;
    if (resolved.size === 0) continue;

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

  summary(
    `Scanned ${result.filesScanned} files → linked ${result.linked} new imports ` +
      `(${result.alreadyLinked} already linked, ${result.skipped} skipped)`,
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
