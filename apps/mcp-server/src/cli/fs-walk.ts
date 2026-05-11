import type { Dirent } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Source file extensions we care about — these are the only files the
 * canvas tracks for import / orphan / drift scans. Adding more here means
 * the walk will pick up new file types automatically.
 */
export const SOURCE_EXTENSIONS: ReadonlyArray<string> = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
];

/**
 * Directory names we never descend into. Walking node_modules etc. would
 * dwarf the repo in entries and is never the user's intent. Any dir starting
 * with `.` is also skipped (`.git`, `.next`, `.vercel`, `.turbo`, ...).
 */
const SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  'build',
  'coverage',
]);

const DEFAULT_MAX_FILES = 10_000;

export interface WalkOptions {
  /** Hard upper bound on entries returned. Defaults to 10,000. */
  maxFiles?: number;
  /** Override SOURCE_EXTENSIONS (used by tests to assert filtering). */
  extensions?: ReadonlyArray<string>;
}

export interface WalkResult {
  /** Repo-relative POSIX paths of source files found. */
  files: string[];
  /** True when the walk hit `maxFiles` and stopped early. */
  truncated: boolean;
}

function shouldSkipDir(name: string): boolean {
  if (SKIP_DIR_NAMES.has(name)) return true;
  if (name.startsWith('.')) return true;
  return false;
}

function isSourceFile(name: string, extensions: ReadonlyArray<string>): boolean {
  const lower = name.toLowerCase();
  for (const ext of extensions) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

/**
 * Recursively walk `rootDir`, returning repo-relative POSIX paths of every
 * source file (per `extensions`). Skips noise directories and bails at
 * `maxFiles` to avoid runaway walks on misconfigured roots.
 *
 * The walk is synchronous — at the scale we care about (≤ 10k entries) the
 * blocking cost is negligible and async adds complexity without payoff.
 */
export function walkSourceFiles(rootDir: string, options: WalkOptions = {}): WalkResult {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const extensions = options.extensions ?? SOURCE_EXTENSIONS;
  const out: string[] = [];
  let truncated = false;

  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      // Unreadable directory (permissions, race). Skip silently — the scan
      // is best-effort and we'd rather miss a folder than abort the run.
      continue;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        stack.push(abs);
      } else if (entry.isFile()) {
        if (!isSourceFile(entry.name, extensions)) continue;
        out.push(toPosix(relative(rootDir, abs)));
        if (out.length >= maxFiles) {
          truncated = true;
          return { files: out, truncated };
        }
      } else if (entry.isSymbolicLink()) {
        // Cheap symlink handling: follow only if it points to a file. Avoid
        // recursing into symlinked dirs to dodge cycles.
        let s;
        try {
          s = statSync(abs);
        } catch {
          continue;
        }
        if (s.isFile() && isSourceFile(entry.name, extensions)) {
          out.push(toPosix(relative(rootDir, abs)));
          if (out.length >= maxFiles) {
            truncated = true;
            return { files: out, truncated };
          }
        }
      }
    }
  }

  return { files: out, truncated };
}
