import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { SOURCE_EXTENSIONS } from './fs-walk.js';

interface TsConfigLike {
  compilerOptions?: {
    baseUrl?: unknown;
    paths?: unknown;
  };
}

interface AliasPattern {
  key: string;
  targets: string[];
}

export interface ImportResolver {
  resolve(importerAbs: string, spec: string): string | null;
  isLocal(spec: string): boolean;
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === '\\') {
        i += 1;
        if (i < text.length) out += text[i]!;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += char;
  }
  return out;
}

function parseConfig(path: string): TsConfigLike | null {
  try {
    return JSON.parse(stripJsonComments(readFileSync(path, 'utf8'))) as TsConfigLike;
  } catch {
    return null;
  }
}

function loadAliasConfig(repoRoot: string): {
  baseUrlAbs: string;
  patterns: AliasPattern[];
} {
  const configFile = ['tsconfig.json', 'jsconfig.json']
    .map((name) => join(repoRoot, name))
    .find((path) => existsSync(path));
  const parsed = configFile ? parseConfig(configFile) : null;
  const compilerOptions = parsed?.compilerOptions ?? {};
  const baseUrl =
    typeof compilerOptions.baseUrl === 'string' && compilerOptions.baseUrl.trim()
      ? compilerOptions.baseUrl
      : '.';
  const paths =
    compilerOptions.paths && typeof compilerOptions.paths === 'object'
      ? (compilerOptions.paths as Record<string, unknown>)
      : {};
  const patterns = Object.entries(paths)
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
    .map(([key, value]) => ({
      key,
      targets: value.filter((target): target is string => typeof target === 'string'),
    }))
    .filter((pattern) => pattern.targets.length > 0)
    .sort((a, b) => b.key.replace('*', '').length - a.key.replace('*', '').length);
  return { baseUrlAbs: resolve(repoRoot, baseUrl), patterns };
}

function matchAlias(pattern: string, spec: string): string | null {
  const starIndex = pattern.indexOf('*');
  if (starIndex < 0) return pattern === spec ? '' : null;
  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);
  if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) return null;
  return spec.slice(prefix.length, spec.length - suffix.length);
}

function applyAliasTarget(target: string, match: string): string {
  return target.includes('*') ? target.replace(/\*/g, match) : target;
}

function candidateFiles(baseAbs: string, extensions: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  const hasExplicitExt = extensions.some((e) => baseAbs.toLowerCase().endsWith(e));
  if (hasExplicitExt) out.push(baseAbs);
  for (const ext of extensions) out.push(baseAbs + ext);
  for (const ext of extensions) out.push(baseAbs + sep + 'index' + ext);
  return out;
}

function resolveCandidate(
  repoRoot: string,
  candidates: ReadonlyArray<string>,
): string | null {
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    let stat;
    try {
      stat = statSync(candidate);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const rel = relative(repoRoot, candidate);
    if (rel.startsWith('..') || isAbsolute(rel)) return null;
    return toPosix(rel);
  }
  return null;
}

export function createImportResolver(
  repoRoot: string,
  extensions: ReadonlyArray<string> = SOURCE_EXTENSIONS,
): ImportResolver {
  const aliases = loadAliasConfig(repoRoot);

  function aliasBaseCandidates(spec: string): string[] {
    const out: string[] = [];
    for (const pattern of aliases.patterns) {
      const match = matchAlias(pattern.key, spec);
      if (match === null) continue;
      for (const target of pattern.targets) {
        out.push(resolve(aliases.baseUrlAbs, applyAliasTarget(target, match)));
      }
    }
    return out;
  }

  return {
    isLocal(spec: string): boolean {
      if (spec.length === 0) return false;
      if (spec.startsWith('.') || isAbsolute(spec)) return true;
      return aliasBaseCandidates(spec).length > 0;
    },
    resolve(importerAbs: string, spec: string): string | null {
      const importerDir = importerAbs.substring(0, importerAbs.lastIndexOf(sep));
      const bases =
        spec.startsWith('.') || isAbsolute(spec)
          ? [isAbsolute(spec) ? spec : resolve(importerDir, spec)]
          : aliasBaseCandidates(spec);
      for (const base of bases) {
        const resolved = resolveCandidate(repoRoot, candidateFiles(base, extensions));
        if (resolved) return resolved;
      }
      return null;
    },
  };
}
