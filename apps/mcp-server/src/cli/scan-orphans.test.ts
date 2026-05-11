import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { walkSourceFiles } from './fs-walk.js';
import { buildOrphansPayload, computeOrphans } from './scan-orphans.js';

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

describe('computeOrphans', () => {
  test('returns repo source files that no canvas node links to', () => {
    // WHY: the orphan definition is "code that exists but no one in the
    // canvas owns it". If we flipped the diff direction here we'd flag
    // every linked file as an orphan, drowning the user in noise — that
    // is exactly the regression this test exists to catch.
    const repoFiles = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const linked = new Set(['src/b.ts']);
    expect(computeOrphans({ repoFiles, linked })).toEqual(['src/a.ts', 'src/c.ts']);
  });

  test('returns an empty list when every file is linked', () => {
    const repoFiles = ['src/a.ts'];
    expect(computeOrphans({ repoFiles, linked: new Set(['src/a.ts']) })).toEqual([]);
  });

  test('end-to-end against a fixture filesystem matches walk minus linked set', () => {
    // WHY: walkSourceFiles + computeOrphans is the contract the command
    // depends on. A change to either side (e.g. walk starts returning
    // backslash paths on Windows) would silently break this property.
    const root = mkdtempSync(join(tmpdir(), 'arch-viz-orph-'));
    TMPS.push(root);
    const write = (p: string) => {
      const abs = join(root, p);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, '');
    };
    write('src/a.ts');
    write('src/b.ts');
    write('src/c.ts');
    write('node_modules/dep/index.js'); // must NOT appear
    const { files } = walkSourceFiles(root);
    const linked = new Set(['src/a.ts']);
    expect(computeOrphans({ repoFiles: files, linked }).sort()).toEqual(
      ['src/b.ts', 'src/c.ts'].sort(),
    );
  });
});

describe('buildOrphansPayload', () => {
  test('passes small payloads through untouched', () => {
    const repoFiles = ['src/a.ts', 'src/b.ts'];
    const orphans = ['src/a.ts'];
    const payload = buildOrphansPayload(repoFiles, orphans, 1234);
    expect(payload).toEqual({ repoFiles, orphans, scannedAt: 1234 });
    expect(payload.truncated).toBeUndefined();
  });

  test('flags truncation when repoFiles is too large to fit under the 1MB cap', () => {
    // WHY: the /scans/push endpoint enforces a 1MB body cap. Pushing past
    // it silently would surface as a 413 in production. Truncating with a
    // visible flag lets the canvas show "results are partial" rather than
    // pretending it has full data.
    const big = Array.from({ length: 9_000 }, (_, i) => `src/f${i}.ts`);
    const payload = buildOrphansPayload(big, big, 1);
    expect(payload.truncated).toBe(true);
    expect(payload.repoFiles.length).toBeLessThanOrEqual(8_000);
    expect(payload.orphans.length).toBeLessThanOrEqual(5_000);
  });
});
