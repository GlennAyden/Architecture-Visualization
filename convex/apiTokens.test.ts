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
