import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import {
  chunk,
  extractImportSpecifiers,
  isLocalImport,
  resolveLocalImport,
} from './scan-imports.js';

const TMPS: string[] = [];
afterAll(() => {
  for (const t of TMPS) {
    try {
      rmSync(t, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function makeRepo(layout: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'arch-viz-imp-'));
  TMPS.push(root);
  for (const [rel, body] of Object.entries(layout)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

describe('extractImportSpecifiers', () => {
  test('returns relative specifiers from static, type-only, dynamic, and re-export forms', () => {
    // WHY: every import-shaped construct creates a real code dependency.
    // Missing any of them (e.g. dynamic import() inside a route handler)
    // would mean the canvas never learns about that dependency, defeating
    // the purpose of scan-imports.
    const text = [
      "import a from './a';",
      "import type { B } from './b';",
      "import('./c').then(() => {});",
      "export { d } from './d';",
      "import 'package-only';",
    ].join('\n');
    const specs = extractImportSpecifiers(text, '/repo/src/x.ts');
    expect(specs.sort()).toEqual(
      ['./a', './b', './c', './d', 'package-only'].sort(),
    );
  });

  test('ignores dynamic imports with a variable specifier (cannot resolve statically)', () => {
    // WHY: linking to a fabricated path = canvas claims a code edge that
    // doesn't exist. We'd rather miss an edge than invent one.
    const text = "const m = './x'; import(m);";
    const specs = extractImportSpecifiers(text, '/repo/x.ts');
    expect(specs).toEqual([]);
  });
});

describe('isLocalImport', () => {
  test('classifies relative paths as local and bare package specifiers as remote', () => {
    expect(isLocalImport('./foo')).toBe(true);
    expect(isLocalImport('../bar')).toBe(true);
    expect(isLocalImport('react')).toBe(false);
    expect(isLocalImport('@scope/pkg')).toBe(false);
    expect(isLocalImport('')).toBe(false);
  });
});

describe('resolveLocalImport', () => {
  test('resolves with explicit and implicit extensions plus index files', () => {
    // WHY: ts-morph's compiler-aware resolution wins on edge cases but the
    // CLI runs in repos where tsconfig may be missing. The fallback resolver
    // must replicate the rules every JS bundler agrees on, otherwise we'd
    // POST unresolved specifiers to auto_link and silently desync the canvas.
    const root = makeRepo({
      'src/a.ts': '',
      'src/b/index.tsx': '',
      'src/c.jsx': '',
    });
    const importer = resolve(root, 'src/root.ts');
    expect(resolveLocalImport(importer, './a', root)).toBe('src/a.ts');
    expect(resolveLocalImport(importer, './a.ts', root)).toBe('src/a.ts');
    expect(resolveLocalImport(importer, './b', root)).toBe('src/b/index.tsx');
    expect(resolveLocalImport(importer, './c', root)).toBe('src/c.jsx');
  });

  test('returns null when no candidate exists on disk', () => {
    // WHY: see resolveLocalImport jsdoc — silently fabricating a path here
    // is the worst possible failure mode for this command.
    const root = makeRepo({ 'src/a.ts': '' });
    const importer = resolve(root, 'src/root.ts');
    expect(resolveLocalImport(importer, './missing', root)).toBeNull();
  });

  test('rejects imports that resolve outside the repo root', () => {
    // WHY: a `../../sibling-project/file` import resolves to a real file but
    // we must never push paths the canvas can't display. Returning null lets
    // the caller drop the edge cleanly.
    const outer = mkdtempSync(join(tmpdir(), 'arch-viz-outer-'));
    TMPS.push(outer);
    writeFileSync(join(outer, 'sibling.ts'), '');
    const repo = makeRepo({ 'src/x.ts': '' });
    const importer = resolve(repo, 'src/x.ts');
    expect(resolveLocalImport(importer, '../../sibling', repo)).toBeNull();
  });
});

describe('chunk', () => {
  test('preserves order and respects the size cap', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk<number>([], 3)).toEqual([]);
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });
});
