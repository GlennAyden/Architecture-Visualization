import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

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

async function makeNode(t: ReturnType<typeof convexTest>) {
  const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));
  const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
  const nodeId = await asUser.mutation(api.nodes.create, {
    projectId,
    type: 'page',
    name: 'Login',
    positionX: 0,
    positionY: 0,
  });
  return { asUser, projectId, nodeId };
}

describe('kanban.create + list', () => {
  test('appends new tasks to the bottom of their column', async () => {
    const t = convexTest(schema, modules);
    const { asUser, nodeId } = await makeNode(t);

    await asUser.mutation(api.kanban.create, { nodeId, title: 'A', status: 'todo' });
    await asUser.mutation(api.kanban.create, { nodeId, title: 'B', status: 'todo' });
    await asUser.mutation(api.kanban.create, { nodeId, title: 'C', status: 'doing' });

    const tasks = await asUser.query(api.kanban.listByNode, { nodeId });
    const todo = tasks.filter((t) => t.status === 'todo');
    const doing = tasks.filter((t) => t.status === 'doing');
    expect(todo.map((t) => t.title)).toEqual(['A', 'B']);
    expect(doing.map((t) => t.title)).toEqual(['C']);
    expect(todo[0].position).toBeLessThan(todo[1].position);
  });

  test('rejects empty titles', async () => {
    const t = convexTest(schema, modules);
    const { asUser, nodeId } = await makeNode(t);

    await expect(
      asUser.mutation(api.kanban.create, { nodeId, title: '   ', status: 'todo' }),
    ).rejects.toThrow(/Task title is required/);
  });
});

describe('kanban.update', () => {
  test('moves a task between columns and places it at the bottom of the new column', async () => {
    const t = convexTest(schema, modules);
    const { asUser, nodeId } = await makeNode(t);

    await asUser.mutation(api.kanban.create, { nodeId, title: 'A', status: 'doing' });
    const moving = await asUser.mutation(api.kanban.create, {
      nodeId,
      title: 'B',
      status: 'todo',
    });
    await asUser.mutation(api.kanban.update, { id: moving, status: 'doing' });

    const tasks = await asUser.query(api.kanban.listByNode, { nodeId });
    const doing = tasks.filter((t) => t.status === 'doing');
    expect(doing.map((t) => t.title)).toEqual(['A', 'B']);
  });

  test('refuses to update another user’s task', async () => {
    const t = convexTest(schema, modules);
    const { asUser, nodeId } = await makeNode(t);
    const taskId = await asUser.mutation(api.kanban.create, {
      nodeId,
      title: 'Alice task',
      status: 'todo',
    });

    const asBob = t.withIdentity(fakeIdentity('user_bob', 'bob@example.com'));
    await expect(
      asBob.mutation(api.kanban.update, { id: taskId, title: 'Hijack' }),
    ).rejects.toThrow(/Unauthorized/);
  });
});

describe('kanban.remove', () => {
  test('removes a task', async () => {
    const t = convexTest(schema, modules);
    const { asUser, nodeId } = await makeNode(t);
    const id = await asUser.mutation(api.kanban.create, { nodeId, title: 'X', status: 'todo' });

    await asUser.mutation(api.kanban.remove, { id });

    const after = await asUser.query(api.kanban.listByNode, { nodeId });
    expect(after).toEqual([]);
  });
});

describe('kanban cascade', () => {
  test('removing a node deletes its tasks', async () => {
    const t = convexTest(schema, modules);
    const { asUser, nodeId } = await makeNode(t);
    await asUser.mutation(api.kanban.create, { nodeId, title: 'X', status: 'todo' });
    await asUser.mutation(api.kanban.create, { nodeId, title: 'Y', status: 'doing' });

    await asUser.mutation(api.nodes.remove, { id: nodeId });

    await t.run(async (ctx) => {
      const remaining = await ctx.db.query('kanbanTasks').collect();
      expect(remaining.filter((t) => t.nodeId === nodeId)).toEqual([]);
    });
  });
});
