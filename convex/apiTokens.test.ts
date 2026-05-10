import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { TOKEN_PREFIX } from './lib/tokens';

const modules = import.meta.glob('./**/*.{ts,js}');

const fakeIdentity = (subject: string, email: string) => ({
  subject,
  email,
  tokenIdentifier: `https://test.clerk.accounts.dev|${subject}`,
  issuer: 'https://test.clerk.accounts.dev',
});

describe('apiTokens.list', () => {
  test('returns [] for unauthenticated user', async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(api.apiTokens.list);
    expect(result).toEqual([]);
  });

  test('returns [] when user has no tokens', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    // Create a project so the profile row exists.
    await asUser.mutation(api.projects.create, { name: 'P' });
    const result = await asUser.query(api.apiTokens.list);
    expect(result).toEqual([]);
  });
});

describe('apiTokens.create', () => {
  test('creates a token, returns raw value once, list reflects it', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });

    const created = await asUser.mutation(api.apiTokens.create, {
      projectId,
      name: 'Claude Code laptop',
    });

    expect(created.rawToken.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(typeof created.tokenId).toBe('string');

    const list = await asUser.query(api.apiTokens.list);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toEqual('Claude Code laptop');
    expect(list[0]?.projectName).toEqual('P');
    expect(list[0]?.revokedAt).toBeUndefined();
  });

  test('rejects when not signed in', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });

    await expect(
      t.mutation(api.apiTokens.create, { projectId, name: 'X' }),
    ).rejects.toThrow(/Unauthorized/);
  });

  test('refuses to create a token for another user’s project', async () => {
    const t = convexTest(schema, modules);
    const asA = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const asB = t.withIdentity(fakeIdentity('user_b', 'b@example.com'));
    const projectId = await asA.mutation(api.projects.create, { name: 'A' });

    await expect(
      asB.mutation(api.apiTokens.create, { projectId, name: 'hijack' }),
    ).rejects.toThrow(/Unauthorized/);
  });

  test('rejects empty token name', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    await expect(
      asUser.mutation(api.apiTokens.create, { projectId, name: '   ' }),
    ).rejects.toThrow(/Token name is required/);
  });
});

describe('apiTokens.revoke', () => {
  test('sets revokedAt on the user’s own token', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const { tokenId } = await asUser.mutation(api.apiTokens.create, {
      projectId,
      name: 'laptop',
    });

    const before = Date.now();
    await asUser.mutation(api.apiTokens.revoke, { id: tokenId });
    const list = await asUser.query(api.apiTokens.list);

    expect(list[0]?.revokedAt).toBeGreaterThanOrEqual(before);
  });

  test('refuses to revoke another user’s token', async () => {
    const t = convexTest(schema, modules);
    const asA = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const asB = t.withIdentity(fakeIdentity('user_b', 'b@example.com'));
    const projectId = await asA.mutation(api.projects.create, { name: 'A' });
    const { tokenId } = await asA.mutation(api.apiTokens.create, {
      projectId,
      name: 'laptop',
    });

    await expect(asB.mutation(api.apiTokens.revoke, { id: tokenId })).rejects.toThrow(
      /Unauthorized/,
    );
  });

  test('is idempotent on already-revoked tokens (does not throw)', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const { tokenId } = await asUser.mutation(api.apiTokens.create, {
      projectId,
      name: 'laptop',
    });

    await asUser.mutation(api.apiTokens.revoke, { id: tokenId });
    await expect(
      asUser.mutation(api.apiTokens.revoke, { id: tokenId }),
    ).resolves.not.toThrow();
  });
});

describe('apiTokens cascade on project delete', () => {
  test('tokens are deleted when their project is deleted', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    await asUser.mutation(api.apiTokens.create, { projectId, name: 'laptop' });

    await asUser.mutation(api.projects.remove, { id: projectId });

    const list = await asUser.query(api.apiTokens.list);
    expect(list).toEqual([]);
  });
});
