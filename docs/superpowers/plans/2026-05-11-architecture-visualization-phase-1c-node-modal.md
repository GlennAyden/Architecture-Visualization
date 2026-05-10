# Architecture Visualization — Phase 1C (Node Modal: Description + Files + Kanban)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a per-node modal on double-click that lets the user edit the node's description, manage its linked files, and run a kanban (todo / doing / done). Convex stays the single source of truth and emits reactive updates, so changes in one tab appear in another.

**Architecture:** Two new Convex tables (`nodeFiles`, `kanbanTasks`), both indexed by `nodeId` and protected by the existing `requireProjectAccess` helper (looked up via the parent node's `projectId`). A shared `deleteNodeCascade(ctx, nodeId)` helper deletes a node together with its children, files, and kanban tasks, used by `nodes.remove` and `projects.remove`. The UI adds a `NodeModal` (shadcn `Dialog` + `Tabs`) that the canvas page mounts once and shows when a small Zustand store sets a `selectedNodeId`; the page-node shape's component fires the store's `open(nodeId)` on double-click. Three tab components — `DescriptionTab`, `LinkedFilesTab`, `KanbanTab` — read with `useQuery` and write with `useMutation`, keeping the modal a thin shell.

**Tech Stack:** Convex, React 19, shadcn/ui (`Tabs`, `Textarea` — added in this plan), React Hook Form, Zod, **Zustand** (new in 1C, for cross-component `selectedNodeId`), Vitest + `convex-test`.

**Prerequisites:**

- Phase 1B done (tag `phase-1b`). Nodes table + custom shape + canvas sync working.
- `pnpm test` green; `pnpm dlx convex dev` deploys cleanly.

**Out of scope for this plan (deferred to 1D and later):**

- API token generation page (1D).
- Activity log UI / events (later phase).
- Drag-to-reorder kanban tasks (status moves via dropdown only in 1C).
- Rich-text description (plain `<textarea>` only; markdown rendering is a future polish).
- Linked-files _upload_ — files are just path strings the user types.

---

## File Structure

After this plan, the new and modified files are:

```
convex/
├── schema.ts                       # Modified: add nodeFiles + kanbanTasks tables
├── nodes.ts                        # Modified: nodes.remove delegates to deleteNodeCascade
├── projects.ts                     # Modified: projects.remove delegates to deleteNodeCascade
├── lib/cascade.ts                  # New: deleteNodeCascade helper
├── nodeFiles.ts                    # New: listByNode, add, remove
├── kanban.ts                       # New: listByNode, create, update, remove
├── nodeFiles.test.ts               # New
└── kanban.test.ts                  # New

apps/web/
├── app/canvas/[projectId]/page.tsx # Modified: mount NodeModal
├── components/
│   ├── canvas/page-node-shape.tsx  # Modified: double-click triggers modalStore.open(nodeId)
│   └── node-modal/
│       ├── node-modal.tsx          # New: Dialog + Tabs shell
│       ├── description-tab.tsx     # New: debounced Textarea
│       ├── linked-files-tab.tsx    # New: input + list
│       └── kanban-tab.tsx          # New: 3 columns + cards + add task
├── components/ui/
│   ├── tabs.tsx                    # New (shadcn add)
│   └── textarea.tsx                # New (shadcn add)
└── store/
    └── modal-store.ts              # New: Zustand store (selectedNodeId)

packages/shared/
├── src/index.ts                    # Modified: re-export kanban schemas
└── src/kanban.ts                   # New: kanbanStatusSchema, taskTitleSchema
```

---

## Workflow conventions

- Run all commands from repo root unless noted.
- Keep `pnpm dlx convex dev` running side-by-side so schema changes auto-deploy.
- Before each commit: `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- Branch off `main`: `phase-1c-node-modal`. Fast-forward merge at the end.

---

## Task 1: Branch off main

- [ ] **Step 1.1: Create and switch to feature branch**

```powershell
git checkout main
git pull origin main
git checkout -b phase-1c-node-modal
```

Expected: "Switched to a new branch 'phase-1c-node-modal'".

---

## Task 2: Shared Zod schemas for kanban + node title constants

**Files:**

- Create: `packages/shared/src/kanban.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 2.1: Write `packages/shared/src/kanban.ts`**

```ts
import { z } from 'zod';

export const kanbanStatusSchema = z.union([
  z.literal('todo'),
  z.literal('doing'),
  z.literal('done'),
]);
export type KanbanStatus = z.infer<typeof kanbanStatusSchema>;

export const KANBAN_STATUSES: ReadonlyArray<KanbanStatus> = ['todo', 'doing', 'done'];

export const KANBAN_STATUS_LABEL: Record<KanbanStatus, string> = {
  todo: 'To do',
  doing: 'Doing',
  done: 'Done',
};

export const taskTitleSchema = z
  .string()
  .trim()
  .min(1, 'Task title is required')
  .max(200, 'Task title must be 200 characters or fewer');

export const taskDescriptionSchema = z.string().max(2000, '2000 characters max').optional();

export const nodeDescriptionSchema = z
  .string()
  .max(4000, 'Description must be 4000 characters or fewer');
```

- [ ] **Step 2.2: Re-export from `packages/shared/src/index.ts`**

Replace the file with:

```ts
export * from './projects';
export * from './nodes';
export * from './kanban';
```

- [ ] **Step 2.3: Verify typecheck**

```powershell
pnpm --filter @arch-viz/shared typecheck
```

- [ ] **Step 2.4: Commit**

```powershell
git add packages/shared
git commit -m "feat(shared): add kanban Zod schemas and node description limit"
```

---

## Task 3: Convex schema — nodeFiles + kanbanTasks tables

**Files:**

- Modify: `convex/schema.ts`

- [ ] **Step 3.1: Replace `convex/schema.ts`**

```ts
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  profiles: defineTable({
    clerkId: v.string(),
    email: v.string(),
  }).index('by_clerk', ['clerkId']),

  projects: defineTable({
    userId: v.id('profiles'),
    name: v.string(),
    slug: v.string(),
  })
    .index('by_user', ['userId'])
    .index('by_user_slug', ['userId', 'slug']),

  nodes: defineTable({
    projectId: v.id('projects'),
    parentId: v.optional(v.id('nodes')),
    type: v.union(v.literal('page'), v.literal('feature')),
    name: v.string(),
    description: v.optional(v.string()),
    positionX: v.number(),
    positionY: v.number(),
    metadata: v.optional(v.any()),
  })
    .index('by_project', ['projectId'])
    .index('by_parent', ['parentId']),

  nodeFiles: defineTable({
    nodeId: v.id('nodes'),
    path: v.string(),
  }).index('by_node', ['nodeId']),

  kanbanTasks: defineTable({
    nodeId: v.id('nodes'),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal('todo'), v.literal('doing'), v.literal('done')),
    position: v.number(), // higher = lower in column; we just push to bottom on create
  })
    .index('by_node', ['nodeId'])
    .index('by_node_status', ['nodeId', 'status']),
});
```

- [ ] **Step 3.2: Push schema**

```powershell
pnpm dlx convex dev --once
```

Expected: "Convex functions ready!".

- [ ] **Step 3.3: Commit**

```powershell
git add convex/schema.ts
git commit -m "feat(convex): add nodeFiles and kanbanTasks tables"
```

---

## Task 4: `deleteNodeCascade` helper + wire into existing remove paths

**Files:**

- Create: `convex/lib/cascade.ts`
- Modify: `convex/nodes.ts`
- Modify: `convex/projects.ts`

- [ ] **Step 4.1: Write `convex/lib/cascade.ts`**

```ts
import { Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';

/**
 * Delete a node together with everything that hangs off it: child nodes
 * (nested features), linked files, and kanban tasks. Recursive so deleting
 * a parent of nested features cascades cleanly.
 */
export async function deleteNodeCascade(ctx: MutationCtx, nodeId: Id<'nodes'>) {
  const node = await ctx.db.get(nodeId);
  if (!node) return;

  // Recurse into child nodes first (depth-first delete).
  const children = await ctx.db
    .query('nodes')
    .withIndex('by_parent', (q) => q.eq('parentId', nodeId))
    .collect();
  for (const child of children) {
    await deleteNodeCascade(ctx, child._id);
  }

  // Linked files.
  const files = await ctx.db
    .query('nodeFiles')
    .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
    .collect();
  for (const file of files) {
    await ctx.db.delete(file._id);
  }

  // Kanban tasks.
  const tasks = await ctx.db
    .query('kanbanTasks')
    .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
    .collect();
  for (const task of tasks) {
    await ctx.db.delete(task._id);
  }

  await ctx.db.delete(nodeId);
}
```

- [ ] **Step 4.2: Replace `convex/nodes.ts` `remove`**

In `convex/nodes.ts`, find the existing `remove` mutation and replace its handler body with a call to the cascade helper:

```ts
import { deleteNodeCascade } from './lib/cascade';

// (keep existing imports + functions; only the remove mutation changes:)

export const remove = mutation({
  args: { id: v.id('nodes') },
  handler: async (ctx, { id }) => {
    const node = await ctx.db.get(id);
    if (!node) return; // idempotent
    await requireProjectAccess(ctx, node.projectId);
    await deleteNodeCascade(ctx, id);
  },
});
```

(Add `import { deleteNodeCascade } from './lib/cascade';` near the top alongside the other imports if not already present.)

- [ ] **Step 4.3: Replace `convex/projects.ts` `remove`**

In `convex/projects.ts`, replace the existing cascade loop with calls to the helper so the logic stays in one place:

```ts
import { deleteNodeCascade } from './lib/cascade';

// (keep existing imports + functions; only the remove mutation changes:)

export const remove = mutation({
  args: { id: v.id('projects') },
  handler: async (ctx, { id }) => {
    await requireProjectAccess(ctx, id);

    const nodes = await ctx.db
      .query('nodes')
      .withIndex('by_project', (q) => q.eq('projectId', id))
      .collect();
    for (const node of nodes) {
      await deleteNodeCascade(ctx, node._id);
    }

    await ctx.db.delete(id);
  },
});
```

- [ ] **Step 4.4: Push and verify**

```powershell
pnpm dlx convex dev --once
```

- [ ] **Step 4.5: Run existing tests to confirm refactor didn't regress anything**

```powershell
pnpm test
```

Expected: 17 tests still passing.

- [ ] **Step 4.6: Commit**

```powershell
git add convex/lib convex/nodes.ts convex/projects.ts
git commit -m "refactor(convex): extract deleteNodeCascade and use from nodes/projects remove"
```

---

## Task 5: `convex/nodeFiles.ts` — listByNode + add + remove

**Files:**

- Create: `convex/nodeFiles.ts`

- [ ] **Step 5.1: Write `convex/nodeFiles.ts`**

```ts
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireProjectAccess } from './lib/auth';

export const listByNode = query({
  args: { nodeId: v.id('nodes') },
  handler: async (ctx, { nodeId }) => {
    const node = await ctx.db.get(nodeId);
    if (!node) return [];
    await requireProjectAccess(ctx, node.projectId);
    return ctx.db
      .query('nodeFiles')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
  },
});

export const add = mutation({
  args: { nodeId: v.id('nodes'), path: v.string() },
  handler: async (ctx, { nodeId, path }) => {
    const trimmed = path.trim();
    if (trimmed.length === 0) throw new Error('File path is required');
    if (trimmed.length > 500) throw new Error('File path must be 500 characters or fewer');

    const node = await ctx.db.get(nodeId);
    if (!node) throw new Error('Node not found');
    await requireProjectAccess(ctx, node.projectId);

    // Avoid duplicate paths per node — silent no-op if it already exists.
    const existing = await ctx.db
      .query('nodeFiles')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
    if (existing.some((f) => f.path === trimmed)) {
      return existing.find((f) => f.path === trimmed)!._id;
    }

    return await ctx.db.insert('nodeFiles', { nodeId, path: trimmed });
  },
});

export const remove = mutation({
  args: { id: v.id('nodeFiles') },
  handler: async (ctx, { id }) => {
    const file = await ctx.db.get(id);
    if (!file) return; // idempotent
    const node = await ctx.db.get(file.nodeId);
    if (!node) {
      // Orphan file (shouldn't happen post-cascade but defend anyway).
      await ctx.db.delete(id);
      return;
    }
    await requireProjectAccess(ctx, node.projectId);
    await ctx.db.delete(id);
  },
});
```

- [ ] **Step 5.2: Push and verify**

```powershell
pnpm dlx convex dev --once
```

- [ ] **Step 5.3: Commit**

```powershell
git add convex/nodeFiles.ts
git commit -m "feat(convex): add nodeFiles.listByNode, add, remove"
```

---

## Task 6: `convex/kanban.ts` — listByNode + create + update + remove

**Files:**

- Create: `convex/kanban.ts`

- [ ] **Step 6.1: Write `convex/kanban.ts`**

```ts
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireProjectAccess } from './lib/auth';

const statusValidator = v.union(v.literal('todo'), v.literal('doing'), v.literal('done'));

export const listByNode = query({
  args: { nodeId: v.id('nodes') },
  handler: async (ctx, { nodeId }) => {
    const node = await ctx.db.get(nodeId);
    if (!node) return [];
    await requireProjectAccess(ctx, node.projectId);
    const tasks = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
    // Sort by position ascending so column ordering is stable.
    return tasks.sort((a, b) => a.position - b.position);
  },
});

export const create = mutation({
  args: {
    nodeId: v.id('nodes'),
    title: v.string(),
    description: v.optional(v.string()),
    status: statusValidator,
  },
  handler: async (ctx, args) => {
    const trimmed = args.title.trim();
    if (trimmed.length === 0) throw new Error('Task title is required');
    if (trimmed.length > 200) throw new Error('Task title must be 200 characters or fewer');

    const node = await ctx.db.get(args.nodeId);
    if (!node) throw new Error('Node not found');
    await requireProjectAccess(ctx, node.projectId);

    // Append to the bottom of the column by giving the new task the largest
    // position seen so far + 1.
    const tasksInColumn = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_node_status', (q) => q.eq('nodeId', args.nodeId).eq('status', args.status))
      .collect();
    const nextPosition =
      tasksInColumn.length === 0 ? 0 : Math.max(...tasksInColumn.map((t) => t.position)) + 1;

    return await ctx.db.insert('kanbanTasks', {
      nodeId: args.nodeId,
      title: trimmed,
      description: args.description?.trim() || undefined,
      status: args.status,
      position: nextPosition,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id('kanbanTasks'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(statusValidator),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task) return; // idempotent
    const node = await ctx.db.get(task.nodeId);
    if (!node) {
      await ctx.db.delete(args.id);
      return;
    }
    await requireProjectAccess(ctx, node.projectId);

    const patch: Partial<typeof task> = {};
    if (args.title !== undefined) {
      const trimmed = args.title.trim();
      if (trimmed.length === 0) throw new Error('Task title is required');
      if (trimmed.length > 200) throw new Error('Task title must be 200 characters or fewer');
      patch.title = trimmed;
    }
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    if (args.status !== undefined && args.status !== task.status) {
      patch.status = args.status;
      // Re-position into the new column at the bottom.
      const tasksInNewCol = await ctx.db
        .query('kanbanTasks')
        .withIndex('by_node_status', (q) => q.eq('nodeId', task.nodeId).eq('status', args.status))
        .collect();
      patch.position =
        tasksInNewCol.length === 0 ? 0 : Math.max(...tasksInNewCol.map((t) => t.position)) + 1;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.id, patch);
    }
  },
});

export const remove = mutation({
  args: { id: v.id('kanbanTasks') },
  handler: async (ctx, { id }) => {
    const task = await ctx.db.get(id);
    if (!task) return;
    const node = await ctx.db.get(task.nodeId);
    if (!node) {
      await ctx.db.delete(id);
      return;
    }
    await requireProjectAccess(ctx, node.projectId);
    await ctx.db.delete(id);
  },
});
```

- [ ] **Step 6.2: Push and verify**

```powershell
pnpm dlx convex dev --once
```

- [ ] **Step 6.3: Commit**

```powershell
git add convex/kanban.ts
git commit -m "feat(convex): add kanban CRUD (listByNode, create, update, remove)"
```

---

## Task 7: Tests for nodeFiles + kanban

**Files:**

- Create: `convex/nodeFiles.test.ts`
- Create: `convex/kanban.test.ts`

- [ ] **Step 7.1: Write `convex/nodeFiles.test.ts`**

```ts
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

describe('nodeFiles', () => {
  test('add then list returns the file', async () => {
    const t = convexTest(schema, modules);
    const { asUser, nodeId } = await makeNode(t);

    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'src/login.tsx' });

    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId });
    expect(files).toHaveLength(1);
    expect(files[0].path).toEqual('src/login.tsx');
  });

  test('add is idempotent for the same path on the same node', async () => {
    const t = convexTest(schema, modules);
    const { asUser, nodeId } = await makeNode(t);

    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'a.ts' });
    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'a.ts' });

    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId });
    expect(files).toHaveLength(1);
  });

  test('add rejects empty paths', async () => {
    const t = convexTest(schema, modules);
    const { asUser, nodeId } = await makeNode(t);

    await expect(asUser.mutation(api.nodeFiles.add, { nodeId, path: '   ' })).rejects.toThrow(
      /File path is required/,
    );
  });

  test('refuses to list files of another user’s node', async () => {
    const t = convexTest(schema, modules);
    const { nodeId } = await makeNode(t);
    const asBob = t.withIdentity(fakeIdentity('user_bob', 'bob@example.com'));

    await expect(asBob.query(api.nodeFiles.listByNode, { nodeId })).rejects.toThrow(/Unauthorized/);
  });

  test('cascade: removing a node deletes its files', async () => {
    const t = convexTest(schema, modules);
    const { asUser, nodeId } = await makeNode(t);
    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'a.ts' });
    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'b.ts' });

    await asUser.mutation(api.nodes.remove, { id: nodeId });

    await t.run(async (ctx) => {
      const remaining = await ctx.db.query('nodeFiles').collect();
      expect(remaining.filter((f) => f.nodeId === nodeId)).toEqual([]);
    });
  });
});
```

- [ ] **Step 7.2: Write `convex/kanban.test.ts`**

```ts
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
    expect(doing.map((t) => t.title)).toEqual(['A', 'B']); // B added last in doing
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
```

- [ ] **Step 7.3: Run tests**

```powershell
pnpm test
```

Expected: 27 tests passing (17 prior + 5 nodeFiles + 5 kanban).

- [ ] **Step 7.4: Commit**

```powershell
git add convex/nodeFiles.test.ts convex/kanban.test.ts
git commit -m "test(convex): cover nodeFiles and kanban CRUD + cascade"
```

---

## Task 8: shadcn add Tabs + Textarea, install Zustand

**Files:**

- Create (via shadcn CLI): `apps/web/components/ui/tabs.tsx`, `apps/web/components/ui/textarea.tsx`
- Modify: `apps/web/package.json` (zustand)

- [ ] **Step 8.1: Add shadcn components**

```powershell
cd apps/web
echo "n" | pnpm dlx shadcn@latest add tabs textarea
cd ../..
```

Expected: creates `components/ui/tabs.tsx` and `components/ui/textarea.tsx`. If shadcn asks about overwriting existing files (button etc.), answer **n**.

- [ ] **Step 8.2: Install Zustand**

```powershell
pnpm --filter @arch-viz/web add zustand
```

- [ ] **Step 8.3: Verify typecheck**

```powershell
pnpm --filter @arch-viz/web typecheck
```

- [ ] **Step 8.4: Commit**

```powershell
git add apps/web pnpm-lock.yaml
git commit -m "chore(web): add shadcn tabs + textarea and zustand"
```

---

## Task 9: Zustand modal store

**Files:**

- Create: `apps/web/store/modal-store.ts`

- [ ] **Step 9.1: Create directory**

```powershell
New-Item -ItemType Directory -Path "apps/web/store" -Force | Out-Null
```

- [ ] **Step 9.2: Write `apps/web/store/modal-store.ts`**

```ts
'use client';

import { create } from 'zustand';
import type { Id } from '../../../convex/_generated/dataModel';

interface ModalState {
  selectedNodeId: Id<'nodes'> | null;
  open: (nodeId: Id<'nodes'>) => void;
  close: () => void;
}

export const useModalStore = create<ModalState>((set) => ({
  selectedNodeId: null,
  open: (nodeId) => set({ selectedNodeId: nodeId }),
  close: () => set({ selectedNodeId: null }),
}));
```

- [ ] **Step 9.3: Verify typecheck**

```powershell
pnpm --filter @arch-viz/web typecheck
```

- [ ] **Step 9.4: Commit**

```powershell
git add apps/web/store
git commit -m "feat(web): add Zustand modal store for selectedNodeId"
```

---

## Task 10: NodeModal shell (Dialog + Tabs)

**Files:**

- Create: `apps/web/components/node-modal/node-modal.tsx`

- [ ] **Step 10.1: Create directory**

```powershell
New-Item -ItemType Directory -Path "apps/web/components/node-modal" -Force | Out-Null
```

- [ ] **Step 10.2: Write `apps/web/components/node-modal/node-modal.tsx`**

```tsx
'use client';

import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useModalStore } from '@/store/modal-store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DescriptionTab } from './description-tab';
import { LinkedFilesTab } from './linked-files-tab';
import { KanbanTab } from './kanban-tab';

export function NodeModal() {
  const selectedNodeId = useModalStore((s) => s.selectedNodeId);
  const close = useModalStore((s) => s.close);
  const node = useQuery(api.nodes.get, selectedNodeId ? { id: selectedNodeId } : 'skip');

  const open = selectedNodeId !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{node?.name ?? 'Loading…'}</DialogTitle>
          <DialogDescription>Manage description, linked files, and kanban tasks.</DialogDescription>
        </DialogHeader>

        {selectedNodeId && (
          <Tabs defaultValue="description" className="mt-2">
            <TabsList>
              <TabsTrigger value="description">Description</TabsTrigger>
              <TabsTrigger value="files">Linked files</TabsTrigger>
              <TabsTrigger value="kanban">Kanban</TabsTrigger>
            </TabsList>
            <TabsContent value="description">
              <DescriptionTab nodeId={selectedNodeId} description={node?.description ?? ''} />
            </TabsContent>
            <TabsContent value="files">
              <LinkedFilesTab nodeId={selectedNodeId} />
            </TabsContent>
            <TabsContent value="kanban">
              <KanbanTab nodeId={selectedNodeId} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 10.3: Note** — `nodes.get` returns just the node row; `description` is on the row. The next three tasks fill in the missing tab components. Don't typecheck yet; subtasks need their files.

---

## Task 11: DescriptionTab

**Files:**

- Create: `apps/web/components/node-modal/description-tab.tsx`

- [ ] **Step 11.1: Write `apps/web/components/node-modal/description-tab.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { nodeDescriptionSchema } from '@arch-viz/shared';
import { Textarea } from '@/components/ui/textarea';

const DEBOUNCE_MS = 500;

interface Props {
  nodeId: Id<'nodes'>;
  description: string;
}

export function DescriptionTab({ nodeId, description }: Props) {
  const update = useMutation(api.nodes.update);
  const [value, setValue] = useState(description);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync when the underlying node changes (e.g., another tab edited it
  // and the modal re-rendered with a fresh `description` prop).
  useEffect(() => {
    setValue(description);
  }, [description, nodeId]);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);

    const parse = nodeDescriptionSchema.safeParse(next);
    if (!parse.success) {
      setError(parse.error.issues[0]?.message ?? 'Invalid description');
      return;
    }
    setError(null);

    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus('saving');
    timerRef.current = setTimeout(async () => {
      await update({ id: nodeId, description: next });
      setStatus('saved');
    }, DEBOUNCE_MS);
  };

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <div className="space-y-2 py-2">
      <Textarea
        value={value}
        onChange={onChange}
        rows={8}
        placeholder="Describe what this page is for, what it does, and any notes…"
      />
      <div className="flex justify-between text-xs">
        <span className="text-destructive">{error}</span>
        <span className="text-muted-foreground">
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 11.2: Verify typecheck**

```powershell
pnpm --filter @arch-viz/web typecheck
```

Expected: errors only from missing siblings (LinkedFilesTab + KanbanTab) — those land in the next two tasks.

- [ ] **Step 11.3: No commit yet** — keep all three tab files in one commit at the end of Task 13 once they compile together.

---

## Task 12: LinkedFilesTab

**Files:**

- Create: `apps/web/components/node-modal/linked-files-tab.tsx`

- [ ] **Step 12.1: Write `apps/web/components/node-modal/linked-files-tab.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Trash2 } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  nodeId: Id<'nodes'>;
}

export function LinkedFilesTab({ nodeId }: Props) {
  const files = useQuery(api.nodeFiles.listByNode, { nodeId });
  const add = useMutation(api.nodeFiles.add);
  const remove = useMutation(api.nodeFiles.remove);

  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onAdd = async () => {
    const trimmed = path.trim();
    if (trimmed.length === 0) {
      setError('Enter a file path');
      return;
    }
    if (trimmed.length > 500) {
      setError('Path must be 500 characters or fewer');
      return;
    }
    setError(null);
    await add({ nodeId, path: trimmed });
    setPath('');
  };

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="apps/web/app/login/page.tsx"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAdd();
              }
            }}
          />
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
        <Button onClick={onAdd}>Add</Button>
      </div>

      {files === undefined && <p className="text-muted-foreground text-sm">Loading…</p>}
      {files && files.length === 0 && (
        <p className="text-sm text-muted-foreground">No linked files yet.</p>
      )}
      {files && files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li
              key={f._id}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm font-mono"
            >
              <span className="truncate">{f.path}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${f.path}`}
                onClick={() => remove({ id: f._id })}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 12.2: Verify typecheck**

```powershell
pnpm --filter @arch-viz/web typecheck
```

Expected: only KanbanTab still missing.

- [ ] **Step 12.3: No commit yet** — bundled with other tab files at Task 13.

---

## Task 13: KanbanTab + AddTaskForm

**Files:**

- Create: `apps/web/components/node-modal/kanban-tab.tsx`

- [ ] **Step 13.1: Write `apps/web/components/node-modal/kanban-tab.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Plus, MoreVertical } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { KANBAN_STATUSES, KANBAN_STATUS_LABEL, type KanbanStatus } from '@arch-viz/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  nodeId: Id<'nodes'>;
}

export function KanbanTab({ nodeId }: Props) {
  const tasks = useQuery(api.kanban.listByNode, { nodeId });

  return (
    <div className="grid grid-cols-3 gap-3 py-2">
      {KANBAN_STATUSES.map((status) => (
        <Column
          key={status}
          nodeId={nodeId}
          status={status}
          tasks={(tasks ?? []).filter((t) => t.status === status)}
        />
      ))}
    </div>
  );
}

interface ColumnProps {
  nodeId: Id<'nodes'>;
  status: KanbanStatus;
  tasks: Doc<'kanbanTasks'>[];
}

function Column({ nodeId, status, tasks }: ColumnProps) {
  const create = useMutation(api.kanban.create);
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const onAdd = async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    await create({ nodeId, title: trimmed, status });
    setTitle('');
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-2">
      <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {KANBAN_STATUS_LABEL[status]}{' '}
        <span className="text-muted-foreground/70">({tasks.length})</span>
      </div>
      <div className="flex flex-col gap-2">
        {tasks.map((task) => (
          <TaskCard key={task._id} task={task} />
        ))}
      </div>
      {adding ? (
        <div className="space-y-2">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAdd();
              } else if (e.key === 'Escape') {
                setAdding(false);
                setTitle('');
              }
            }}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={onAdd}>
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setTitle('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-muted-foreground"
          onClick={() => setAdding(true)}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add task
        </Button>
      )}
    </div>
  );
}

interface TaskCardProps {
  task: Doc<'kanbanTasks'>;
}

function TaskCard({ task }: TaskCardProps) {
  const update = useMutation(api.kanban.update);
  const remove = useMutation(api.kanban.remove);

  return (
    <div className="rounded-md border bg-background p-2 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 whitespace-pre-wrap">{task.title}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="Task actions" className="h-6 w-6">
                <MoreVertical className="h-3 w-3" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {KANBAN_STATUSES.filter((s) => s !== task.status).map((target) => (
              <DropdownMenuItem
                key={target}
                onClick={() => update({ id: task._id, status: target })}
              >
                Move to {KANBAN_STATUS_LABEL[target]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => remove({ id: task._id })}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
```

- [ ] **Step 13.2: Verify typecheck**

```powershell
pnpm --filter @arch-viz/web typecheck
```

Expected: exit 0.

- [ ] **Step 13.3: Commit all three tabs and the modal shell**

```powershell
git add apps/web/components/node-modal
git commit -m "feat(web): add NodeModal with Description/Files/Kanban tabs"
```

---

## Task 14: Wire NodeModal + double-click handler on the shape

**Files:**

- Modify: `apps/web/components/canvas/page-node-shape.tsx`
- Modify: `apps/web/app/canvas/[projectId]/page.tsx`

- [ ] **Step 14.1: Update `apps/web/components/canvas/page-node-shape.tsx`**

Replace the `component(shape: Shape)` method body with a version that calls into the modal store on double-click. Add a top-of-file import.

Open `apps/web/components/canvas/page-node-shape.tsx` and:

1. Add this import alongside the existing imports:

```tsx
import { useModalStore } from '@/store/modal-store';
import type { Id } from '../../../convex/_generated/dataModel';
```

2. Replace the `component` method with:

```tsx
override component(shape: Shape) {
  return <PageNodeShapeBody shape={shape} />;
}
```

3. Add the body component at the bottom of the file (after the class):

```tsx
function PageNodeShapeBody({ shape }: { shape: Shape }) {
  const open = useModalStore((s) => s.open);
  const shapeId = shape.id;

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // shape id format is `shape:<convex id>` (see useCanvasSync.nodeIdToShapeId).
    const prefix = 'shape:';
    if (!shapeId.startsWith(prefix)) return;
    const nodeId = shapeId.slice(prefix.length) as Id<'nodes'>;
    open(nodeId);
  };

  return (
    <HTMLContainer
      onDoubleClick={onDoubleClick}
      style={{
        width: shape.props.w,
        height: shape.props.h,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
        borderRadius: '8px',
        border: '1px solid hsl(var(--border, 214 32% 91%))',
        background: 'white',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        fontFamily: 'var(--font-geist-sans, system-ui)',
        fontSize: '14px',
        fontWeight: 500,
        color: '#0f172a',
        pointerEvents: 'all',
        userSelect: 'none',
        cursor: 'pointer',
      }}
    >
      {shape.props.name}
    </HTMLContainer>
  );
}
```

The full file should end up looking like:

```tsx
import { HTMLContainer, Rectangle2d, ShapeUtil, T, type RecordProps } from 'tldraw';
import { PAGE_NODE_DEFAULT_HEIGHT, PAGE_NODE_DEFAULT_WIDTH } from '@arch-viz/shared';
import { useModalStore } from '@/store/modal-store';
import type { Id } from '../../../convex/_generated/dataModel';

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    'page-node': {
      name: string;
      w: number;
      h: number;
    };
  }
}

import type { TLShape } from 'tldraw';

type Shape = Extract<TLShape, { type: 'page-node' }>;

export class PageNodeShapeUtil extends ShapeUtil<Shape> {
  static override type = 'page-node' as const;

  static override props: RecordProps<Shape> = {
    name: T.string,
    w: T.number,
    h: T.number,
  };

  override getDefaultProps(): Shape['props'] {
    return {
      name: 'New page',
      w: PAGE_NODE_DEFAULT_WIDTH,
      h: PAGE_NODE_DEFAULT_HEIGHT,
    };
  }

  override canEdit() {
    return false;
  }

  override canResize() {
    return false;
  }

  override getGeometry(shape: Shape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: Shape) {
    return <PageNodeShapeBody shape={shape} />;
  }

  override getIndicatorPath(shape: Shape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}

function PageNodeShapeBody({ shape }: { shape: Shape }) {
  const open = useModalStore((s) => s.open);
  const shapeId = shape.id;

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const prefix = 'shape:';
    if (!shapeId.startsWith(prefix)) return;
    const nodeId = shapeId.slice(prefix.length) as Id<'nodes'>;
    open(nodeId);
  };

  return (
    <HTMLContainer
      onDoubleClick={onDoubleClick}
      style={{
        width: shape.props.w,
        height: shape.props.h,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
        borderRadius: '8px',
        border: '1px solid hsl(var(--border, 214 32% 91%))',
        background: 'white',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        fontFamily: 'var(--font-geist-sans, system-ui)',
        fontSize: '14px',
        fontWeight: 500,
        color: '#0f172a',
        pointerEvents: 'all',
        userSelect: 'none',
        cursor: 'pointer',
      }}
    >
      {shape.props.name}
    </HTMLContainer>
  );
}
```

- [ ] **Step 14.2: Mount `NodeModal` in the canvas page**

Open `apps/web/app/canvas/[projectId]/page.tsx` and:

1. Add this import alongside the other component imports:

```tsx
import { NodeModal } from '@/components/node-modal/node-modal';
```

2. Inside the returned `<main>`, add `<NodeModal />` as a sibling at the end (just before `</main>`):

```tsx
return (
  <main className="flex h-screen flex-col">
    {/* … existing header + canvas div … */}
    <NodeModal />
  </main>
);
```

The mount is unconditional; the modal stays hidden when `selectedNodeId === null`.

- [ ] **Step 14.3: Verify typecheck**

```powershell
pnpm --filter @arch-viz/web typecheck
```

Expected: exit 0.

- [ ] **Step 14.4: Commit**

```powershell
git add apps/web/components/canvas apps/web/app/canvas
git commit -m "feat(web): open NodeModal on double-click of a page node"
```

---

## Task 15: Final verification

- [ ] **Step 15.1: Local CI pipeline**

```powershell
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all five exit 0; 27 tests passing.

If `pnpm format` rewrote files, commit them with `style: apply prettier formatting`.

- [ ] **Step 15.2: Manual smoke test**

Run `pnpm dlx convex dev` and `pnpm dev` in two terminals. Open `http://localhost:3000`.

1. Sign in → land on `/projects` → open or create a project.
2. On the canvas, click **+ Add page** to create a node. **Double-click** the node → `NodeModal` opens with `Description` tab selected.
3. Type in the description; status changes to "Saving…" then "Saved". Close + re-open the modal; description persists.
4. Switch to **Linked files** tab. Type a path like `apps/web/app/login/page.tsx`, press Enter → file appears. Add a second file. Click trash icon on the first → it disappears. Path validation (empty string) shows an inline error.
5. Switch to **Kanban** tab. In the **To do** column, click "Add task", type a title, press Enter → task appears. Add another in **Doing**. Open the task's "…" menu → "Move to Done" → task jumps columns.
6. Open a second tab to the same project. Open the same modal there. Changes in tab 1 should appear in tab 2 within ~1 second (description text, files list, kanban columns).
7. Delete the node from the canvas (select + Delete). Open another node — its modal should still show empty data (no leftover state). Confirm the deleted node's files and kanban tasks are gone (Convex dashboard).
8. Delete the whole project from `/projects`. Create a new one, navigate to its canvas — no orphan files / tasks visible.

- [ ] **Step 15.3: Push branch**

```powershell
git push -u origin phase-1c-node-modal
```

Wait for CI to be green at https://github.com/GlennAyden/Architecture-Visualization/actions.

- [ ] **Step 15.4: Merge to main and tag**

```powershell
git checkout main
git pull origin main
git merge phase-1c-node-modal --ff-only
git tag -a phase-1c -m "Phase 1C: per-node modal (description + linked files + kanban)"
git push origin main phase-1c
```

---

## Phase 1C — Definition of Done checklist

- [ ] Convex schema has `nodeFiles` and `kanbanTasks` tables with `by_node` indexes.
- [ ] `deleteNodeCascade` is the single source of truth for tearing down a node and is invoked from `nodes.remove` and `projects.remove`.
- [ ] `nodeFiles.listByNode`, `add`, `remove` enforce project-level authorization through the node's `projectId`.
- [ ] `kanban.listByNode`, `create`, `update`, `remove` enforce the same authorization; `create`/`update` set the task to the bottom of its column.
- [ ] Backend tests cover both new tables + cascade + cross-user authorization (27 tests total).
- [ ] `useModalStore` (Zustand) tracks `selectedNodeId`.
- [ ] `NodeModal` (Dialog + Tabs) renders Description / Linked files / Kanban tabs and opens when a node is double-clicked on the canvas.
- [ ] `DescriptionTab` debounces saves and surfaces validation errors inline.
- [ ] `LinkedFilesTab` lets the user add a path (Enter to submit) and remove existing files.
- [ ] `KanbanTab` shows three columns; each has inline "Add task"; tasks have a menu to move status or delete.
- [ ] Local pipeline passes (format, lint, typecheck, 27 tests).
- [ ] Manual smoke test (modal opens, all three tabs work, multi-tab live sync, cascade-delete verified).
- [ ] CI on `phase-1c-node-modal` is green; tag `phase-1c` pushed.
