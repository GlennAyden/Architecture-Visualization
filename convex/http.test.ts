import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.{ts,js}');

const fakeIdentity = (subject: string, email: string) => ({
  subject,
  email,
  tokenIdentifier: `https://test.clerk.accounts.dev|${subject}`,
  issuer: 'https://test.clerk.accounts.dev',
});

async function seedTokenForUser(t: ReturnType<typeof convexTest>) {
  const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
  const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
  const { rawToken } = await asUser.mutation(api.apiTokens.create, {
    projectId,
    name: 'laptop',
  });
  return { asUser, projectId, rawToken };
}

describe('POST /api/mcp/health', () => {
  test('returns 401 when x-api-key is missing', async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch('/api/mcp/health', { method: 'POST' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('unauthorized');
  });

  test('returns 401 for an unknown token', async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch('/api/mcp/health', {
      method: 'POST',
      headers: { 'x-api-key': 'archv_unknown' },
    });
    expect(res.status).toBe(401);
  });

  test('returns 200 with project name + token name for a valid token', async () => {
    const t = convexTest(schema, modules);
    const { projectId, rawToken } = await seedTokenForUser(t);

    const res = await t.fetch('/api/mcp/health', {
      method: 'POST',
      headers: { 'x-api-key': rawToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projectId).toEqual(projectId);
    expect(body.projectName).toEqual('P');
    expect(body.tokenName).toEqual('laptop');
  });
});
