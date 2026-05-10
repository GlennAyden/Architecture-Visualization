# Architecture Visualization — Phase 1B (Page Nodes)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the canvas come alive — add a `nodes` table to Convex, render persisted page-node shapes on the tldraw canvas, and let the user create / move / delete them. Convex is the single source of truth; the tldraw canvas is a reactive view that re-renders when the DB changes (so opening the same project in two tabs stays in sync).

**Architecture:** Convex `nodes` table holds `projectId`, `parentId` (for nested features in 1C), `type`, `name`, `description`, `positionX`, `positionY`, `metadata`. The canvas page subscribes via `useQuery(api.nodes.listByProject, { projectId })` and reconciles results into the tldraw editor through a `useCanvasSync` hook (creates missing shapes, removes vanished shapes, patches changed positions). User actions go the other direction: an "+ Add page" button calls a mutation; tldraw drag-end events debounce-commit the new position; tldraw delete events call `nodes.remove`. The custom `PageNodeShapeUtil` defines how a `page-node` shape renders. `projects.remove` is upgraded to cascade-delete its nodes.

**Tech Stack:** Convex (schema, reactive queries, mutations), tldraw 5 (`BaseBoxShapeUtil`, custom shape API, store listeners), React 19, Zod (in `@arch-viz/shared`), Vitest + `convex-test`.

**Prerequisites:**

- Phase 1A done (tag `phase-1a`).
- `apps/web/.env.local` still has working Clerk + Convex env values.
- `pnpm test` is green; `pnpm dlx convex dev` deploys cleanly.

**Out of scope for this plan (deferred to 1C / 1D):**

- Per-node modal (description editor, linked files, kanban). Click on a node = no UI yet.
- Nested features (parentId is in schema but unused in 1B; only top-level page nodes).
- Activity log UI.
- API token generation page (1D).

---

## File Structure

After this plan, the new and modified files are:

```
convex/
├── schema.ts                       # Modified: add nodes table
├── projects.ts                     # Modified: cascade-delete nodes in remove
├── nodes.ts                        # New: listByProject, create, update, remove
└── nodes.test.ts                   # New: convex-test cases for nodes

apps/web/
├── app/canvas/[projectId]/page.tsx # Modified: register shape util + sync hook + Add Page button
├── components/canvas/
│   ├── page-node-shape.tsx         # New: PageNodeShapeUtil + React component
│   └── add-page-button.tsx         # New: small client component, calls nodes.create
└── hooks/
    └── use-canvas-sync.ts          # New: bidirectional sync between editor and Convex

packages/shared/
├── src/index.ts                    # Modified: re-export node schemas
└── src/nodes.ts                    # New: Zod schemas (nodeNameSchema, nodeTypeSchema)
```

---

## Workflow conventions

- Run all commands from repo root unless noted.
- Keep `pnpm dlx convex dev` running in a side terminal so schema changes auto-deploy.
- Before each commit: `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- Branch off `main`: `phase-1b-page-nodes`. Merge fast-forward when complete.

---

## Task 1: Branch off main

- [ ] **Step 1.1: Create and switch to feature branch**

```powershell
git checkout main
git pull origin main
git checkout -b phase-1b-page-nodes
```

Expected: "Switched to a new branch 'phase-1b-page-nodes'".

---

## Task 2: Shared Zod schemas for node fields

**Files:**

- Create: `packages/shared/src/nodes.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 2.1: Write `packages/shared/src/nodes.ts`**

```ts
import { z } from 'zod';

export const nodeNameSchema = z
  .string()
  .trim()
  .min(1, 'Node name is required')
  .max(80, 'Node name must be 80 characters or fewer');

export type NodeName = z.infer<typeof nodeNameSchema>;

export const nodeTypeSchema = z.union([z.literal('page'), z.literal('feature')]);
export type NodeType = z.infer<typeof nodeTypeSchema>;

export const PAGE_NODE_DEFAULT_WIDTH = 220;
export const PAGE_NODE_DEFAULT_HEIGHT = 96;
```

- [ ] **Step 2.2: Re-export from `packages/shared/src/index.ts`**

Replace the file with:

```ts
export * from './projects';
export * from './nodes';
```

- [ ] **Step 2.3: Verify typecheck**

```powershell
pnpm --filter @arch-viz/shared typecheck
```

Expected: exit 0.

- [ ] **Step 2.4: Commit**

```powershell
git add packages/shared
git commit -m "feat(shared): add node Zod schemas and default page-node dimensions"
```

---

## Task 3: Add `nodes` table to Convex schema

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
    parentId: v.optional(v.id('nodes')), // nested features (Phase 1C); top-level pages omit
    type: v.union(v.literal('page'), v.literal('feature')),
    name: v.string(),
    description: v.optional(v.string()),
    positionX: v.number(),
    positionY: v.number(),
    metadata: v.optional(v.any()),
  })
    .index('by_project', ['projectId'])
    .index('by_parent', ['parentId']),
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
git commit -m "feat(convex): add nodes table with project and parent indexes"
```

---

## Task 4: `convex/nodes.ts` — `listByProject` query and `create` mutation

**Files:**

- Create: `convex/nodes.ts`

- [ ] **Step 4.1: Write `convex/nodes.ts` with `listByProject` and `create`**

```ts
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireProjectAccess } from './lib/auth';

export const listByProject = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    await requireProjectAccess(ctx, projectId);
    return ctx.db
      .query('nodes')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
  },
});

export const create = mutation({
  args: {
    projectId: v.id('projects'),
    type: v.union(v.literal('page'), v.literal('feature')),
    name: v.string(),
    parentId: v.optional(v.id('nodes')),
    positionX: v.number(),
    positionY: v.number(),
  },
  handler: async (ctx, args) => {
    const trimmed = args.name.trim();
    if (trimmed.length === 0) throw new Error('Node name is required');
    if (trimmed.length > 80) throw new Error('Node name must be 80 characters or fewer');

    await requireProjectAccess(ctx, args.projectId);

    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.projectId !== args.projectId) {
        throw new Error('Parent node must belong to the same project');
      }
    }

    return await ctx.db.insert('nodes', {
      projectId: args.projectId,
      parentId: args.parentId,
      type: args.type,
      name: trimmed,
      positionX: args.positionX,
      positionY: args.positionY,
    });
  },
});
```

- [ ] **Step 4.2: Push and verify**

```powershell
pnpm dlx convex dev --once
```

Expected: "Convex functions ready!".

- [ ] **Step 4.3: Commit**

```powershell
git add convex/nodes.ts
git commit -m "feat(convex): add nodes.listByProject and nodes.create"
```

---

## Task 5: `nodes.update` and `nodes.remove`

**Files:**

- Modify: `convex/nodes.ts`

- [ ] **Step 5.1: Append `update` mutation**

```ts
export const update = mutation({
  args: {
    id: v.id('nodes'),
    name: v.optional(v.string()),
    positionX: v.optional(v.number()),
    positionY: v.optional(v.number()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const node = await ctx.db.get(args.id);
    if (!node) throw new Error('Node not found');
    await requireProjectAccess(ctx, node.projectId);

    const patch: Partial<typeof node> = {};

    if (args.name !== undefined) {
      const trimmed = args.name.trim();
      if (trimmed.length === 0) throw new Error('Node name is required');
      if (trimmed.length > 80) throw new Error('Node name must be 80 characters or fewer');
      patch.name = trimmed;
    }
    if (args.positionX !== undefined) patch.positionX = args.positionX;
    if (args.positionY !== undefined) patch.positionY = args.positionY;
    if (args.description !== undefined) patch.description = args.description;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.id, patch);
    }
  },
});
```

- [ ] **Step 5.2: Append `remove` mutation (cascades children)**

```ts
export const remove = mutation({
  args: { id: v.id('nodes') },
  handler: async (ctx, { id }) => {
    const node = await ctx.db.get(id);
    if (!node) throw new Error('Node not found');
    await requireProjectAccess(ctx, node.projectId);

    // Cascade-delete child nodes (nested features in 1C). For 1B there are
    // no children, but the recursion is harmless and forward-compatible.
    const children = await ctx.db
      .query('nodes')
      .withIndex('by_parent', (q) => q.eq('parentId', id))
      .collect();
    for (const child of children) {
      await ctx.db.delete(child._id);
    }

    await ctx.db.delete(id);
  },
});
```

- [ ] **Step 5.3: Push and verify**

```powershell
pnpm dlx convex dev --once
```

- [ ] **Step 5.4: Commit**

```powershell
git add convex/nodes.ts
git commit -m "feat(convex): add nodes.update (name/position/description) and nodes.remove (cascade)"
```

---

## Task 6: Cascade-delete nodes when a project is removed

**Files:**

- Modify: `convex/projects.ts`

- [ ] **Step 6.1: Update `projects.remove`**

Replace the existing `remove` mutation in `convex/projects.ts` with:

```ts
export const remove = mutation({
  args: { id: v.id('projects') },
  handler: async (ctx, { id }) => {
    await requireProjectAccess(ctx, id);

    // Cascade: delete all nodes belonging to this project.
    const nodes = await ctx.db
      .query('nodes')
      .withIndex('by_project', (q) => q.eq('projectId', id))
      .collect();
    for (const node of nodes) {
      await ctx.db.delete(node._id);
    }

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
git add convex/projects.ts
git commit -m "feat(convex): cascade-delete nodes when a project is removed"
```

---

## Task 7: Tests for `nodes` CRUD

**Files:**

- Create: `convex/nodes.test.ts`

- [ ] **Step 7.1: Write `convex/nodes.test.ts`**

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

describe('nodes.listByProject', () => {
  test('returns the project owner’s nodes', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Login',
      positionX: 0,
      positionY: 0,
    });

    const nodes = await asUser.query(api.nodes.listByProject, { projectId });
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toEqual('Login');
    expect(nodes[0].type).toEqual('page');
  });

  test('refuses to list a project belonging to another user', async () => {
    const t = convexTest(schema, modules);
    const asAlice = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));
    const asBob = t.withIdentity(fakeIdentity('user_bob', 'bob@example.com'));

    const projectId = await asAlice.mutation(api.projects.create, { name: 'P' });

    await expect(asBob.query(api.nodes.listByProject, { projectId })).rejects.toThrow(
      /Unauthorized/,
    );
  });
});

describe('nodes.create', () => {
  test('rejects empty names', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });

    await expect(
      asUser.mutation(api.nodes.create, {
        projectId,
        type: 'page',
        name: '   ',
        positionX: 0,
        positionY: 0,
      }),
    ).rejects.toThrow(/Node name is required/);
  });

  test('rejects parentId from a different project', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectA = await asUser.mutation(api.projects.create, { name: 'A' });
    const projectB = await asUser.mutation(api.projects.create, { name: 'B' });
    const nodeInA = await asUser.mutation(api.nodes.create, {
      projectId: projectA,
      type: 'page',
      name: 'Top',
      positionX: 0,
      positionY: 0,
    });

    await expect(
      asUser.mutation(api.nodes.create, {
        projectId: projectB,
        type: 'feature',
        name: 'Child',
        parentId: nodeInA,
        positionX: 0,
        positionY: 0,
      }),
    ).rejects.toThrow(/same project/);
  });
});

describe('nodes.update', () => {
  test('updates only the provided fields', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Original',
      positionX: 0,
      positionY: 0,
    });

    await asUser.mutation(api.nodes.update, { id: nodeId, positionX: 100 });
    const after = await asUser.query(api.nodes.listByProject, { projectId });
    expect(after[0].name).toEqual('Original'); // unchanged
    expect(after[0].positionX).toEqual(100);
  });
});

describe('nodes.remove', () => {
  test('removes the node and any children', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const parent = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Parent',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'feature',
      name: 'Child',
      parentId: parent,
      positionX: 0,
      positionY: 0,
    });

    await asUser.mutation(api.nodes.remove, { id: parent });
    const after = await asUser.query(api.nodes.listByProject, { projectId });
    expect(after).toEqual([]);
  });

  test('refuses to remove a node owned by another user', async () => {
    const t = convexTest(schema, modules);
    const asAlice = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));
    const asBob = t.withIdentity(fakeIdentity('user_bob', 'bob@example.com'));

    const projectId = await asAlice.mutation(api.projects.create, { name: 'P' });
    const nodeId = await asAlice.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Alice node',
      positionX: 0,
      positionY: 0,
    });

    await expect(asBob.mutation(api.nodes.remove, { id: nodeId })).rejects.toThrow(/Unauthorized/);
  });
});

describe('projects.remove cascade', () => {
  test('removes the project and all its nodes', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'A',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'B',
      positionX: 0,
      positionY: 0,
    });

    await asUser.mutation(api.projects.remove, { id: projectId });

    // Verify directly via t.run that no nodes from this project remain.
    await t.run(async (ctx) => {
      const remaining = await ctx.db.query('nodes').collect();
      expect(remaining.filter((n) => n.projectId === projectId)).toEqual([]);
    });
  });
});
```

- [ ] **Step 7.2: Run tests**

```powershell
pnpm test
```

Expected: 16 tests passing (9 from Phase 1A `projects` + 7 new for `nodes`).

- [ ] **Step 7.3: Commit**

```powershell
git add convex/nodes.test.ts
git commit -m "test(convex): cover nodes CRUD (auth, parent project, cascade delete)"
```

---

## Task 8: Custom tldraw shape — `PageNodeShapeUtil`

**Files:**

- Create: `apps/web/components/canvas/page-node-shape.tsx`

- [ ] **Step 8.1: Create directory**

```powershell
New-Item -ItemType Directory -Path "apps/web/components/canvas" -Force | Out-Null
```

- [ ] **Step 8.2: Write `apps/web/components/canvas/page-node-shape.tsx`**

```tsx
import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLBaseShape } from 'tldraw';
import { PAGE_NODE_DEFAULT_HEIGHT, PAGE_NODE_DEFAULT_WIDTH } from '@arch-viz/shared';

export type PageNodeShape = TLBaseShape<
  'page-node',
  {
    name: string;
    w: number;
    h: number;
  }
>;

export class PageNodeShapeUtil extends BaseBoxShapeUtil<PageNodeShape> {
  static override type = 'page-node' as const;

  static override props: RecordProps<PageNodeShape> = {
    name: T.string,
    w: T.number,
    h: T.number,
  };

  override getDefaultProps(): PageNodeShape['props'] {
    return {
      name: 'New page',
      w: PAGE_NODE_DEFAULT_WIDTH,
      h: PAGE_NODE_DEFAULT_HEIGHT,
    };
  }

  override canEdit() {
    return false; // Phase 1C will open the modal on double-click; for 1B nodes are non-editable in-place.
  }

  override canResize() {
    return false; // Position changes via drag; size is fixed for page nodes.
  }

  override component(shape: PageNodeShape) {
    return (
      <HTMLContainer
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
        }}
      >
        {shape.props.name}
      </HTMLContainer>
    );
  }

  override indicator(shape: PageNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} ry={8} />;
  }
}
```

- [ ] **Step 8.3: Verify typecheck**

```powershell
pnpm --filter @arch-viz/web typecheck
```

Expected: exit 0.

- [ ] **Step 8.4: Commit**

```powershell
git add apps/web/components/canvas
git commit -m "feat(web): add PageNodeShapeUtil custom tldraw shape"
```

---

## Task 9: `useCanvasSync` hook — bidirectional Convex ↔ editor sync

**Files:**

- Create: `apps/web/hooks/use-canvas-sync.ts`

This hook is the heart of Phase 1B. It must:

1. When Convex query results change → diff against editor's current shapes → create/update/delete shapes to match.
2. When the user moves a shape on the canvas → debounce → call `nodes.update` with new position.
3. When the user deletes a shape on the canvas → call `nodes.remove`.

It must avoid feedback loops: when we apply a Convex change to the editor, that triggers the editor's own change events; we tag programmatic changes so the listener ignores them.

- [ ] **Step 9.1: Create directory**

```powershell
New-Item -ItemType Directory -Path "apps/web/hooks" -Force | Out-Null
```

- [ ] **Step 9.2: Write `apps/web/hooks/use-canvas-sync.ts`**

```ts
'use client';

import { useEffect, useRef } from 'react';
import { useMutation } from 'convex/react';
import type { Editor, TLShapeId } from 'tldraw';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';

const DEBOUNCE_MS = 250;

function nodeIdToShapeId(nodeId: Id<'nodes'>): TLShapeId {
  return `shape:${nodeId}` as TLShapeId;
}

function shapeIdToNodeId(shapeId: TLShapeId): Id<'nodes'> | null {
  const prefix = 'shape:';
  if (!shapeId.startsWith(prefix)) return null;
  return shapeId.slice(prefix.length) as Id<'nodes'>;
}

interface Args {
  editor: Editor | null;
  nodes: Doc<'nodes'>[] | undefined;
}

/**
 * Reconciles Convex `nodes` state with the tldraw editor's shapes (one-way:
 * Convex → editor) and pipes user-driven editor changes back to Convex
 * (other way: editor → Convex via mutations).
 *
 * `applyingRemoteRef` guards against echo: when we mutate the editor in
 * response to a Convex change, the editor fires update events; we must
 * ignore those so we don't loop.
 */
export function useCanvasSync({ editor, nodes }: Args) {
  const updateMutation = useMutation(api.nodes.update);
  const removeMutation = useMutation(api.nodes.remove);

  const applyingRemoteRef = useRef(false);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Convex -> editor: reconcile shapes whenever `nodes` changes.
  useEffect(() => {
    if (!editor || !nodes) return;

    applyingRemoteRef.current = true;
    try {
      const desiredById = new Map(nodes.map((n) => [nodeIdToShapeId(n._id), n]));
      const existingShapes = editor.getCurrentPageShapes().filter((s) => s.type === 'page-node');
      const existingIds = new Set(existingShapes.map((s) => s.id));

      // Remove shapes whose backing node has been deleted.
      const toDelete = existingShapes.filter((s) => !desiredById.has(s.id));
      if (toDelete.length > 0) editor.deleteShapes(toDelete.map((s) => s.id));

      // Create shapes for new nodes; patch shapes whose position drifted.
      for (const node of nodes) {
        const shapeId = nodeIdToShapeId(node._id);
        if (!existingIds.has(shapeId)) {
          editor.createShape({
            id: shapeId,
            type: 'page-node',
            x: node.positionX,
            y: node.positionY,
            props: {
              name: node.name,
              w: 220,
              h: 96,
            },
          });
        } else {
          const current = editor.getShape(shapeId);
          if (!current) continue;
          const drifted =
            current.x !== node.positionX ||
            current.y !== node.positionY ||
            (current.props as { name: string }).name !== node.name;
          if (drifted) {
            editor.updateShape({
              id: shapeId,
              type: 'page-node',
              x: node.positionX,
              y: node.positionY,
              props: { name: node.name, w: 220, h: 96 },
            });
          }
        }
      }
    } finally {
      // Defer the flag flip so the synchronous tldraw events fired during
      // the calls above are still treated as remote.
      queueMicrotask(() => {
        applyingRemoteRef.current = false;
      });
    }
  }, [editor, nodes]);

  // Editor -> Convex: listen for user moves and deletions.
  useEffect(() => {
    if (!editor) return;

    const unsubscribe = editor.store.listen(
      (entry) => {
        if (applyingRemoteRef.current) return;

        for (const id of Object.keys(entry.changes.removed)) {
          if (!id.startsWith('shape:')) continue;
          const shape = entry.changes.removed[id as keyof typeof entry.changes.removed];
          if (shape && 'type' in shape && shape.type === 'page-node') {
            const nodeId = shapeIdToNodeId(id as TLShapeId);
            if (nodeId) removeMutation({ id: nodeId });
          }
        }

        for (const [id, [from, to]] of Object.entries(entry.changes.updated)) {
          if (!id.startsWith('shape:')) continue;
          if ('type' in from && from.type !== 'page-node') continue;
          const fromX = (from as { x?: number }).x;
          const fromY = (from as { y?: number }).y;
          const toX = (to as { x?: number }).x;
          const toY = (to as { y?: number }).y;
          if (fromX === toX && fromY === toY) continue;

          const nodeId = shapeIdToNodeId(id as TLShapeId);
          if (!nodeId || toX === undefined || toY === undefined) continue;

          const existing = debounceTimers.current.get(id);
          if (existing) clearTimeout(existing);
          const timer = setTimeout(() => {
            debounceTimers.current.delete(id);
            updateMutation({ id: nodeId, positionX: toX, positionY: toY });
          }, DEBOUNCE_MS);
          debounceTimers.current.set(id, timer);
        }
      },
      { source: 'user', scope: 'document' },
    );

    return () => {
      unsubscribe();
      const timers = debounceTimers.current;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [editor, updateMutation, removeMutation]);
}
```

- [ ] **Step 9.3: Verify typecheck**

```powershell
pnpm --filter @arch-viz/web typecheck
```

Expected: exit 0.

- [ ] **Step 9.4: Commit**

```powershell
git add apps/web/hooks
git commit -m "feat(web): add useCanvasSync hook (Convex <-> tldraw editor)"
```

---

## Task 10: `AddPageButton` component

**Files:**

- Create: `apps/web/components/canvas/add-page-button.tsx`

- [ ] **Step 10.1: Write `apps/web/components/canvas/add-page-button.tsx`**

```tsx
'use client';

import { useMutation } from 'convex/react';
import type { Editor } from 'tldraw';
import { Plus } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';

interface Props {
  projectId: Id<'projects'>;
  editor: Editor | null;
}

export function AddPageButton({ projectId, editor }: Props) {
  const create = useMutation(api.nodes.create);

  const onClick = async () => {
    // Place new node at viewport center; if editor isn't mounted yet, fall back to (0, 0).
    const center = editor?.getViewportPageCenter() ?? { x: 0, y: 0 };
    await create({
      projectId,
      type: 'page',
      name: 'New page',
      positionX: Math.round(center.x),
      positionY: Math.round(center.y),
    });
  };

  return (
    <Button size="sm" onClick={onClick}>
      <Plus className="mr-1 h-4 w-4" />
      Add page
    </Button>
  );
}
```

- [ ] **Step 10.2: Verify typecheck**

```powershell
pnpm --filter @arch-viz/web typecheck
```

- [ ] **Step 10.3: Commit**

```powershell
git add apps/web/components/canvas
git commit -m "feat(web): add AddPageButton component"
```

---

## Task 11: Wire shape util + sync + button into the canvas page

**Files:**

- Modify: `apps/web/app/canvas/[projectId]/page.tsx`

The canvas page needs three changes from Phase 1A:

1. Register `PageNodeShapeUtil` with the `Tldraw` component.
2. Capture the editor instance via `onMount`.
3. Subscribe to the nodes query and feed editor + nodes into `useCanvasSync`. Drop `persistenceKey` so Convex is the only source of truth.

- [ ] **Step 11.1: Replace `apps/web/app/canvas/[projectId]/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { Editor, TLComponents } from 'tldraw';

import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { PageNodeShapeUtil } from '@/components/canvas/page-node-shape';
import { AddPageButton } from '@/components/canvas/add-page-button';
import { useCanvasSync } from '@/hooks/use-canvas-sync';

// tldraw uses browser-only APIs; load it client-side only.
const Tldraw = dynamic(() => import('tldraw').then((m) => m.Tldraw), { ssr: false });

const shapeUtils = [PageNodeShapeUtil];

// Hide tldraw's default "page menu" / share zone since we render our own header.
const components: TLComponents = {
  PageMenu: null,
  MainMenu: null,
  ActionsMenu: null,
};

export default function CanvasPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId as Id<'projects'>;
  const project = useQuery(api.projects.get, { id: projectId });
  const nodes = useQuery(api.nodes.listByProject, { projectId });

  const [editor, setEditor] = useState<Editor | null>(null);
  useCanvasSync({ editor, nodes });

  if (project === undefined) {
    return <p className="p-8 text-muted-foreground">Loading…</p>;
  }
  if (project === null) {
    router.replace('/projects');
    return null;
  }

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/projects">
            <Button variant="ghost" size="sm">
              ← Projects
            </Button>
          </Link>
          <h1 className="text-lg font-medium">{project.name}</h1>
        </div>
        <div>
          <AddPageButton projectId={projectId} editor={editor} />
        </div>
      </header>
      <div className="flex-1">
        <Tldraw shapeUtils={shapeUtils} components={components} onMount={setEditor} />
      </div>
    </main>
  );
}
```

- [ ] **Step 11.2: Verify typecheck**

```powershell
pnpm --filter @arch-viz/web typecheck
```

Expected: exit 0.

- [ ] **Step 11.3: Commit**

```powershell
git add apps/web/app/canvas
git commit -m "feat(web): wire PageNodeShapeUtil + useCanvasSync + AddPageButton into canvas page"
```

---

## Task 12: Final verification

- [ ] **Step 12.1: Local CI pipeline**

```powershell
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all five exit 0; tests show 16 passing.

If `pnpm format` rewrote files, stage and commit them with `style: apply prettier formatting`.

- [ ] **Step 12.2: Manual smoke test**

In two terminals:

```powershell
pnpm dlx convex dev   # terminal 1
pnpm dev              # terminal 2
```

Open `http://localhost:3000` (NOT the network IP — Clerk requires the canonical origin):

1. Sign in (or land on `/projects` if session is alive).
2. Open an existing project (or create one) → land on `/canvas/<id>` with empty canvas + "Add page" button in the header.
3. Click **"Add page"** → a "New page" card should appear at viewport center within ~1 second (Convex roundtrip + reactive query).
4. Drag the card to a new position → release → after ~250 ms the move should persist (refresh the page; the card should still be where you left it).
5. Open a second tab to the same canvas URL → the same node should be visible. Move it in tab 1 → tab 2 should reflect the move within ~1 second.
6. Select the node and press **Delete** (or Backspace) → the node disappears in both tabs; refresh confirms it's gone from Convex.
7. Go back to `/projects` → delete the project → verify (after re-creating a new project) that no orphaned nodes are visible.

If any step fails, capture the browser console and paste it for debugging.

- [ ] **Step 12.3: Push branch**

```powershell
git push -u origin phase-1b-page-nodes
```

Wait for CI to be green at https://github.com/GlennAyden/Architecture-Visualization/actions.

- [ ] **Step 12.4: Merge to main and tag**

```powershell
git checkout main
git pull origin main
git merge phase-1b-page-nodes --ff-only
git tag -a phase-1b -m "Phase 1B: page nodes (custom shape + Convex sync)"
git push origin main phase-1b
```

---

## Phase 1B — Definition of Done checklist

- [ ] Convex schema has a `nodes` table with `by_project` and `by_parent` indexes.
- [ ] Convex functions `nodes.listByProject`, `create`, `update`, `remove` enforce per-project authorization through `requireProjectAccess`.
- [ ] `projects.remove` cascades to delete the project's nodes.
- [ ] Shared `nodeNameSchema` and `nodeTypeSchema` Zod definitions live in `packages/shared`.
- [ ] `PageNodeShapeUtil` renders a fixed-size `page-node` shape on the tldraw canvas.
- [ ] `useCanvasSync` hook reconciles Convex query results into the editor and pipes user moves / deletes back to Convex.
- [ ] Canvas page registers the custom shape util, captures the editor instance via `onMount`, and exposes an "Add page" button in the header.
- [ ] Local pipeline passes (`format:check`, `lint`, `typecheck`, `test` — 16 tests).
- [ ] Manual smoke test: add → drag → multi-tab live sync → delete → cascade-delete via project removal all verified.
- [ ] CI on `phase-1b-page-nodes` is green; tag `phase-1b` pushed to `main`.
