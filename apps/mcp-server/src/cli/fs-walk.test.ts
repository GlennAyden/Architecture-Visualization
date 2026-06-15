import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { walkSourceFiles } from './fs-walk.js';

/**
 * Build a throwaway repo on disk. Each call returns a fresh tmp dir so the
 * tests stay independent.
 */
function makeFixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'arch-viz-walk-'));
  const write = (p: string, body = '') => {
    const abs = join(root, p);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  };
  write('src/index.ts');
  write('src/lib/util.ts');
  write('src/nested/deep/component.tsx');
  write('src/legacy.js');
  write('src/note.md');
  write('node_modules/whatever/index.js');
  write('.git/HEAD');
  write('dist/output.js');
  write('.next/server.js');
  write('build/cache.js');
  write('coverage/lcov.js');
  write('.cache/foo.js');
  return root;
}

const ROOTS: string[] = [];
afterAll(() => {
  // Best-effort cleanup; OS will GC tmp dirs on reboot regardless.
  for (const r of ROOTS) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe('walkSourceFiles', () => {
  test('returns source files but skips node_modules / .git / build / dotdirs', () => {
    // WHY: orphan & drift scans diff "files on disk" vs "files in canvas".
    // If node_modules ever leaked into that diff, every project would show
    // thousands of phantom orphans and the feature becomes unusable.
    const root = makeFixtureRepo();
    ROOTS.push(root);
    const { files, truncated } = walkSourceFiles(root);
    const sorted = [...files].sort();
    expect(sorted).toEqual(
      ['src/index.ts', 'src/legacy.js', 'src/lib/util.ts', 'src/nested/deep/component.tsx'].sort(),
    );
    expect(truncated).toBe(false);
    // Sanity: every excluded path must be absent.
    for (const banned of [
      'node_modules/whatever/index.js',
      '.git/HEAD',
      'dist/output.js',
      '.next/server.js',
      'build/cache.js',
      'coverage/lcov.js',
      '.cache/foo.js',
      'src/note.md',
    ]) {
      expect(files).not.toContain(banned);
    }
  });

  test('truncates when the walk hits maxFiles', () => {
    // WHY: the CLI emits a warning when the walk is partial. A silent
    // truncation would lie to the user about completeness of the scan.
    const root = mkdtempSync(join(tmpdir(), 'arch-viz-walk-cap-'));
    ROOTS.push(root);
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(join(root, `f${i}.ts`), '');
    }
    const result = walkSourceFiles(root, { maxFiles: 3 });
    expect(result.files).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  test('returns POSIX-style paths even on Windows', () => {
    // WHY: linked file paths in the canvas are stored POSIX-style. A walk
    // that returned backslashes would never match anything in the linked
    // set on Windows, breaking orphan detection.
    const root = mkdtempSync(join(tmpdir(), 'arch-viz-walk-sep-'));
    ROOTS.push(root);
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    writeFileSync(join(root, 'a', 'b', 'x.ts'), '');
    const { files } = walkSourceFiles(root);
    expect(files).toContain('a/b/x.ts');
  });
});
