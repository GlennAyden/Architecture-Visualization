// @vitest-environment node

import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { mkdtempSync, rmSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createLocalAuthStore, type LocalAuthStore } from './auth-store.js';
import { createVpsApiServer, type VpsApiOptions } from './http.js';

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
      suggestions: [{ filePath: 'convex/_generated/api.js', action: 'ignore' }],
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
