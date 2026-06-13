import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api, internal } from './_generated/api';
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

describe('nodeEdges hierarchy maintenance', () => {
  test('creating a feature with parentId inserts a hierarchy edge', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('u', 'u@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const parentId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Auth',
      positionX: 0,
      positionY: 0,
    });
    const childId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'feature',
      name: 'Login Form',
      parentId,
      positionX: 0,
      positionY: 0,
    });

    const edges = await asUser.query(api.nodeEdges.listByProject, { projectId });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.type).toBe('hierarchy');
    expect(edges[0]!.sourceNodeId).toBe(parentId);
    expect(edges[0]!.targetNodeId).toBe(childId);
  });

  test('creating a top-level node (no parentId) inserts no edge', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('u', 'u@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Home',
      positionX: 0,
      positionY: 0,
    });

    const edges = await asUser.query(api.nodeEdges.listByProject, { projectId });
    expect(edges).toEqual([]);
  });

  test('deleting a node removes incoming AND outgoing edges (cascade)', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('u', 'u@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const parentId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Auth',
      positionX: 0,
      positionY: 0,
    });
    const childId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'feature',
      name: 'Login',
      parentId,
      positionX: 0,
      positionY: 0,
    });
    // Sanity: 1 edge exists.
    let edges = await asUser.query(api.nodeEdges.listByProject, { projectId });
    expect(edges).toHaveLength(1);

    // Delete the parent — should cascade-delete the child AND its edge.
    await asUser.mutation(api.nodes.remove, { id: parentId });

    edges = await asUser.query(api.nodeEdges.listByProject, { projectId });
    expect(edges).toEqual([]);
    const nodesAfter = await asUser.query(api.nodes.listByProject, { projectId });
    expect(nodesAfter.find((n) => n._id === childId)).toBeUndefined();
  });

  test('listByProject returns [] for a non-owner (lenient)', async () => {
    const t = convexTest(schema, modules);
    const asA = t.withIdentity(fakeIdentity('a', 'a@example.com'));
    const asB = t.withIdentity(fakeIdentity('b', 'b@example.com'));
    const projectId = await asA.mutation(api.projects.create, { name: 'P' });
    const parentId = await asA.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });
    await asA.mutation(api.nodes.create, {
      projectId,
      type: 'feature',
      name: 'Y',
      parentId,
      positionX: 0,
      positionY: 0,
    });

    const fromB = await asB.query(api.nodeEdges.listByProject, { projectId });
    expect(fromB).toEqual([]);
  });
});

describe('nodeEdges.remove (UI delete)', () => {
  // Why: hierarchy edges are derived from parentId. Letting the UI delete
  // them would create a desync — the parent would still point at the child
  // but no edge would render. We fail loud so the user picks a different
  // action (change parentId via update_node) instead of silently breaking.
  test('rejects deletion of a hierarchy edge', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('u', 'u@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const parentId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'P',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'feature',
      name: 'C',
      parentId,
      positionX: 0,
      positionY: 0,
    });
    const edges = await asUser.query(api.nodeEdges.listByProject, { projectId });
    const hierarchyEdgeId = edges[0]!._id;

    await expect(asUser.mutation(api.nodeEdges.remove, { id: hierarchyEdgeId })).rejects.toThrow(
      /Hierarchy edges cannot be deleted/,
    );
  });

  test('removes a non-hierarchy edge', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('u', 'u@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const a = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'A',
      positionX: 0,
      positionY: 0,
    });
    const b = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'B',
      positionX: 0,
      positionY: 0,
    });
    // Insert a dependency edge directly so we can target it for removal.
    let edgeId = '' as never;
    await t.run(async (ctx) => {
      edgeId = (await ctx.db.insert('nodeEdges', {
        projectId,
        sourceNodeId: a,
        targetNodeId: b,
        type: 'dependency',
        source: 'auto',
      })) as never;
    });

    await asUser.mutation(api.nodeEdges.remove, { id: edgeId });

    const after = await asUser.query(api.nodeEdges.listByProject, { projectId });
    expect(after).toEqual([]);
  });

  test('non-owner cannot delete edges (Unauthorized)', async () => {
    const t = convexTest(schema, modules);
    const asA = t.withIdentity(fakeIdentity('a', 'a@example.com'));
    const asB = t.withIdentity(fakeIdentity('b', 'b@example.com'));
    const projectId = await asA.mutation(api.projects.create, { name: 'P' });
    const a = await asA.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'A',
      positionX: 0,
      positionY: 0,
    });
    const b = await asA.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'B',
      positionX: 0,
      positionY: 0,
    });
    let edgeId = '' as never;
    await t.run(async (ctx) => {
      edgeId = (await ctx.db.insert('nodeEdges', {
        projectId,
        sourceNodeId: a,
        targetNodeId: b,
        type: 'dependency',
        source: 'auto',
      })) as never;
    });

    await expect(asB.mutation(api.nodeEdges.remove, { id: edgeId })).rejects.toThrow(
      /Unauthorized/,
    );
  });
});

describe('nodeEdges.backfillHierarchy', () => {
  test('creates missing hierarchy edges for pre-existing parentId rows', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('u', 'u@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });

    // Simulate "old data": insert nodes directly with parentId set but no
    // edge row — mimics what's on disk before this sprint shipped.
    const parentId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Parent',
      positionX: 0,
      positionY: 0,
    });
    let childId: string = '';
    await t.run(async (ctx) => {
      childId = await ctx.db.insert('nodes', {
        projectId,
        parentId,
        type: 'feature',
        name: 'PreExistingChild',
        positionX: 0,
        positionY: 0,
      });
    });

    // Pre-condition: no edge for the manually-inserted node.
    const before = await asUser.query(api.nodeEdges.listByProject, { projectId });
    // (The `parentId` one created via api.nodes.create has its edge already; the
    //  manually-inserted child does not.)
    const beforeForChild = before.find((e) => e.targetNodeId === childId);
    expect(beforeForChild).toBeUndefined();

    const result = await t.mutation(internal.nodeEdges.backfillHierarchy, {});
    expect(result.created).toBeGreaterThanOrEqual(1);

    const after = await asUser.query(api.nodeEdges.listByProject, { projectId });
    const afterForChild = after.find((e) => e.targetNodeId === childId);
    expect(afterForChild).toBeDefined();
    expect(afterForChild!.sourceNodeId).toBe(parentId);
    expect(afterForChild!.type).toBe('hierarchy');
  });

  test('is idempotent — running twice does not create duplicates', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('u', 'u@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const parentId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'P1',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'feature',
      name: 'C1',
      parentId,
      positionX: 0,
      positionY: 0,
    });

    await t.mutation(internal.nodeEdges.backfillHierarchy, {});
    await t.mutation(internal.nodeEdges.backfillHierarchy, {});

    const edges = await asUser.query(api.nodeEdges.listByProject, { projectId });
    expect(edges).toHaveLength(1);
  });
});
