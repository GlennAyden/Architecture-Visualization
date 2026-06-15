import { describe, expect, test } from 'vitest';
import { buildDriftPayload, computeDrift } from './scan-drift.js';

describe('computeDrift', () => {
  test('records linked paths that no longer exist on disk as "missing"', () => {
    // WHY: a linked path that vanished from disk is the most actionable
    // signal scan-drift can deliver — it's exactly when the canvas is out
    // of sync with reality. Missing this case makes the command useless.
    const drift = computeDrift({
      linked: [
        { nodeId: 'n1', path: 'src/a.ts' },
        { nodeId: 'n2', path: 'src/b.ts' },
      ],
      repoFiles: ['src/a.ts'],
      exists: (p) => p === 'src/a.ts',
    });
    expect(drift).toEqual([{ kind: 'missing', nodeId: 'n2', path: 'src/b.ts' }]);
  });

  test('emits a renamed_candidate when a same-basename file exists in another directory', () => {
    // WHY: refactors that move a file across directories should be a
    // one-click fix in the canvas, not a delete-then-relink. The
    // basename heuristic is the cheapest signal that catches this case.
    const drift = computeDrift({
      linked: [{ nodeId: 'n1', path: 'src/old/util.ts' }],
      repoFiles: ['src/new/util.ts'],
      exists: () => false,
    });
    expect(drift).toEqual([
      { kind: 'missing', nodeId: 'n1', path: 'src/old/util.ts' },
      {
        kind: 'renamed_candidate',
        nodeId: 'n1',
        oldPath: 'src/old/util.ts',
        newPath: 'src/new/util.ts',
      },
    ]);
  });

  test('does NOT emit rename candidates when no same-basename peer exists', () => {
    // WHY: spurious rename suggestions erode trust in the feature. If the
    // basename is unique on disk, just say "missing" and stop.
    const drift = computeDrift({
      linked: [{ nodeId: 'n1', path: 'src/gone.ts' }],
      repoFiles: ['src/something-else.ts'],
      exists: () => false,
    });
    expect(drift).toEqual([{ kind: 'missing', nodeId: 'n1', path: 'src/gone.ts' }]);
  });

  test('returns an empty list when every linked file still exists', () => {
    expect(
      computeDrift({
        linked: [{ nodeId: 'n1', path: 'src/a.ts' }],
        repoFiles: ['src/a.ts'],
        exists: () => true,
      }),
    ).toEqual([]);
  });
});

describe('buildDriftPayload', () => {
  test('flags truncation past the hard cap', () => {
    // WHY: drift entries can blow past the 1MB body cap on giant repos.
    // A silent overflow would produce a 413; truncate visibly instead.
    const entries = Array.from({ length: 1_200 }, (_, i) => ({
      kind: 'missing' as const,
      nodeId: `n${i}`,
      path: `src/f${i}.ts`,
    }));
    const payload = buildDriftPayload(entries, 1);
    expect(payload.truncated).toBe(true);
    expect(payload.drift.length).toBe(1_000);
  });

  test('omits truncated flag for normal-sized payloads', () => {
    const payload = buildDriftPayload([{ kind: 'missing', nodeId: 'n', path: 'a.ts' }], 99);
    expect(payload.truncated).toBeUndefined();
    expect(payload.scannedAt).toBe(99);
  });
});
