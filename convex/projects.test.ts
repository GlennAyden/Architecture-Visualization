import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

// pnpm's nested node_modules confuses convex-test's auto-discovery; provide
// modules explicitly via Vite's `import.meta.glob`. Must include _generated.
const modules = import.meta.glob('./**/*.{ts,js}');

const fakeIdentity = (subject: string, email: string) => ({
  subject,
  email,
  tokenIdentifier: `https://test.clerk.accounts.dev|${subject}`,
  issuer: 'https://test.clerk.accounts.dev',
});

describe('projects', () => {
  test('list returns empty array for unauthenticated user', async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(api.projects.list);
    expect(result).toEqual([]);
  });
});

describe('projects.create', () => {
  test('creates a project for the signed-in user with a slug derived from the name', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const id = await asUser.mutation(api.projects.create, { name: 'My First Project' });

    const list = await asUser.query(api.projects.list);
    expect(list).toHaveLength(1);
    expect(list[0]._id).toEqual(id);
    expect(list[0].name).toEqual('My First Project');
    expect(list[0].slug).toEqual('my-first-project');
  });

  test('appends -2 when the slug is already used by the same user', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    await asUser.mutation(api.projects.create, { name: 'Notes' });
    await asUser.mutation(api.projects.create, { name: 'Notes' });
    const list = await asUser.query(api.projects.list);

    expect(list.map((p) => p.slug).sort()).toEqual(['notes', 'notes-2']);
  });

  test('rejects empty names', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    await expect(asUser.mutation(api.projects.create, { name: '   ' })).rejects.toThrow(
      /Project name is required/,
    );
  });

  test('rejects creation when not signed in', async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.projects.create, { name: 'X' })).rejects.toThrow(/Unauthorized/);
  });
});

describe('projects.rename', () => {
  test('updates the name of the requesting user’s project', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const id = await asUser.mutation(api.projects.create, { name: 'Old name' });
    await asUser.mutation(api.projects.rename, { id, name: 'New name' });

    const project = await asUser.query(api.projects.get, { id });
    expect(project.name).toEqual('New name');
  });

  test('refuses to rename another user’s project', async () => {
    const t = convexTest(schema, modules);
    const asAlice = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));
    const asBob = t.withIdentity(fakeIdentity('user_bob', 'bob@example.com'));

    const id = await asAlice.mutation(api.projects.create, { name: 'Alice project' });

    await expect(asBob.mutation(api.projects.rename, { id, name: 'Hijack' })).rejects.toThrow(
      /Unauthorized/,
    );
  });
});

describe('projects.remove', () => {
  test('removes the project owned by the requesting user', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const id = await asUser.mutation(api.projects.create, { name: 'Disposable' });
    await asUser.mutation(api.projects.remove, { id });

    const list = await asUser.query(api.projects.list);
    expect(list).toEqual([]);
  });

  test('refuses to remove another user’s project', async () => {
    const t = convexTest(schema, modules);
    const asAlice = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));
    const asBob = t.withIdentity(fakeIdentity('user_bob', 'bob@example.com'));

    const id = await asAlice.mutation(api.projects.create, { name: 'Alice project' });

    await expect(asBob.mutation(api.projects.remove, { id })).rejects.toThrow(/Unauthorized/);
  });
});
