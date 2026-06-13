// @vitest-environment node

import { afterEach, describe, expect, test, vi } from 'vitest';

import { callAuthBackend, stripPrivateAuthFields } from './proxy';

describe('web auth proxy', () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('removes VPS session internals before responding to the browser', () => {
    expect(
      stripPrivateAuthFields({
        sessionToken: 'secret-session-token',
        expiresAt: 123,
        setupRequired: false,
        user: { id: 'local_1', email: 'glenn@example.com' },
      }),
    ).toEqual({
      setupRequired: false,
      user: { id: 'local_1', email: 'glenn@example.com' },
    });
  });

  test('fails loudly when Vercel proxy env is not configured', async () => {
    delete process.env.ARCHVIZ_AUTH_BACKEND_URL;
    delete process.env.ARCHVIZ_AUTH_BACKEND_TOKEN;

    await expect(callAuthBackend('/auth/me')).resolves.toEqual({
      status: 503,
      data: { error: 'Arch Viz auth backend is not configured' },
    });
  });

  test('calls the VPS backend with the private Vercel proxy token', async () => {
    process.env.ARCHVIZ_AUTH_BACKEND_URL = 'https://auth.archviz.example';
    process.env.ARCHVIZ_AUTH_BACKEND_TOKEN = 'proxy-secret';
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(callAuthBackend('/auth/logout', { sessionToken: 'session' })).resolves.toEqual({
      status: 200,
      data: { ok: true },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/auth/logout', 'https://auth.archviz.example'),
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer proxy-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionToken: 'session' }),
        cache: 'no-store',
      },
    );
  });
});
