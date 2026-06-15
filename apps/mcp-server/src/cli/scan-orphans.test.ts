import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { walkSourceFiles } from './fs-walk.js';
import { buildFileFacts, buildOrphansPayload, computeOrphans } from './scan-orphans.js';

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

describe('buildFileFacts', () => {
  test('classifies source files and extracts lightweight evidence for Hermes', () => {
    const root = mkdtempSync(join(tmpdir(), 'arch-viz-facts-'));
    TMPS.push(root);
    const write = (p: string, body: string) => {
      const abs = join(root, p);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, body);
    };

    write(
      'apps/web/app/api/auth/login/route.ts',
      "import { x } from '@/lib/x'; export async function POST() {}",
    );
    write('apps/web/components/button.tsx', 'export const Button = () => null;');
    write(
      'apps/web/tsconfig.json',
      JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } }),
    );
    write('apps/web/lib/x.ts', 'export const x = true;');
    write(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }),
    );
    write('src/lib/x.ts', 'export const x = true;');
    write(
      'src/app/api/billing/route.ts',
      "import { x } from '@/lib/x'; export async function POST() {}",
    );
    write(
      'src/features/admin/users/page.tsx',
      'export default function UsersPage() { return null; }',
    );
    write('src/server/jobs/heartbeat.ts', 'export async function heartbeat() {}');
    write('convex/_generated/api.js', 'export default {};');
    write('convex/codebaseSuggestions.test.ts', 'export const testOnly = true;');
    write('eslint.config.mjs', 'export default [];');

    const facts = buildFileFacts(root, [
      'apps/web/app/api/auth/login/route.ts',
      'apps/web/components/button.tsx',
      'src/app/api/billing/route.ts',
      'src/features/admin/users/page.tsx',
      'src/server/jobs/heartbeat.ts',
      'convex/_generated/api.js',
      'convex/codebaseSuggestions.test.ts',
      'eslint.config.mjs',
    ]);

    expect(facts.map((fact) => [fact.path, fact.kind])).toEqual([
      ['apps/web/app/api/auth/login/route.ts', 'api'],
      ['apps/web/components/button.tsx', 'component'],
      ['src/app/api/billing/route.ts', 'api'],
      ['src/features/admin/users/page.tsx', 'component'],
      ['src/server/jobs/heartbeat.ts', 'api'],
      ['convex/_generated/api.js', 'generated'],
      ['convex/codebaseSuggestions.test.ts', 'test'],
      ['eslint.config.mjs', 'config'],
    ]);
    expect(facts[0]).toMatchObject({
      imports: ['@/lib/x'],
      resolvedImports: ['apps/web/lib/x.ts'],
      exports: ['POST'],
      routeHint: '/api/auth/login',
      apiHint: '/api/auth/login',
      featureHint: 'login',
      pathGroup: 'web-api',
    });
    expect(facts[2]).toMatchObject({
      imports: ['@/lib/x'],
      resolvedImports: ['src/lib/x.ts'],
      routeHint: '/api/billing',
      apiHint: '/api/billing',
      featureHint: 'billing',
      pathGroup: 'web-api',
    });
    expect(facts[3]).toMatchObject({
      featureHint: 'admin',
      pathGroup: 'features/admin',
    });
    expect(facts[4]).toMatchObject({
      featureHint: 'jobs',
      pathGroup: 'server',
    });
    expect(facts[6]).toMatchObject({
      testTargetHint: 'convex/codebaseSuggestions.ts',
      pathGroup: 'convex',
    });
  });

  test('extracts product UI facts from a dashboard surface without sending raw file content', () => {
    const root = mkdtempSync(join(tmpdir(), 'arch-viz-product-facts-'));
    TMPS.push(root);
    const write = (p: string, body: string) => {
      const abs = join(root, p);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, body);
    };

    write(
      'src/app/dashboard/page.tsx',
      `
        export default function DashboardPage() {
          return (
            <main>
              <header aria-label="Notification language profile back to home">
                <button title="Notifications">Bell</button>
                <button>ID</button>
                <button>EN</button>
                <button>Back to Home</button>
                <button>Profile account</button>
              </header>
              <section>
                <h1>Welcome, Expandly Admin! Let's get you started</h1>
                <p>Finish these quick steps to unlock the full experience.</p>
                <button>Install extension</button>
              </section>
              <section>
                <h2>Activate a plan or redeem a promo code</h2>
                <button>Redeem code</button>
                <button>View plans</button>
              </section>
              <section>
                <h2>Feature updates</h2>
                <p>See what's new this week.</p>
              </section>
            </main>
          );
        }
      `,
    );
    write('src/app/admin/users/page.tsx', 'export default function AdminUsers() { return null; }');

    const facts = buildFileFacts(root, [
      'src/app/dashboard/page.tsx',
      'src/app/admin/users/page.tsx',
    ]);
    const dashboard = facts[0]!;

    expect(dashboard).toMatchObject({
      path: 'src/app/dashboard/page.tsx',
      kind: 'component',
      routeHint: '/dashboard',
      productArea: 'user',
    });
    expect(dashboard.capabilityHints).toEqual(
      expect.arrayContaining([
        'onboarding',
        'billing_subscription',
        'notifications',
        'localization',
        'profile',
        'extension_services',
        'feature_updates',
      ]),
    );
    expect(dashboard.ctaHints).toEqual(
      expect.arrayContaining(['Install extension', 'Redeem code', 'View plans', 'Back to Home']),
    );
    expect(dashboard.textHints?.join(' ')).not.toContain('return (');
    expect(dashboard.uiBlocks?.map((block) => block.key)).toEqual(
      expect.arrayContaining([
        'header_controls',
        'onboarding',
        'billing_subscription',
        'notifications',
        'localization',
        'profile',
        'extension_services',
        'feature_updates',
      ]),
    );
    expect(facts[1]).toMatchObject({ productArea: 'admin', featureHint: 'users' });
  });
});
