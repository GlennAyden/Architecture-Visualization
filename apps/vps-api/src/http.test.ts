// @vitest-environment node

import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { mkdtempSync, rmSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createLocalAuthStore, type LocalAuthStore } from './auth-store.js';
import { createVpsApiServer, type ScanCommandRunner, type VpsApiOptions } from './http.js';

describe('VPS auth API', () => {
  const tempDirs: string[] = [];
  let store: LocalAuthStore;
  let privateKeyPem: string;
  let publicKey: CryptoKey;

  beforeEach(async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'arch-viz-vps-api-'));
    tempDirs.push(dir);
    store = createLocalAuthStore({ dbPath: path.join(dir, 'auth.sqlite') });
    const keys = await generateKeyPair('ES256', { extractable: true });
    privateKeyPem = await exportPKCS8(keys.privateKey);
    publicKey = keys.publicKey;
  });

  afterEach(() => {
    store.close();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function withServer<T>(
    fn: (baseUrl: string) => Promise<T>,
    overrides: Partial<VpsApiOptions> = {},
  ): Promise<T> {
    const server = createVpsApiServer({
      store,
      proxyToken: 'proxy-secret',
      jwtPrivateKey: privateKeyPem,
      jwtIssuer: 'https://auth.archviz.example',
      jwtAudience: 'convex',
      ...overrides,
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    try {
      return await fn(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  function post(baseUrl: string, pathName: string, body: unknown, token = 'proxy-secret') {
    return fetch(`${baseUrl}${pathName}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  async function withProcessEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(vars)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
    try {
      return await fn();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  async function waitFor<T>(fn: () => Promise<T | null>): Promise<T> {
    for (let i = 0; i < 40; i += 1) {
      const value = await fn();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for condition');
  }

  test('rejects auth requests without the Vercel proxy token', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/auth/me`, { method: 'POST' });

      expect(response.status).toBe(401);
    });
  });

  test('setup creates the first admin and closes setup afterward', async () => {
    await withServer(async (baseUrl) => {
      const first = await post(baseUrl, '/auth/setup', {
        email: 'glenn@example.com',
        password: 'super-secret',
      });
      const firstBody = (await first.json()) as {
        user: { email: string };
        sessionToken: string;
        expiresAt: number;
      };

      expect(first.status).toBe(200);
      expect(firstBody.user.email).toBe('glenn@example.com');
      expect(firstBody.sessionToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
      expect(firstBody.expiresAt).toBeGreaterThan(Date.now());

      const second = await post(baseUrl, '/auth/setup', {
        email: 'second@example.com',
        password: 'super-secret',
      });

      expect(second.status).toBe(409);
    });
  });

  test('login, me, logout, and Convex token are backed by the same VPS session', async () => {
    await withServer(async (baseUrl) => {
      await post(baseUrl, '/auth/setup', {
        email: 'glenn@example.com',
        password: 'super-secret',
      });

      const badLogin = await post(baseUrl, '/auth/login', {
        email: 'glenn@example.com',
        password: 'wrong-password',
      });
      expect(badLogin.status).toBe(401);

      const login = await post(baseUrl, '/auth/login', {
        email: 'glenn@example.com',
        password: 'super-secret',
      });
      const loginBody = (await login.json()) as { sessionToken: string };
      expect(login.status).toBe(200);

      const me = await post(baseUrl, '/auth/me', { sessionToken: loginBody.sessionToken });
      await expect(me.json()).resolves.toMatchObject({
        authenticated: true,
        setupRequired: false,
        user: { email: 'glenn@example.com' },
      });

      const tokenResponse = await post(baseUrl, '/auth/convex-token', {
        sessionToken: loginBody.sessionToken,
      });
      const tokenBody = (await tokenResponse.json()) as { token: string };
      const { payload } = await jwtVerify(tokenBody.token, publicKey, {
        issuer: 'https://auth.archviz.example',
        audience: 'convex',
      });
      expect(payload.sub).toMatch(/^local:local_/);

      const logout = await post(baseUrl, '/auth/logout', { sessionToken: loginBody.sessionToken });
      expect(logout.status).toBe(200);

      const tokenAfterLogout = await post(baseUrl, '/auth/convex-token', {
        sessionToken: loginBody.sessionToken,
      });
      expect(tokenAfterLogout.status).toBe(401);
    });
  });

  test('rescan endpoint runs scanner steps so the final orphan snapshot becomes newest', async () => {
    const calls: Array<{ step: string; subcommand: string; cwd: string }> = [];
    const runner: ScanCommandRunner = async (step, _command, args, options) => {
      calls.push({ step, subcommand: args.at(-1) ?? '', cwd: options.cwd });
      return {
        name: step,
        status: 'completed',
        exitCode: 0,
        durationMs: 1,
        output: `${step} ok`,
      };
    };

    await withProcessEnv(
      {
        ARCHITECTURE_PROJECT_ID: 'projects:abc',
        ARCHITECTURE_REPO_PATH: tempDirs[0]!,
      },
      async () => {
        await withServer(
          async (baseUrl) => {
            const started = await post(baseUrl, '/scans/rescan', {
              projectId: 'projects:abc',
            });
            expect(started.status).toBe(202);

            const completed = await waitFor(async () => {
              const response = await post(baseUrl, '/scans/rescan/status', {
                projectId: 'projects:abc',
              });
              const body = (await response.json()) as {
                job: { status: string; steps: Array<{ name: string }> } | null;
              };
              return body.job?.status === 'completed' ? body.job : null;
            });

            expect(completed.steps.map((step) => step.name)).toEqual([
              'scan-orphans-initial',
              'scan-imports',
              'scan-orphans-final',
              'scan-drift',
            ]);
          },
          { scanCommandRunner: runner },
        );
      },
    );

    expect(calls).toEqual([
      { step: 'scan-orphans-initial', subcommand: 'scan-orphans', cwd: tempDirs[0] },
      { step: 'scan-imports', subcommand: 'scan-imports', cwd: tempDirs[0] },
      { step: 'scan-orphans-final', subcommand: 'scan-orphans', cwd: tempDirs[0] },
      { step: 'scan-drift', subcommand: 'scan-drift', cwd: tempDirs[0] },
    ]);
  });

  test('rescan endpoint refuses to scan a project outside the VPS guard', async () => {
    await withProcessEnv(
      {
        ARCHITECTURE_PROJECT_ID: 'projects:expected',
        ARCHITECTURE_REPO_PATH: tempDirs[0]!,
      },
      async () => {
        await withServer(async (baseUrl) => {
          const response = await post(baseUrl, '/scans/rescan', {
            projectId: 'projects:other',
          });

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toMatchObject({
            error: 'Rescan project does not match the configured VPS project guard',
          });
        });
      },
    );
  });

  test('rescan endpoint marks the job failed when the scanner runner throws', async () => {
    await withProcessEnv(
      {
        ARCHITECTURE_PROJECT_ID: 'projects:abc',
        ARCHITECTURE_REPO_PATH: tempDirs[0]!,
      },
      async () => {
        await withServer(
          async (baseUrl) => {
            const started = await post(baseUrl, '/scans/rescan', {
              projectId: 'projects:abc',
            });
            expect(started.status).toBe(202);

            const failed = await waitFor(async () => {
              const response = await post(baseUrl, '/scans/rescan/status', {
                projectId: 'projects:abc',
              });
              const body = (await response.json()) as {
                job: { status: string; errorMessage?: string } | null;
              };
              return body.job?.status === 'failed' ? body.job : null;
            });

            expect(failed.errorMessage).toContain('scan-orphans-initial failed');
          },
          {
            scanCommandRunner: async () => {
              throw new Error('scanner unavailable with archv_secret');
            },
          },
        );
      },
    );
  });

  test('Hermes mapping endpoint starts an async job and submits completed suggestions', async () => {
    let resolveSubmitted: (body: Record<string, unknown>) => void = () => undefined;
    const submitted = new Promise<Record<string, unknown>>((resolve) => {
      resolveSubmitted = resolve;
    });

    await withServer(
      async (baseUrl) => {
        const response = await post(baseUrl, '/hermes/mapping-runs/start', {
          runId: 'runs:abc',
          submitToken: 'submit-token-submit-token-submit-token',
          convexSiteUrl: 'https://archviz.convex.site',
          context: {
            runId: 'runs:abc',
            project: { _id: 'projects:abc', name: 'Arch Viz' },
            layers: [{ _id: 'layers:infra', name: 'Infra', position: 0 }],
            nodes: [],
            latestScan: { data: { orphans: ['convex/_generated/api.js'] } },
            suggestions: [],
          },
        });

        expect(response.status).toBe(202);
        await expect(response.json()).resolves.toMatchObject({
          ok: true,
          status: 'queued',
          runId: 'runs:abc',
        });
      },
      {
        hermesMapper: async () => ({
          suggestions: [
            {
              filePath: 'convex/_generated/api.js',
              action: 'ignore',
              confidence: 0.96,
              reason: 'Generated file.',
              semanticKind: 'unknown',
              fileRole: 'support',
              source: 'hermes',
            },
          ],
          relationshipSuggestions: [
            {
              sourceNodeId: 'nodes:web',
              targetNodeId: 'nodes:backend',
              type: 'dependency',
              label: 'imports',
              confidence: 0.91,
              reason: 'The web node imports backend code.',
              evidence: ['apps/web/page.tsx imports apps/api/router.ts'],
              source: 'hermes',
            },
          ],
          flowSuggestions: [
            {
              title: 'Web reaches backend',
              description: 'The web surface calls backend code.',
              kind: 'user_journey',
              nodeIds: ['nodes:web', 'nodes:backend'],
              edgeRefs: [
                {
                  sourceNodeId: 'nodes:web',
                  targetNodeId: 'nodes:backend',
                  type: 'dependency',
                },
              ],
              steps: [
                {
                  title: 'Web',
                  description: 'Start from the web surface.',
                  nodeIds: ['nodes:web'],
                },
                {
                  title: 'Backend',
                  description: 'Continue into backend logic.',
                  nodeIds: ['nodes:backend'],
                },
              ],
              confidence: 0.91,
              reason: 'The dependency describes a meaningful path.',
              evidence: ['apps/web/page.tsx imports apps/api/router.ts'],
              source: 'hermes',
            },
          ],
        }),
        fetchImpl: async (_url, init) => {
          resolveSubmitted(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      },
    );

    await expect(submitted).resolves.toMatchObject({
      runId: 'runs:abc',
      submitToken: 'submit-token-submit-token-submit-token',
      status: 'completed',
      suggestions: [
        {
          filePath: 'convex/_generated/api.js',
          action: 'ignore',
          semanticKind: 'unknown',
          fileRole: 'support',
        },
      ],
      relationshipSuggestions: [
        {
          sourceNodeId: 'nodes:web',
          targetNodeId: 'nodes:backend',
          type: 'dependency',
        },
      ],
      flowSuggestions: [
        {
          title: 'Web reaches backend',
          kind: 'user_journey',
          nodeIds: ['nodes:web', 'nodes:backend'],
        },
      ],
    });
  });

  test('Hermes mapping endpoint reports safe failed completion when mapper throws', async () => {
    let resolveSubmitted: (body: Record<string, unknown>) => void = () => undefined;
    const submitted = new Promise<Record<string, unknown>>((resolve) => {
      resolveSubmitted = resolve;
    });

    await withServer(
      async (baseUrl) => {
        const response = await post(baseUrl, '/hermes/mapping-runs/start', {
          runId: 'runs:failed',
          submitToken: 'submit-token-submit-token-submit-token',
          convexSiteUrl: 'https://archviz.convex.site',
          context: {
            runId: 'runs:failed',
            project: { _id: 'projects:abc', name: 'Arch Viz' },
            layers: [],
            nodes: [],
            latestScan: { data: { orphans: ['src/a.ts'] } },
            suggestions: [],
          },
        });

        expect(response.status).toBe(202);
      },
      {
        hermesMapper: async () => {
          throw new Error('failed with archv_secretvalue and Bearer secret.jwt');
        },
        fetchImpl: async (_url, init) => {
          resolveSubmitted(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      },
    );

    const body = await submitted;
    expect(body).toMatchObject({
      runId: 'runs:failed',
      status: 'failed',
    });
    expect(String(body.errorMessage)).toContain('[redacted-token]');
    expect(String(body.errorMessage)).toContain('Bearer [redacted]');
  });
});
