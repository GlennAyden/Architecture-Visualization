#!/usr/bin/env node
// Claude Code PostToolUse hook for Edit / Write / MultiEdit.
//
// Auto-links imports discovered in the edited file onto every node that
// already owns the file. Sibling to log-activity.mjs — different concern
// (link maintenance vs. activity logging) so we keep them separate; both
// fire on the same PostToolUse event.
//
// Strategy: regex-only parser. We deliberately avoid ts-morph here even
// though the CLI uses it, because hook startup latency matters and adding
// ~10MB of TypeScript Compiler API would dominate edit-time cost. The
// trade-off: we won't catch alias-resolved imports (e.g. `@/components/X`)
// — the CLI's `scan-imports` subcommand handles those during full scans.
//
// Constraints (matching log-activity.mjs):
//   - NEVER block Claude Code's tool pipeline. Swallow every error, exit 0.
//   - Cap 20 resolved imports per fire to prevent runaway fan-out.
//   - Skip silently when env is missing or the file is not a TS/JS source.

import { readFileSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, join } from 'node:path';

const PROJECT_ROOT = process.cwd();
const MAX_IMPORTS_PER_FIRE = 20;
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const RESOLUTION_CANDIDATES = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs'];

function loadDotenv() {
  try {
    const text = readFileSync(resolve(PROJECT_ROOT, '.env.local'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
      if (!m) continue;
      const [, key, raw] = m;
      if (process.env[key] !== undefined) continue;
      const val = raw.replace(/^['"]|['"]$/g, '');
      process.env[key] = val;
    }
  } catch {
    // .env.local missing is fine — env may be provided by the OS instead.
  }
}

async function readStdinJson() {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  if (!data.trim()) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function toRepoRelative(absOrRel) {
  if (!absOrRel) return null;
  const abs = isAbsolute(absOrRel) ? absOrRel : resolve(PROJECT_ROOT, absOrRel);
  const rel = relative(PROJECT_ROOT, abs);
  if (!rel || rel.startsWith('..')) return null;
  return rel.replace(/\\/g, '/');
}

function fileExists(absPath) {
  try {
    return statSync(absPath).isFile();
  } catch {
    return false;
  }
}

function isDir(absPath) {
  try {
    return statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve a relative import specifier against the importing file's directory.
 * Mirrors Node/TS module resolution at a coarse level: try the literal path,
 * then each candidate extension, then `/index.<ext>`. Returns the resolved
 * absolute path on disk, or null on miss.
 */
function resolveRelativeImport(importerAbs, spec) {
  const importerDir = dirname(importerAbs);
  const base = resolve(importerDir, spec);

  if (fileExists(base)) return base;
  for (const ext of RESOLUTION_CANDIDATES) {
    if (fileExists(base + ext)) return base + ext;
  }
  if (isDir(base)) {
    for (const ext of RESOLUTION_CANDIDATES) {
      const indexPath = join(base, 'index' + ext);
      if (fileExists(indexPath)) return indexPath;
    }
  }
  return null;
}

/**
 * Pull import specifiers out of source text. Covers:
 *   - `import X from 'spec'`
 *   - `import { a } from 'spec'`
 *   - `import 'spec'` (side-effect)
 *   - `import('spec')` (dynamic)
 *   - `export … from 'spec'` (re-export)
 *
 * We don't try to handle every edge case — the CLI scan-imports has the
 * full ts-morph parser for that. This is the hot path, so we keep it cheap.
 */
function extractImportSpecifiers(source) {
  const specs = new Set();
  const patterns = [
    /import\s+(?:[\w*\s{},$]+\s+from\s+)?['"]([^'"\n]+)['"]/g,
    /import\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /export\s+(?:[\w*\s{},$]+\s+from\s+)?['"]([^'"\n]+)['"]/g,
  ];
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(source)) !== null) {
      specs.add(m[1]);
    }
  }
  return [...specs];
}

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

async function main() {
  loadDotenv();

  const url = process.env.ARCHITECTURE_CONVEX_URL;
  const apiKey = process.env.ARCHITECTURE_API_KEY;
  if (!url || !apiKey) process.exit(0); // not configured: silent no-op

  const payload = await readStdinJson();
  if (!payload) process.exit(0);

  const filePath = payload?.tool_input?.file_path;
  if (!filePath || !isSourceFile(filePath)) process.exit(0);

  const importerAbs = isAbsolute(filePath) ? filePath : resolve(PROJECT_ROOT, filePath);
  const importerRel = toRepoRelative(importerAbs);
  if (!importerRel) process.exit(0);

  let source;
  try {
    source = readFileSync(importerAbs, 'utf8');
  } catch {
    process.exit(0); // file was deleted between Edit and the hook fire
  }

  const specs = extractImportSpecifiers(source);
  if (specs.length === 0) process.exit(0);

  // Only relative imports are worth sending. Package imports (`react`,
  // `convex/values`, `@modelcontextprotocol/sdk`) and aliases (`@/foo`)
  // aren't filesystem-resolvable here without tsconfig.paths plumbing.
  const resolved = [];
  for (const spec of specs) {
    if (!spec.startsWith('./') && !spec.startsWith('../') && spec !== '.' && spec !== '..') {
      continue;
    }
    const absResolved = resolveRelativeImport(importerAbs, spec);
    if (!absResolved) continue;
    const rel = toRepoRelative(absResolved);
    if (!rel || rel === importerRel) continue;
    if (resolved.includes(rel)) continue;
    resolved.push(rel);
    if (resolved.length >= MAX_IMPORTS_PER_FIRE) break;
  }

  if (resolved.length === 0) process.exit(0);

  try {
    await fetch(`${url}/api/mcp/files/auto_link`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        originFilePath: importerRel,
        importedFilePaths: resolved,
      }),
    });
  } catch {
    // Hooks must never block Claude Code. Swallow network/api errors.
  }
  process.exit(0);
}

main().catch(() => process.exit(0));
