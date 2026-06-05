import { describe, expect, test, vi } from 'vitest';
import { ConvexApiError, ConvexMcpClient } from './client.js';
import type { McpConfig } from './config.js';

const config: McpConfig = {
  convexUrl: 'https://x.convex.site',
  apiKey: 'archv_test',
  projectId: 'projects:x',
};

function mockFetch(response: { status: number; body: unknown } | Error): typeof fetch {
  return vi.fn().mockImplementation(async () => {
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('ConvexMcpClient.post', () => {
  test('sends POST with Authorization bearer, x-api-key fallback, and json body; returns parsed response', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, value: 42 }), { status: 200 }));
    const client = new ConvexMcpClient(config, fetcher as unknown as typeof fetch);

    const result = await client.post<{ ok: boolean; value: number }>('/api/mcp/health', {
      hello: 'world',
    });

    expect(result).toEqual({ ok: true, value: 42 });
    const [calledUrl, init] = fetcher.mock.calls[0]!;
    expect(calledUrl).toBe('https://x.convex.site/api/mcp/health');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer archv_test');
    expect(init.headers['x-api-key']).toBe('archv_test');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ hello: 'world' });
  });

  test('throws ConvexApiError with structured fields on 4xx', async () => {
    const client = new ConvexMcpClient(
      config,
      mockFetch({
        status: 401,
        body: { error: { code: 'unauthorized', message: 'bad token', hint: 'rotate it' } },
      }),
    );

    await expect(client.post('/api/mcp/health', {})).rejects.toMatchObject({
      name: 'ConvexApiError',
      status: 401,
      code: 'unauthorized',
      message: 'bad token',
      hint: 'rotate it',
    });
  });

  test('falls back gracefully when error body is not JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('plain text crash', { status: 500 }));
    const client = new ConvexMcpClient(config, fetcher as unknown as typeof fetch);

    await expect(client.post('/api/mcp/health', {})).rejects.toMatchObject({
      status: 500,
      code: 'http_500',
      message: 'plain text crash',
    });
  });

  test('wraps fetch failure as network_error', async () => {
    const client = new ConvexMcpClient(config, mockFetch(new Error('ENOTFOUND')));

    await expect(client.post('/api/mcp/health', {})).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });

  test('ConvexApiError.toToolError includes code, message, and hint', () => {
    const err = new ConvexApiError(403, 'forbidden', 'Out of scope', 'Use a different token');
    expect(err.toToolError()).toEqual('[forbidden] Out of scope\nHint: Use a different token');
  });

  test('ConvexApiError.toToolError omits hint when absent', () => {
    const err = new ConvexApiError(400, 'invalid_input', 'name required');
    expect(err.toToolError()).toEqual('[invalid_input] name required');
  });
});
