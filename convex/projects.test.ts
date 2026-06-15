import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

// pnpm's nested node_modules confuses convex-test's auto-discovery; provide
// modules explicitly via Vite's `import.meta.glob`. Must include _generated.
const modules = import.meta.glob('./**/*.{ts,js}');

function localSubject(subject: string) {
  return subject.startsWith('local:') ? subject : `local:${subject}`;
}

const fakeIdentity = (subject: string, email: string) => {
  const subjectId = localSubject(subject);
  return {
    subject: subjectId,
    email,
    tokenIdentifier: `https://archviz-auth.test|${subjectId}`,
    issuer: 'https://archviz-auth.test',
  };
};

describe('projects', () => {
  test('list returns empty array for unauthenticated user', async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(api.projects.list);
    expect(result).toEqual([]);
  });

  test('local auth reuses an existing profile with the same email', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert('profiles', {
        clerkId: 'old-provider-subject',
        email: 'glenn@example.com',
      });
      await ctx.db.insert('projects', {
        userId,
        name: 'Existing canvas',
        slug: 'existing-canvas',
      });
    });

    const asLocalUser = t.withIdentity(fakeIdentity('local:local_user_1', 'glenn@example.com'));
    const list = await asLocalUser.query(api.projects.list);

    expect(list.map((project) => project.name)).toEqual(['Existing canvas']);
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

  test('seeds default architecture layers so a new project has a usable canvas structure', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectId = await asUser.mutation(api.projects.create, { name: 'Layered' });

    const layers = await asUser.query(api.projectLayers.listByProject, { projectId });
    expect(layers.map((layer) => layer.name)).toEqual([
      'Surfaces',
      'UI Modules',
      'Product Capabilities',
      'Application / API',
      'Data & State',
      'Agents / Automation',
      'External Services',
      'Infra / Delivery',
    ]);
    expect(layers.map((layer) => layer.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(layers.map((layer) => layer.purpose)).toEqual([
      'surfaces',
      'ui_modules',
      'capabilities',
      'application',
      'data',
      'agents',
      'external',
      'infra',
    ]);
  });

  test('creates a custom layer after seeded layers so manual architecture sections keep order', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectId = await asUser.mutation(api.projects.create, { name: 'Custom Layers' });
    await asUser.mutation(api.projectLayers.create, { projectId, name: 'Integrations' });

    const layers = await asUser.query(api.projectLayers.listByProject, { projectId });
    expect(layers.at(-1)?.name).toEqual('Integrations');
    expect(layers.at(-1)?.position).toEqual(8);
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

  test('removes project layers because layers are owned by the project lifecycle', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectId = await asUser.mutation(api.projects.create, { name: 'Disposable' });
    await asUser.mutation(api.projectLayers.create, { projectId, name: 'Custom' });

    await asUser.mutation(api.projects.remove, { id: projectId });

    await t.run(async (ctx) => {
      const remaining = await ctx.db.query('projectLayers').collect();
      expect(remaining.filter((layer) => layer.projectId === projectId)).toEqual([]);
    });
  });
});
