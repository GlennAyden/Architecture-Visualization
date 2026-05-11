# Phase 2A — MCP HTTP Actions (Convex Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose every Phase 2 MCP tool as a Convex HTTP Action authenticated by `x-api-key`, so the upcoming MCP server (Phase 2B) has a complete REST surface to call.

**Architecture:** All MCP tool requests enter through `convex/http.ts` via `httpRouter()`. Each route reads the `x-api-key` header, verifies it via `internal.apiTokens.verifyToken`, then dispatches to an internal mutation/query in `convex/mcp/*` that takes an explicit `userId` (since HTTP actions have no Clerk identity). The existing browser-facing mutations stay untouched — `convex/mcp/*` handlers are a parallel surface for HTTP-action consumers. Tests use `convexTest(schema, modules).fetch(path, init)` to exercise real HTTP semantics.

**Tech Stack:** Convex `httpRouter` + `httpAction`, `internalMutation`/`internalQuery`, Zod schemas in `@arch-viz/shared`, `convex-test` (already supports `t.fetch`).

---

## File Structure

**New files:**

- `convex/http.ts` — `httpRouter()` with all `/api/mcp/*` routes
- `convex/http.test.ts` — convex-test fetch-based coverage
- `convex/lib/mcpAuth.ts` — `requireApiToken(ctx, req)`, `jsonResponse(body, status?)`, `errorResponse(status, code, message, hint?)`
- `convex/mcp/lib.ts` — `requireOwnership(ctx, userId, projectId)` (throws on mismatch)
- `convex/mcp/nodes.ts` — internal node queries/mutations taking `userId`
- `convex/mcp/files.ts` — internal file mutations (multi-path link)
- `convex/mcp/kanban.ts` — internal kanban mutations
- `convex/mcp/activity.ts` — internal activity log mutation
- `packages/shared/src/mcp.ts` — Zod schemas for every MCP tool input

**Modified files:**

- `convex/schema.ts` — add `activityLog` table
- `convex/lib/cascade.ts` — delete `activityLog` rows when a node is removed
- `packages/shared/src/index.ts` — re-export `./mcp`

---

## Important conventions (from previous phases)

- Convex public mutations validate args via `v.*`; internal mutations do too.
- Mutations are **idempotent on deleted rows** (`if (!doc) return;`).
- Lenient read queries return `null`/`[]`; mutations throw with the literal word `"Unauthorized"` in the message so test regexes match.
- shadcn primitives use `@base-ui/react` (Phase 2A is backend-only; no UI touched).
- `convex-test` needs `import.meta.glob('./**/*.{ts,js}')` as second arg. Test files listed in `convex/tsconfig.json` exclude.
- HTTP responses must be `new Response(...)` from `httpAction`; don't throw — return an error response. (Throwing crashes the action with a 500.)
- Token format: `archv_<43char-base64url>`. `hashToken(raw)` is async (Web Crypto).

---

## Response shape conventions

All success responses are JSON: `{ ok: true, ... }` or a payload object.
All error responses are JSON: `{ error: { code, message, hint? } }` with appropriate HTTP status.

| Code            | HTTP | When                                             |
| --------------- | ---- | ------------------------------------------------ |
| `unauthorized`  | 401  | Missing / invalid / revoked token                |
| `forbidden`     | 403  | Token valid but target resource not in its scope |
| `not_found`     | 404  | Target resource doesn't exist                    |
| `invalid_input` | 400  | Zod validation failed                            |
| `internal`      | 500  | Unexpected server error                          |

---

### Task 1: Add `activityLog` table to schema

**Files:**

- Modify: `convex/schema.ts`

- [ ] **Step 1: Add the table after `apiTokens`**

In `convex/schema.ts`, inside `defineSchema({...})`, after the `apiTokens` block, add:

```ts
activityLog: defineTable({
  nodeId: v.id('nodes'),
  actor: v.string(), // 'user' | 'mcp:claude-code' | 'mcp:codex' | …
  message: v.string(),
  metadata: v.optional(v.any()),
}).index('by_node', ['nodeId']),
```

- [ ] **Step 2: Push schema and confirm typecheck**

Run: `pnpm exec convex dev --once`
Expected: succeeds, `_generated/dataModel.d.ts` regenerated.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git checkout -b phase-2a-mcp-http
git add convex/schema.ts
git commit -m "feat(convex): add activityLog table with by_node index"
```

---

### Task 2: Cascade-delete `activityLog` when a node is removed

**Files:**

- Modify: `convex/lib/cascade.ts`
- Modify (existing test): `convex/nodes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `convex/nodes.test.ts` (don't replace existing tests — just add at bottom):

```ts
describe('node cascade deletes activityLog', () => {
  test('activity entries are deleted when their node is deleted', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Home',
      positionX: 0,
      positionY: 0,
    });

    // Seed an activityLog row directly via run() helper since there's no
    // public mutation yet — this also confirms the table exists.
    await t.run(async (ctx) => {
      await ctx.db.insert('activityLog', {
        nodeId,
        actor: 'user',
        message: 'seed',
      });
    });

    let count = await t.run(async (ctx) =>
      (await ctx.db.query('activityLog').collect()).length,
    );
    expect(count).toBe(1);

    await asUser.mutation(api.nodes.remove, { id: nodeId });

    count = await t.run(async (ctx) =>
      (await ctx.db.query('activityLog').collect()).length,
    );
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `pnpm vitest run convex/nodes.test.ts -t "cascade deletes activityLog"`
Expected: FAIL — activityLog row still present after node delete.

- [ ] **Step 3: Update `deleteNodeCascade`**

In `convex/lib/cascade.ts`, between the `tasks` deletion loop and the final `await ctx.db.delete(nodeId)`, insert:

```ts
const activity = await ctx.db
  .query('activityLog')
  .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
  .collect();
for (const entry of activity) {
  await ctx.db.delete(entry._id);
}
```

The full updated `deleteNodeCascade` body should read:

```ts
export async function deleteNodeCascade(ctx: MutationCtx, nodeId: Id<'nodes'>) {
  const node = await ctx.db.get(nodeId);
  if (!node) return;

  const children = await ctx.db
    .query('nodes')
    .withIndex('by_parent', (q) => q.eq('parentId', nodeId))
    .collect();
  for (const child of children) {
    await deleteNodeCascade(ctx, child._id);
  }

  const files = await ctx.db
    .query('nodeFiles')
    .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
    .collect();
  for (const file of files) {
    await ctx.db.delete(file._id);
  }

  const tasks = await ctx.db
    .query('kanbanTasks')
    .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
    .collect();
  for (const task of tasks) {
    await ctx.db.delete(task._id);
  }

  const activity = await ctx.db
    .query('activityLog')
    .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
    .collect();
  for (const entry of activity) {
    await ctx.db.delete(entry._id);
  }

  await ctx.db.delete(nodeId);
}
```

- [ ] **Step 4: Re-run test (expect pass)**

Run: `pnpm vitest run convex/nodes.test.ts -t "cascade deletes activityLog"`
Expected: PASS.

- [ ] **Step 5: Run full test suite to confirm no regressions**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add convex/lib/cascade.ts convex/nodes.test.ts
git commit -m "feat(convex): cascade-delete activityLog entries with their node"
```

---

### Task 3: Shared MCP input Zod schemas

**Files:**

- Create: `packages/shared/src/mcp.ts`
- Create: `packages/shared/src/mcp.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/mcp.test.ts
import { describe, expect, test } from 'vitest';
import {
  createNodeInput,
  updateNodeInput,
  getNodeInput,
  deleteNodeInput,
  linkFilesInput,
  addKanbanTaskInput,
  updateKanbanStatusInput,
  logActivityInput,
} from './mcp';

describe('createNodeInput', () => {
  test('accepts minimal input', () => {
    expect(createNodeInput.parse({ type: 'page', name: 'Home' })).toEqual({
      type: 'page',
      name: 'Home',
    });
  });

  test('accepts feature with parentId and optional fields', () => {
    const parsed = createNodeInput.parse({
      type: 'feature',
      name: 'Auth',
      parentId: 'nodes:abc',
      description: 'OAuth handlers',
      files: ['src/auth.ts'],
      positionX: 100,
      positionY: 200,
    });
    expect(parsed.type).toBe('feature');
    expect(parsed.files).toEqual(['src/auth.ts']);
  });

  test('rejects unknown type', () => {
    expect(() => createNodeInput.parse({ type: 'component', name: 'X' })).toThrow();
  });

  test('rejects empty name', () => {
    expect(() => createNodeInput.parse({ type: 'page', name: '   ' })).toThrow(/required/i);
  });
});

describe('updateNodeInput', () => {
  test('requires nodeId', () => {
    expect(() => updateNodeInput.parse({ name: 'New' })).toThrow();
  });

  test('allows partial fields', () => {
    expect(
      updateNodeInput.parse({ nodeId: 'nodes:abc', description: 'updated' }),
    ).toMatchObject({ nodeId: 'nodes:abc', description: 'updated' });
  });
});

describe('linkFilesInput', () => {
  test('accepts list of paths', () => {
    expect(
      linkFilesInput.parse({ nodeId: 'nodes:abc', paths: ['a.ts', 'b.ts'] }),
    ).toEqual({ nodeId: 'nodes:abc', paths: ['a.ts', 'b.ts'] });
  });

  test('rejects empty paths array', () => {
    expect(() => linkFilesInput.parse({ nodeId: 'nodes:abc', paths: [] })).toThrow();
  });
});

describe('addKanbanTaskInput', () => {
  test('defaults status to todo', () => {
    expect(addKanbanTaskInput.parse({ nodeId: 'nodes:abc', title: 'X' })).toMatchObject({
      status: 'todo',
    });
  });

  test('accepts all status values', () => {
    for (const status of ['todo', 'doing', 'done'] as const) {
      expect(
        addKanbanTaskInput.parse({ nodeId: 'nodes:abc', title: 'X', status }).status,
      ).toBe(status);
    }
  });
});

describe('updateKanbanStatusInput', () => {
  test('rejects unknown status', () => {
    expect(() =>
      updateKanbanStatusInput.parse({ taskId: 'kanbanTasks:abc', status: 'archived' }),
    ).toThrow();
  });
});

describe('logActivityInput + getNodeInput + deleteNodeInput', () => {
  test('logActivityInput accepts optional metadata', () => {
    expect(
      logActivityInput.parse({ nodeId: 'nodes:abc', actor: 'mcp:claude-code', message: 'x' }),
    ).toMatchObject({ actor: 'mcp:claude-code' });
  });

  test('getNodeInput requires nodeId', () => {
    expect(getNodeInput.parse({ nodeId: 'nodes:abc' }).nodeId).toBe('nodes:abc');
  });

  test('deleteNodeInput requires nodeId', () => {
    expect(deleteNodeInput.parse({ nodeId: 'nodes:abc' }).nodeId).toBe('nodes:abc');
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `pnpm vitest run packages/shared/src/mcp.test.ts`
Expected: FAIL — "Cannot find module './mcp'".

- [ ] **Step 3: Create the schemas**

```ts
// packages/shared/src/mcp.ts
import { z } from 'zod';
import { kanbanStatusSchema } from './kanban';

/** Shared by every MCP tool that names a node. */
const nodeIdSchema = z.string().min(1);
const taskIdSchema = z.string().min(1);

const namePattern = z.string().trim().min(1, 'name is required').max(80);
const descriptionPattern = z.string().max(4000).optional();
const pathPattern = z.string().trim().min(1).max(500);

export const listNodesInput = z.object({}).strict();

export const getNodeInput = z.object({ nodeId: nodeIdSchema }).strict();

export const createNodeInput = z
  .object({
    type: z.enum(['page', 'feature']),
    name: namePattern,
    parentId: z.string().optional(),
    description: descriptionPattern,
    files: z.array(pathPattern).optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
  })
  .strict();

export const updateNodeInput = z
  .object({
    nodeId: nodeIdSchema,
    name: namePattern.optional(),
    description: descriptionPattern,
    positionX: z.number().optional(),
    positionY: z.number().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      v.positionX !== undefined ||
      v.positionY !== undefined,
    { message: 'At least one field must be updated' },
  );

export const deleteNodeInput = z.object({ nodeId: nodeIdSchema }).strict();

export const linkFilesInput = z
  .object({
    nodeId: nodeIdSchema,
    paths: z.array(pathPattern).min(1, 'paths must not be empty'),
  })
  .strict();

export const addKanbanTaskInput = z
  .object({
    nodeId: nodeIdSchema,
    title: z.string().trim().min(1, 'title required').max(200),
    description: z.string().max(2000).optional(),
    status: kanbanStatusSchema.default('todo'),
  })
  .strict();

export const updateKanbanStatusInput = z
  .object({
    taskId: taskIdSchema,
    status: kanbanStatusSchema,
  })
  .strict();

export const logActivityInput = z
  .object({
    nodeId: nodeIdSchema,
    actor: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(2000),
    metadata: z.unknown().optional(),
  })
  .strict();
```

- [ ] **Step 4: Re-export from index**

In `packages/shared/src/index.ts`, append:

```ts
export * from './mcp';
```

- [ ] **Step 5: Run test (expect pass)**

Run: `pnpm vitest run packages/shared/src/mcp.test.ts`
Expected: PASS, all assertions.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/mcp.ts packages/shared/src/mcp.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add Zod schemas for MCP tool inputs"
```

---

### Task 4: HTTP auth + response helpers

**Files:**

- Create: `convex/lib/mcpAuth.ts`

- [ ] **Step 1: Create the helper**

```ts
// convex/lib/mcpAuth.ts
import { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';

export type AuthResult = {
  userId: Id<'profiles'>;
  projectId: Id<'projects'>;
  tokenId: Id<'apiTokens'>;
};

/**
 * Reads `x-api-key` from the request, verifies against apiTokens.
 * Returns the resolved auth principal or null if the header is missing
 * or the token is unknown / revoked.
 *
 * Caller is expected to short-circuit with `errorResponse(401, …)` on null.
 */
export async function requireApiToken(
  ctx: ActionCtx,
  req: Request,
): Promise<AuthResult | null> {
  const raw = req.headers.get('x-api-key');
  if (!raw) return null;
  const result = await ctx.runMutation(internal.apiTokens.verifyToken, { rawToken: raw });
  if (!result) return null;
  return result as AuthResult;
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  hint?: string,
): Response {
  return jsonResponse(
    { error: { code, message, ...(hint ? { hint } : {}) } },
    status,
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm exec convex dev --once`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add convex/lib/mcpAuth.ts
git commit -m "feat(convex): add HTTP auth + JSON response helpers for MCP routes"
```

---

### Task 5: Internal ownership helper

**Files:**

- Create: `convex/mcp/lib.ts`

- [ ] **Step 1: Create the helper**

```ts
// convex/mcp/lib.ts
import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx, QueryCtx } from '../_generated/server';

type AnyCtx = QueryCtx | MutationCtx;

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Internal-handler counterpart of `requireProjectAccess`: takes an explicit
 * userId (resolved by the HTTP auth layer) instead of reading Clerk identity.
 * Returns the project. Throws NotFoundError or ForbiddenError.
 */
export async function requireOwnership(
  ctx: AnyCtx,
  userId: Id<'profiles'>,
  projectId: Id<'projects'>,
): Promise<Doc<'projects'>> {
  const project = await ctx.db.get(projectId);
  if (!project) throw new NotFoundError('Project not found');
  if (project.userId !== userId) throw new ForbiddenError('Project not in token scope');
  return project;
}

/**
 * Same idea for nodes — verifies that the node exists AND belongs to a project
 * owned by `userId`. Caller may want to also check `node.projectId === scopeProjectId`
 * to enforce per-token project scoping.
 */
export async function requireNodeOwnership(
  ctx: AnyCtx,
  userId: Id<'profiles'>,
  nodeId: Id<'nodes'>,
): Promise<Doc<'nodes'>> {
  const node = await ctx.db.get(nodeId);
  if (!node) throw new NotFoundError('Node not found');
  await requireOwnership(ctx, userId, node.projectId);
  return node;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm exec convex dev --once`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add convex/mcp/lib.ts
git commit -m "feat(convex): add internal ownership helpers (userId + projectId/nodeId)"
```

---

### Task 6: HTTP router skeleton + `/api/mcp/health`

**Files:**

- Create: `convex/http.ts`
- Create: `convex/http.test.ts`

This task wires up the router and proves the auth layer end-to-end via the simplest possible route. Once this passes, every later route follows the same pattern.

- [ ] **Step 1: Write the failing test**

```ts
// convex/http.test.ts
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
```

- [ ] **Step 2: Run test (expect fail — http.ts does not exist)**

Run: `pnpm vitest run convex/http.test.ts`
Expected: FAIL — fetch returns 404 (no route registered).

- [ ] **Step 3: Create `convex/http.ts`**

```ts
// convex/http.ts
import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { errorResponse, jsonResponse, requireApiToken } from './lib/mcpAuth';

const http = httpRouter();

http.route({
  path: '/api/mcp/health',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) {
      return errorResponse(
        401,
        'unauthorized',
        'Missing or invalid API token.',
        'Set ARCHITECTURE_API_KEY to a token issued in /settings/tokens.',
      );
    }

    const project = await ctx.runQuery(internal.mcp.nodes.getProjectSummary, {
      userId: auth.userId,
      projectId: auth.projectId,
    });

    if (!project) {
      return errorResponse(
        404,
        'not_found',
        'Project for this token no longer exists.',
        'Generate a new token in /settings/tokens.',
      );
    }

    const token = await ctx.runQuery(internal.apiTokens.getTokenForHealth, {
      tokenId: auth.tokenId,
    });

    return jsonResponse({
      projectId: auth.projectId,
      projectName: project.name,
      tokenName: token?.name ?? '(unknown)',
    });
  }),
});

export default http;
```

The `internal.*` references above mean we also need two internal queries. Add them as part of this task:

In a new file `convex/mcp/nodes.ts`, paste **the skeleton** (we'll extend it in later tasks):

```ts
// convex/mcp/nodes.ts
import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { requireOwnership } from './lib';

export const getProjectSummary = internalQuery({
  args: { userId: v.id('profiles'), projectId: v.id('projects') },
  handler: async (ctx, { userId, projectId }) => {
    try {
      const project = await requireOwnership(ctx, userId, projectId);
      return { name: project.name };
    } catch {
      return null;
    }
  },
});
```

And extend `convex/apiTokens.ts` with one new internal query (NOT a mutation — read-only lookup):

```ts
// Append at the bottom of convex/apiTokens.ts:
import { internalQuery } from './_generated/server';

export const getTokenForHealth = internalQuery({
  args: { tokenId: v.id('apiTokens') },
  handler: async (ctx, { tokenId }) => {
    return await ctx.db.get(tokenId);
  },
});
```

(If `internalQuery` is not yet imported at the top, add it to the existing import line. Don't duplicate.)

Finally, fix the import in `convex/http.ts` — it needs the generated `internal` object:

Add to the imports at the top:

```ts
import { internal } from './_generated/api';
```

- [ ] **Step 4: Re-run test (expect pass)**

Run: `pnpm vitest run convex/http.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add convex/http.ts convex/http.test.ts convex/mcp/nodes.ts convex/apiTokens.ts
git commit -m "feat(convex): add /api/mcp/health endpoint + httpRouter scaffold"
```

---

### Task 7: `/api/mcp/nodes/list`

**Files:**

- Modify: `convex/mcp/nodes.ts`
- Modify: `convex/http.ts`
- Modify: `convex/http.test.ts`

- [ ] **Step 1: Append test cases**

```ts
// Append to convex/http.test.ts
describe('POST /api/mcp/nodes/list', () => {
  test('401 when no token', async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch('/api/mcp/nodes/list', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  test('200 with empty array when project has no nodes', async () => {
    const t = convexTest(schema, modules);
    const { rawToken } = await seedTokenForUser(t);
    const res = await t.fetch('/api/mcp/nodes/list', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toEqual([]);
  });

  test('200 returns nodes for the token-scoped project only', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Home',
      positionX: 0,
      positionY: 0,
    });

    // Second project for the same user — its nodes must NOT leak.
    const otherProject = await asUser.mutation(api.projects.create, { name: 'Other' });
    await asUser.mutation(api.nodes.create, {
      projectId: otherProject,
      type: 'page',
      name: 'Leaked',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/list', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toHaveLength(1);
    expect(body.nodes[0].name).toEqual('Home');
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `pnpm vitest run convex/http.test.ts -t "nodes/list"`
Expected: FAIL — 404 from fetch.

- [ ] **Step 3: Add the internal query**

In `convex/mcp/nodes.ts`, append:

```ts
export const listForProject = internalQuery({
  args: { userId: v.id('profiles'), projectId: v.id('projects') },
  handler: async (ctx, { userId, projectId }) => {
    await requireOwnership(ctx, userId, projectId);
    const nodes = await ctx.db
      .query('nodes')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    return nodes.map((n) => ({
      id: n._id,
      type: n.type,
      name: n.name,
      parentId: n.parentId ?? null,
      description: n.description ?? null,
      positionX: n.positionX,
      positionY: n.positionY,
    }));
  },
});
```

- [ ] **Step 4: Add the HTTP route**

In `convex/http.ts`, after the `/api/mcp/health` route:

```ts
http.route({
  path: '/api/mcp/nodes/list',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) {
      return errorResponse(401, 'unauthorized', 'Missing or invalid API token.');
    }
    try {
      const nodes = await ctx.runQuery(internal.mcp.nodes.listForProject, {
        userId: auth.userId,
        projectId: auth.projectId,
      });
      return jsonResponse({ nodes });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Forbidden')) return errorResponse(403, 'forbidden', msg);
      if (msg.includes('Not found')) return errorResponse(404, 'not_found', msg);
      return errorResponse(500, 'internal', msg);
    }
  }),
});
```

- [ ] **Step 5: Re-run tests (expect pass)**

Run: `pnpm vitest run convex/http.test.ts -t "nodes/list"`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add convex/mcp/nodes.ts convex/http.ts convex/http.test.ts
git commit -m "feat(convex): add /api/mcp/nodes/list endpoint"
```

---

### Task 8: `/api/mcp/nodes/get`

**Files:**

- Modify: `convex/mcp/nodes.ts`
- Modify: `convex/http.ts`
- Modify: `convex/http.test.ts`

- [ ] **Step 1: Append test cases**

```ts
// Append to convex/http.test.ts
describe('POST /api/mcp/nodes/get', () => {
  test('404 for unknown nodeId', async () => {
    const t = convexTest(schema, modules);
    const { rawToken } = await seedTokenForUser(t);
    const res = await t.fetch('/api/mcp/nodes/get', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'nodes:notreal' }),
    });
    expect([400, 404]).toContain(res.status);
  });

  test('200 returns node detail with files and kanban', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Settings',
      positionX: 10,
      positionY: 20,
    });
    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'src/settings.tsx' });
    await asUser.mutation(api.kanban.create, {
      nodeId,
      title: 'Build form',
      status: 'doing',
    });

    const res = await t.fetch('/api/mcp/nodes/get', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.node.name).toEqual('Settings');
    expect(body.node.files).toHaveLength(1);
    expect(body.node.files[0].path).toEqual('src/settings.tsx');
    expect(body.node.kanbanTasks).toHaveLength(1);
    expect(body.node.kanbanTasks[0].status).toEqual('doing');
  });

  test('403 when node belongs to a different project than the token', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken } = await seedTokenForUser(t);
    const other = await asUser.mutation(api.projects.create, { name: 'Other' });
    const foreignNode = await asUser.mutation(api.nodes.create, {
      projectId: other,
      type: 'page',
      name: 'Leaked',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/get', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: foreignNode }),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `pnpm vitest run convex/http.test.ts -t "nodes/get"`
Expected: FAIL.

- [ ] **Step 3: Add the internal query**

In `convex/mcp/nodes.ts`, append:

```ts
import { ForbiddenError, NotFoundError, requireNodeOwnership, requireOwnership } from './lib';

export const getDetail = internalQuery({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    nodeId: v.id('nodes'),
  },
  handler: async (ctx, { userId, scopeProjectId, nodeId }) => {
    const node = await requireNodeOwnership(ctx, userId, nodeId);
    if (node.projectId !== scopeProjectId) {
      throw new ForbiddenError('Node not in token scope');
    }
    const files = await ctx.db
      .query('nodeFiles')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
    const tasks = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
    return {
      id: node._id,
      type: node.type,
      name: node.name,
      parentId: node.parentId ?? null,
      description: node.description ?? null,
      positionX: node.positionX,
      positionY: node.positionY,
      files: files.map((f) => ({ id: f._id, path: f.path })),
      kanbanTasks: tasks
        .sort((a, b) => a.position - b.position)
        .map((t) => ({
          id: t._id,
          title: t.title,
          description: t.description ?? null,
          status: t.status,
          position: t.position,
        })),
    };
  },
});
```

You'll also need to import the helper. At the top of `convex/mcp/nodes.ts`, ensure both lib helpers are imported (replace the existing line if it only had `requireOwnership`):

```ts
import { ForbiddenError, requireNodeOwnership, requireOwnership } from './lib';
```

`NotFoundError` not needed here — `requireNodeOwnership` already throws it.

- [ ] **Step 4: Add the HTTP route**

In `convex/http.ts`:

```ts
import { getNodeInput } from '@arch-viz/shared';

http.route({
  path: '/api/mcp/nodes/get',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) return errorResponse(401, 'unauthorized', 'Missing or invalid API token.');

    const raw = await req.json().catch(() => ({}));
    const parsed = getNodeInput.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'invalid');
    }

    try {
      const node = await ctx.runQuery(internal.mcp.nodes.getDetail, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        nodeId: parsed.data.nodeId as Id<'nodes'>,
      });
      return jsonResponse({ node });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Forbidden') || msg.includes('not in token scope'))
        return errorResponse(403, 'forbidden', msg);
      if (msg.includes('Not found') || msg.includes('not found'))
        return errorResponse(404, 'not_found', msg);
      return errorResponse(400, 'invalid_input', msg);
    }
  }),
});
```

Add `Id` import too at the top of `http.ts`:

```ts
import { Id } from './_generated/dataModel';
```

- [ ] **Step 5: Run tests (expect pass)**

Run: `pnpm vitest run convex/http.test.ts -t "nodes/get"`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add convex/mcp/nodes.ts convex/http.ts convex/http.test.ts
git commit -m "feat(convex): add /api/mcp/nodes/get endpoint with files + kanban"
```

---

### Task 9: `/api/mcp/nodes/create`

**Files:**

- Modify: `convex/mcp/nodes.ts`
- Create: `convex/mcp/files.ts` (will be expanded in Task 12)
- Modify: `convex/http.ts`
- Modify: `convex/http.test.ts`

- [ ] **Step 1: Append test cases**

```ts
// Append to convex/http.test.ts
describe('POST /api/mcp/nodes/create', () => {
  test('400 for invalid input (missing name)', async () => {
    const t = convexTest(schema, modules);
    const { rawToken } = await seedTokenForUser(t);
    const res = await t.fetch('/api/mcp/nodes/create', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'page' }),
    });
    expect(res.status).toBe(400);
  });

  test('200 creates a minimal page node and returns its id', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken } = await seedTokenForUser(t);
    const res = await t.fetch('/api/mcp/nodes/create', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'page', name: 'About' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.nodeId).toBe('string');
    expect(body.name).toBe('About');

    const nodes = await asUser.query(api.nodes.listByProject, {
      projectId: (await asUser.query(api.projects.list))[0]!._id,
    });
    expect(nodes.find((n) => n.name === 'About')).toBeDefined();
  });

  test('200 creates a feature with parentId, description, and files in one call', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const parentId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Auth',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/create', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'feature',
        name: 'OAuth callback',
        parentId,
        description: 'Handles /auth/callback',
        files: ['src/auth/callback.ts', 'src/auth/utils.ts'],
        positionX: 50,
        positionY: 50,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodeId).toBeDefined();

    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId: body.nodeId });
    expect(files.map((f) => f.path).sort()).toEqual(['src/auth/callback.ts', 'src/auth/utils.ts']);
  });

  test('403 when parentId belongs to a different project', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken } = await seedTokenForUser(t);
    const other = await asUser.mutation(api.projects.create, { name: 'Other' });
    const foreignParent = await asUser.mutation(api.nodes.create, {
      projectId: other,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/create', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'feature',
        name: 'orphan',
        parentId: foreignParent,
      }),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `pnpm vitest run convex/http.test.ts -t "nodes/create"`
Expected: FAIL.

- [ ] **Step 3: Add the internal mutation**

Append to `convex/mcp/nodes.ts`:

```ts
import { internalMutation } from '../_generated/server';

export const createForProject = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    type: v.union(v.literal('page'), v.literal('feature')),
    name: v.string(),
    parentId: v.optional(v.id('nodes')),
    description: v.optional(v.string()),
    files: v.optional(v.array(v.string())),
    positionX: v.optional(v.number()),
    positionY: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnership(ctx, args.userId, args.scopeProjectId);

    const trimmed = args.name.trim();
    if (trimmed.length === 0) throw new Error('Node name is required');
    if (trimmed.length > 80) throw new Error('Node name must be 80 characters or fewer');

    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.projectId !== args.scopeProjectId) {
        throw new ForbiddenError('Parent node not in token scope');
      }
    }

    // Default position: scatter around origin so AI-created nodes don't stack.
    const positionX = args.positionX ?? Math.round((Math.random() - 0.5) * 400);
    const positionY = args.positionY ?? Math.round((Math.random() - 0.5) * 400);

    const nodeId = await ctx.db.insert('nodes', {
      projectId: args.scopeProjectId,
      parentId: args.parentId,
      type: args.type,
      name: trimmed,
      description: args.description?.trim() || undefined,
      positionX,
      positionY,
    });

    if (args.files && args.files.length > 0) {
      const seen = new Set<string>();
      for (const raw of args.files) {
        const p = raw.trim();
        if (p.length === 0 || p.length > 500) continue;
        if (seen.has(p)) continue;
        seen.add(p);
        await ctx.db.insert('nodeFiles', { nodeId, path: p });
      }
    }

    return { nodeId, name: trimmed };
  },
});
```

- [ ] **Step 4: Add the HTTP route**

In `convex/http.ts`, import `createNodeInput`:

```ts
import { createNodeInput, getNodeInput } from '@arch-viz/shared';
```

Then:

```ts
http.route({
  path: '/api/mcp/nodes/create',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) return errorResponse(401, 'unauthorized', 'Missing or invalid API token.');

    const raw = await req.json().catch(() => ({}));
    const parsed = createNodeInput.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'invalid');
    }

    try {
      const result = await ctx.runMutation(internal.mcp.nodes.createForProject, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        type: parsed.data.type,
        name: parsed.data.name,
        parentId: parsed.data.parentId as Id<'nodes'> | undefined,
        description: parsed.data.description,
        files: parsed.data.files,
        positionX: parsed.data.positionX,
        positionY: parsed.data.positionY,
      });
      return jsonResponse(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Forbidden') || msg.includes('not in token scope'))
        return errorResponse(403, 'forbidden', msg);
      if (msg.includes('Not found')) return errorResponse(404, 'not_found', msg);
      return errorResponse(400, 'invalid_input', msg);
    }
  }),
});
```

- [ ] **Step 5: Run tests (expect pass)**

Run: `pnpm vitest run convex/http.test.ts -t "nodes/create"`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add convex/mcp/nodes.ts convex/http.ts convex/http.test.ts
git commit -m "feat(convex): add /api/mcp/nodes/create endpoint (with parentId + files)"
```

---

### Task 10: `/api/mcp/nodes/update`

**Files:**

- Modify: `convex/mcp/nodes.ts`
- Modify: `convex/http.ts`
- Modify: `convex/http.test.ts`

- [ ] **Step 1: Append test cases**

```ts
// Append to convex/http.test.ts
describe('POST /api/mcp/nodes/update', () => {
  test('200 updates description', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/update', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, description: 'updated desc' }),
    });
    expect(res.status).toBe(200);
    const node = await asUser.query(api.nodes.get, { id: nodeId });
    expect(node?.description).toEqual('updated desc');
  });

  test('403 for node outside token scope', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken } = await seedTokenForUser(t);
    const other = await asUser.mutation(api.projects.create, { name: 'Other' });
    const foreign = await asUser.mutation(api.nodes.create, {
      projectId: other,
      type: 'page',
      name: 'Leaked',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/update', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: foreign, name: 'pwned' }),
    });
    expect(res.status).toBe(403);
  });

  test('400 when no fields are updated', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/update', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `pnpm vitest run convex/http.test.ts -t "nodes/update"`
Expected: FAIL.

- [ ] **Step 3: Add the internal mutation**

Append to `convex/mcp/nodes.ts`:

```ts
export const updateForProject = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    nodeId: v.id('nodes'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    positionX: v.optional(v.number()),
    positionY: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const node = await ctx.db.get(args.nodeId);
    if (!node) return; // idempotent
    await requireOwnership(ctx, args.userId, node.projectId);
    if (node.projectId !== args.scopeProjectId) {
      throw new ForbiddenError('Node not in token scope');
    }

    const patch: Partial<typeof node> = {};
    if (args.name !== undefined) {
      const trimmed = args.name.trim();
      if (trimmed.length === 0) throw new Error('Node name is required');
      if (trimmed.length > 80) throw new Error('Node name must be 80 characters or fewer');
      patch.name = trimmed;
    }
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    if (args.positionX !== undefined) patch.positionX = args.positionX;
    if (args.positionY !== undefined) patch.positionY = args.positionY;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.nodeId, patch);
    }
  },
});
```

- [ ] **Step 4: Add the HTTP route**

Import `updateNodeInput`:

```ts
import { createNodeInput, getNodeInput, updateNodeInput } from '@arch-viz/shared';
```

Then:

```ts
http.route({
  path: '/api/mcp/nodes/update',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) return errorResponse(401, 'unauthorized', 'Missing or invalid API token.');

    const raw = await req.json().catch(() => ({}));
    const parsed = updateNodeInput.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'invalid');
    }

    try {
      await ctx.runMutation(internal.mcp.nodes.updateForProject, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        nodeId: parsed.data.nodeId as Id<'nodes'>,
        name: parsed.data.name,
        description: parsed.data.description,
        positionX: parsed.data.positionX,
        positionY: parsed.data.positionY,
      });
      return jsonResponse({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Forbidden') || msg.includes('not in token scope'))
        return errorResponse(403, 'forbidden', msg);
      if (msg.includes('Not found')) return errorResponse(404, 'not_found', msg);
      return errorResponse(400, 'invalid_input', msg);
    }
  }),
});
```

- [ ] **Step 5: Run tests (expect pass)**

Run: `pnpm vitest run convex/http.test.ts -t "nodes/update"`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add convex/mcp/nodes.ts convex/http.ts convex/http.test.ts
git commit -m "feat(convex): add /api/mcp/nodes/update endpoint"
```

---

### Task 11: `/api/mcp/nodes/delete`

**Files:**

- Modify: `convex/mcp/nodes.ts`
- Modify: `convex/http.ts`
- Modify: `convex/http.test.ts`

- [ ] **Step 1: Append test cases**

```ts
// Append to convex/http.test.ts
describe('POST /api/mcp/nodes/delete', () => {
  test('200 deletes a node and cascades', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Doomed',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/nodes/delete', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
    expect(res.status).toBe(200);
    const after = await asUser.query(api.nodes.get, { id: nodeId });
    expect(after).toBeNull();
  });

  test('200 is idempotent on already-deleted node', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Doomed',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodes.remove, { id: nodeId });

    const res = await t.fetch('/api/mcp/nodes/delete', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `pnpm vitest run convex/http.test.ts -t "nodes/delete"`
Expected: FAIL.

- [ ] **Step 3: Add the internal mutation**

Append to `convex/mcp/nodes.ts`:

```ts
import { deleteNodeCascade } from '../lib/cascade';

export const removeForProject = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    nodeId: v.id('nodes'),
  },
  handler: async (ctx, { userId, scopeProjectId, nodeId }) => {
    const node = await ctx.db.get(nodeId);
    if (!node) return; // idempotent
    await requireOwnership(ctx, userId, node.projectId);
    if (node.projectId !== scopeProjectId) {
      throw new ForbiddenError('Node not in token scope');
    }
    await deleteNodeCascade(ctx, nodeId);
  },
});
```

- [ ] **Step 4: Add the HTTP route**

Import `deleteNodeInput`:

```ts
import { createNodeInput, deleteNodeInput, getNodeInput, updateNodeInput } from '@arch-viz/shared';
```

```ts
http.route({
  path: '/api/mcp/nodes/delete',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) return errorResponse(401, 'unauthorized', 'Missing or invalid API token.');

    const raw = await req.json().catch(() => ({}));
    const parsed = deleteNodeInput.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'invalid');
    }

    try {
      await ctx.runMutation(internal.mcp.nodes.removeForProject, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        nodeId: parsed.data.nodeId as Id<'nodes'>,
      });
      return jsonResponse({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Forbidden') || msg.includes('not in token scope'))
        return errorResponse(403, 'forbidden', msg);
      if (msg.includes('Not found')) return errorResponse(404, 'not_found', msg);
      return errorResponse(400, 'invalid_input', msg);
    }
  }),
});
```

- [ ] **Step 5: Run tests (expect pass)**

Run: `pnpm vitest run convex/http.test.ts -t "nodes/delete"`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add convex/mcp/nodes.ts convex/http.ts convex/http.test.ts
git commit -m "feat(convex): add /api/mcp/nodes/delete endpoint (idempotent cascade)"
```

---

### Task 12: `/api/mcp/files/link`

**Files:**

- Create: `convex/mcp/files.ts`
- Modify: `convex/http.ts`
- Modify: `convex/http.test.ts`

- [ ] **Step 1: Append test cases**

```ts
// Append to convex/http.test.ts
describe('POST /api/mcp/files/link', () => {
  test('200 links multiple paths and dedupes', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Files',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/files/link', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        paths: ['a.ts', 'b.ts', 'a.ts'],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.linked).toBe(2);

    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId });
    expect(files.map((f) => f.path).sort()).toEqual(['a.ts', 'b.ts']);
  });

  test('200 ignores paths that already exist on the node', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'Files',
      positionX: 0,
      positionY: 0,
    });
    await asUser.mutation(api.nodeFiles.add, { nodeId, path: 'a.ts' });

    const res = await t.fetch('/api/mcp/files/link', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, paths: ['a.ts', 'b.ts'] }),
    });
    expect(res.status).toBe(200);
    const files = await asUser.query(api.nodeFiles.listByNode, { nodeId });
    expect(files).toHaveLength(2);
  });

  test('403 when node is outside token scope', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken } = await seedTokenForUser(t);
    const other = await asUser.mutation(api.projects.create, { name: 'O' });
    const foreign = await asUser.mutation(api.nodes.create, {
      projectId: other,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/files/link', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: foreign, paths: ['a.ts'] }),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `pnpm vitest run convex/http.test.ts -t "files/link"`
Expected: FAIL.

- [ ] **Step 3: Create internal file handler**

```ts
// convex/mcp/files.ts
import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { ForbiddenError, requireNodeOwnership } from './lib';

export const linkMany = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    nodeId: v.id('nodes'),
    paths: v.array(v.string()),
  },
  handler: async (ctx, { userId, scopeProjectId, nodeId, paths }) => {
    const node = await requireNodeOwnership(ctx, userId, nodeId);
    if (node.projectId !== scopeProjectId) {
      throw new ForbiddenError('Node not in token scope');
    }

    const existing = await ctx.db
      .query('nodeFiles')
      .withIndex('by_node', (q) => q.eq('nodeId', nodeId))
      .collect();
    const existingPaths = new Set(existing.map((f) => f.path));

    let linked = 0;
    const seen = new Set<string>();
    for (const raw of paths) {
      const p = raw.trim();
      if (p.length === 0 || p.length > 500) continue;
      if (seen.has(p) || existingPaths.has(p)) continue;
      seen.add(p);
      await ctx.db.insert('nodeFiles', { nodeId, path: p });
      linked++;
    }

    return { linked };
  },
});
```

- [ ] **Step 4: Add the HTTP route**

In `convex/http.ts`, add `linkFilesInput` to the import:

```ts
import {
  createNodeInput,
  deleteNodeInput,
  getNodeInput,
  linkFilesInput,
  updateNodeInput,
} from '@arch-viz/shared';
```

Then:

```ts
http.route({
  path: '/api/mcp/files/link',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) return errorResponse(401, 'unauthorized', 'Missing or invalid API token.');

    const raw = await req.json().catch(() => ({}));
    const parsed = linkFilesInput.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'invalid');
    }

    try {
      const result = await ctx.runMutation(internal.mcp.files.linkMany, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        nodeId: parsed.data.nodeId as Id<'nodes'>,
        paths: parsed.data.paths,
      });
      return jsonResponse(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Forbidden') || msg.includes('not in token scope'))
        return errorResponse(403, 'forbidden', msg);
      if (msg.includes('Not found')) return errorResponse(404, 'not_found', msg);
      return errorResponse(400, 'invalid_input', msg);
    }
  }),
});
```

- [ ] **Step 5: Run tests (expect pass)**

Run: `pnpm vitest run convex/http.test.ts -t "files/link"`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add convex/mcp/files.ts convex/http.ts convex/http.test.ts
git commit -m "feat(convex): add /api/mcp/files/link endpoint (multi-path, dedupes)"
```

---

### Task 13: `/api/mcp/kanban/add`

**Files:**

- Create: `convex/mcp/kanban.ts`
- Modify: `convex/http.ts`
- Modify: `convex/http.test.ts`

- [ ] **Step 1: Append test cases**

```ts
// Append to convex/http.test.ts
describe('POST /api/mcp/kanban/add', () => {
  test('200 creates a kanban task and returns its id', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/kanban/add', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, title: 'Build form', status: 'doing' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.taskId).toBe('string');

    const tasks = await asUser.query(api.kanban.listByNode, { nodeId });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toEqual('doing');
  });

  test('400 for empty title', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/kanban/add', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, title: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `pnpm vitest run convex/http.test.ts -t "kanban/add"`
Expected: FAIL.

- [ ] **Step 3: Create internal kanban handler**

```ts
// convex/mcp/kanban.ts
import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { ForbiddenError, requireNodeOwnership } from './lib';

const statusValidator = v.union(v.literal('todo'), v.literal('doing'), v.literal('done'));

export const addTask = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    nodeId: v.id('nodes'),
    title: v.string(),
    description: v.optional(v.string()),
    status: statusValidator,
  },
  handler: async (ctx, args) => {
    const node = await requireNodeOwnership(ctx, args.userId, args.nodeId);
    if (node.projectId !== args.scopeProjectId) {
      throw new ForbiddenError('Node not in token scope');
    }

    const trimmed = args.title.trim();
    if (trimmed.length === 0) throw new Error('Task title is required');
    if (trimmed.length > 200) throw new Error('Task title must be 200 characters or fewer');

    const tasksInColumn = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_node_status', (q) => q.eq('nodeId', args.nodeId).eq('status', args.status))
      .collect();
    const nextPosition =
      tasksInColumn.length === 0 ? 0 : Math.max(...tasksInColumn.map((t) => t.position)) + 1;

    const taskId = await ctx.db.insert('kanbanTasks', {
      nodeId: args.nodeId,
      title: trimmed,
      description: args.description?.trim() || undefined,
      status: args.status,
      position: nextPosition,
    });

    return { taskId };
  },
});
```

- [ ] **Step 4: Add the HTTP route**

Import `addKanbanTaskInput`:

```ts
import {
  addKanbanTaskInput,
  createNodeInput,
  deleteNodeInput,
  getNodeInput,
  linkFilesInput,
  updateNodeInput,
} from '@arch-viz/shared';
```

```ts
http.route({
  path: '/api/mcp/kanban/add',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) return errorResponse(401, 'unauthorized', 'Missing or invalid API token.');

    const raw = await req.json().catch(() => ({}));
    const parsed = addKanbanTaskInput.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'invalid');
    }

    try {
      const result = await ctx.runMutation(internal.mcp.kanban.addTask, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        nodeId: parsed.data.nodeId as Id<'nodes'>,
        title: parsed.data.title,
        description: parsed.data.description,
        status: parsed.data.status,
      });
      return jsonResponse(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Forbidden') || msg.includes('not in token scope'))
        return errorResponse(403, 'forbidden', msg);
      if (msg.includes('Not found')) return errorResponse(404, 'not_found', msg);
      return errorResponse(400, 'invalid_input', msg);
    }
  }),
});
```

- [ ] **Step 5: Run tests (expect pass)**

Run: `pnpm vitest run convex/http.test.ts -t "kanban/add"`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add convex/mcp/kanban.ts convex/http.ts convex/http.test.ts
git commit -m "feat(convex): add /api/mcp/kanban/add endpoint"
```

---

### Task 14: `/api/mcp/kanban/status`

**Files:**

- Modify: `convex/mcp/kanban.ts`
- Modify: `convex/http.ts`
- Modify: `convex/http.test.ts`

- [ ] **Step 1: Append test cases**

```ts
// Append to convex/http.test.ts
describe('POST /api/mcp/kanban/status', () => {
  test('200 moves task across columns and re-positions', async () => {
    const t = convexTest(schema, modules);
    const { asUser, projectId, rawToken } = await seedTokenForUser(t);
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });
    const taskId = await asUser.mutation(api.kanban.create, {
      nodeId,
      title: 'T',
      status: 'todo',
    });

    const res = await t.fetch('/api/mcp/kanban/status', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ taskId, status: 'done' }),
    });
    expect(res.status).toBe(200);

    const tasks = await asUser.query(api.kanban.listByNode, { nodeId });
    expect(tasks[0]!.status).toEqual('done');
  });

  test('404 for unknown taskId', async () => {
    const t = convexTest(schema, modules);
    const { rawToken } = await seedTokenForUser(t);
    const res = await t.fetch('/api/mcp/kanban/status', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: 'kanbanTasks:nope', status: 'done' }),
    });
    expect([400, 404]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `pnpm vitest run convex/http.test.ts -t "kanban/status"`
Expected: FAIL.

- [ ] **Step 3: Add the internal mutation**

Append to `convex/mcp/kanban.ts`:

```ts
export const updateStatus = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    taskId: v.id('kanbanTasks'),
    status: statusValidator,
  },
  handler: async (ctx, { userId, scopeProjectId, taskId, status }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error('Not found: task');
    const node = await requireNodeOwnership(ctx, userId, task.nodeId);
    if (node.projectId !== scopeProjectId) {
      throw new ForbiddenError('Task not in token scope');
    }

    if (task.status === status) return; // no-op

    const tasksInNewCol = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_node_status', (q) => q.eq('nodeId', task.nodeId).eq('status', status))
      .collect();
    const nextPosition =
      tasksInNewCol.length === 0 ? 0 : Math.max(...tasksInNewCol.map((t) => t.position)) + 1;

    await ctx.db.patch(taskId, { status, position: nextPosition });
  },
});
```

- [ ] **Step 4: Add the HTTP route**

Import `updateKanbanStatusInput`:

```ts
import {
  addKanbanTaskInput,
  createNodeInput,
  deleteNodeInput,
  getNodeInput,
  linkFilesInput,
  updateKanbanStatusInput,
  updateNodeInput,
} from '@arch-viz/shared';
```

```ts
http.route({
  path: '/api/mcp/kanban/status',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) return errorResponse(401, 'unauthorized', 'Missing or invalid API token.');

    const raw = await req.json().catch(() => ({}));
    const parsed = updateKanbanStatusInput.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'invalid');
    }

    try {
      await ctx.runMutation(internal.mcp.kanban.updateStatus, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        taskId: parsed.data.taskId as Id<'kanbanTasks'>,
        status: parsed.data.status,
      });
      return jsonResponse({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Forbidden') || msg.includes('not in token scope'))
        return errorResponse(403, 'forbidden', msg);
      if (msg.includes('Not found') || msg.includes('not found'))
        return errorResponse(404, 'not_found', msg);
      return errorResponse(400, 'invalid_input', msg);
    }
  }),
});
```

- [ ] **Step 5: Run tests (expect pass)**

Run: `pnpm vitest run convex/http.test.ts -t "kanban/status"`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add convex/mcp/kanban.ts convex/http.ts convex/http.test.ts
git commit -m "feat(convex): add /api/mcp/kanban/status endpoint"
```

---

### Task 15: `/api/mcp/activity/log`

**Files:**

- Create: `convex/mcp/activity.ts`
- Modify: `convex/http.ts`
- Modify: `convex/http.test.ts`

- [ ] **Step 1: Append test cases**

```ts
// Append to convex/http.test.ts
describe('POST /api/mcp/activity/log', () => {
  test('200 records an activity entry', async () => {
    const t = convexTest(schema, modules);
    const { projectId, rawToken } = await seedTokenForUser(t);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const nodeId = await asUser.mutation(api.nodes.create, {
      projectId,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/activity/log', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        actor: 'mcp:claude-code',
        message: 'Implemented form',
        metadata: { commit: 'abc123' },
      }),
    });
    expect(res.status).toBe(200);

    const entries = await t.run(async (ctx) =>
      ctx.db.query('activityLog').collect(),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actor).toEqual('mcp:claude-code');
    expect(entries[0]!.message).toEqual('Implemented form');
  });

  test('403 for node outside token scope', async () => {
    const t = convexTest(schema, modules);
    const { asUser, rawToken } = await seedTokenForUser(t);
    const other = await asUser.mutation(api.projects.create, { name: 'Other' });
    const foreign = await asUser.mutation(api.nodes.create, {
      projectId: other,
      type: 'page',
      name: 'X',
      positionX: 0,
      positionY: 0,
    });

    const res = await t.fetch('/api/mcp/activity/log', {
      method: 'POST',
      headers: { 'x-api-key': rawToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeId: foreign,
        actor: 'mcp:claude-code',
        message: 'should fail',
      }),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `pnpm vitest run convex/http.test.ts -t "activity/log"`
Expected: FAIL.

- [ ] **Step 3: Create internal activity handler**

```ts
// convex/mcp/activity.ts
import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { ForbiddenError, requireNodeOwnership } from './lib';

export const log = internalMutation({
  args: {
    userId: v.id('profiles'),
    scopeProjectId: v.id('projects'),
    nodeId: v.id('nodes'),
    actor: v.string(),
    message: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const node = await requireNodeOwnership(ctx, args.userId, args.nodeId);
    if (node.projectId !== args.scopeProjectId) {
      throw new ForbiddenError('Node not in token scope');
    }
    await ctx.db.insert('activityLog', {
      nodeId: args.nodeId,
      actor: args.actor.trim(),
      message: args.message.trim(),
      metadata: args.metadata,
    });
  },
});
```

- [ ] **Step 4: Add the HTTP route**

Import `logActivityInput`:

```ts
import {
  addKanbanTaskInput,
  createNodeInput,
  deleteNodeInput,
  getNodeInput,
  linkFilesInput,
  logActivityInput,
  updateKanbanStatusInput,
  updateNodeInput,
} from '@arch-viz/shared';
```

```ts
http.route({
  path: '/api/mcp/activity/log',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) return errorResponse(401, 'unauthorized', 'Missing or invalid API token.');

    const raw = await req.json().catch(() => ({}));
    const parsed = logActivityInput.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'invalid');
    }

    try {
      await ctx.runMutation(internal.mcp.activity.log, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        nodeId: parsed.data.nodeId as Id<'nodes'>,
        actor: parsed.data.actor,
        message: parsed.data.message,
        metadata: parsed.data.metadata,
      });
      return jsonResponse({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Forbidden') || msg.includes('not in token scope'))
        return errorResponse(403, 'forbidden', msg);
      if (msg.includes('Not found')) return errorResponse(404, 'not_found', msg);
      return errorResponse(400, 'invalid_input', msg);
    }
  }),
});
```

- [ ] **Step 5: Run tests (expect pass)**

Run: `pnpm vitest run convex/http.test.ts -t "activity/log"`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add convex/mcp/activity.ts convex/http.ts convex/http.test.ts
git commit -m "feat(convex): add /api/mcp/activity/log endpoint"
```

---

### Task 16: Full test sweep + lint + typecheck + curl smoke test

**Files:** none — verification only.

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: PASS — all existing + ~20 new HTTP tests green.

- [ ] **Step 2: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS, no warnings.

- [ ] **Step 3: Push schema + functions to Convex dev**

Run: `pnpm exec convex dev --once`
Expected: succeeds; deployment now serves all `/api/mcp/*` routes.

- [ ] **Step 4: Get a token + Convex URL for live smoke test**

In browser at `http://localhost:3000`:

1. Sign in.
2. Go to `/settings/tokens`. Pick a project, create a token named "curl smoke", copy the raw value.
3. Get the Convex deployment URL (usually printed by `convex dev`, like `https://dazzling-seahorse-444.convex.cloud`).

Export to shell (PowerShell):

```powershell
$env:URL = "https://dazzling-seahorse-444.convex.cloud"
$env:TOKEN = "archv_<paste-token-here>"
```

- [ ] **Step 5: curl `/api/mcp/health`**

```powershell
curl.exe -s -X POST "$env:URL/api/mcp/health" -H "x-api-key: $env:TOKEN"
```

Expected: JSON `{"projectId":"…","projectName":"…","tokenName":"curl smoke"}`.

- [ ] **Step 6: curl `/api/mcp/nodes/create`**

```powershell
curl.exe -s -X POST "$env:URL/api/mcp/nodes/create" `
  -H "x-api-key: $env:TOKEN" -H "content-type: application/json" `
  -d '{"type":"page","name":"From curl"}'
```

Expected: JSON `{"nodeId":"…","name":"From curl"}`. The new node appears on the canvas in browser within a second (Convex live sync).

- [ ] **Step 7: curl `/api/mcp/nodes/list`**

```powershell
curl.exe -s -X POST "$env:URL/api/mcp/nodes/list" `
  -H "x-api-key: $env:TOKEN" -H "content-type: application/json" -d '{}'
```

Expected: JSON `{"nodes":[…]}` containing the node just created.

- [ ] **Step 8: curl auth failure (no header)**

```powershell
curl.exe -s -X POST "$env:URL/api/mcp/health"
```

Expected: JSON `{"error":{"code":"unauthorized","message":"…"}}` with HTTP 401. (Add `-i` to confirm status.)

If any step fails, stop and ask for help before continuing.

---

### Task 17: Wrap up the development branch

- [ ] **Step 1: Use the finishing-a-development-branch skill**

Announce: "I'm using the finishing-a-development-branch skill to complete this work."

Then invoke `superpowers:finishing-a-development-branch` and follow it. Expected outcome: merge `phase-2a-mcp-http` → `main` fast-forward, annotated tag `phase-2a` with message "Phase 2A: MCP HTTP actions (9 endpoints + activityLog cascade)", push tag + main, update memory file `C:\Users\king\.claude\projects\c--Data-Tools-architecture-visualization\memory\project_architecture_visualization.md` to mark Phase 2A done.
