# Phase 1D — API Tokens for MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add API token issuing/revoking so the Phase 2 MCP server can authenticate to Convex on behalf of a user, scoped to one project.

**Architecture:** A new `apiTokens` Convex table stores SHA-256 hashes of long-lived bearer tokens (raw value shown once on creation). A `/settings/tokens` page lets the user create / list / revoke tokens. An internal `verifyApiToken` helper looks up by hash for Phase 2 HTTP actions to call. We use SHA-256 (Web Crypto, V8-compatible) instead of the spec's bcrypt because tokens carry 256 bits of random entropy — bcrypt's slow-hash protection is for low-entropy passwords, not random tokens, and bcrypt would force a Node-runtime action.

**Tech Stack:** Convex (`apiTokens` table + queries/mutations + internal helper), Web Crypto API (`crypto.getRandomValues` + `crypto.subtle.digest`), Next.js App Router (`/settings/tokens`), shadcn/ui (Dialog, Select, Button), React Hook Form + Zod, `convex-test` + Vitest.

---

## File Structure

**New files:**

- `convex/lib/tokens.ts` — pure helpers: `generateRawToken()`, `hashToken(raw)` (Web Crypto, no I/O)
- `convex/apiTokens.ts` — public queries/mutations: `list`, `create`, `revoke`; internal: `verifyToken`
- `convex/apiTokens.test.ts` — convex-test coverage
- `packages/shared/src/tokens.ts` — Zod `tokenNameSchema`
- `apps/web/app/settings/tokens/page.tsx` — list + nav header
- `apps/web/components/tokens/create-token-dialog.tsx` — create form (project select + name input)
- `apps/web/components/tokens/token-reveal-dialog.tsx` — one-time plaintext display + copy
- `apps/web/components/tokens/revoke-token-dialog.tsx` — confirm dialog
- `apps/web/components/ui/select.tsx` — shadcn Select (added because no existing select component)

**Modified files:**

- `convex/schema.ts` — add `apiTokens` table with `by_user`, `by_hash` indexes
- `packages/shared/src/index.ts` — re-export from `./tokens`
- `apps/web/app/projects/page.tsx` — add "Settings" link next to UserButton

---

## Important Conventions (from previous phases)

- Queries are **lenient** (return `[]` / `null` on unauthorized) so stale URLs don't crash the React tree
- Mutations are **strict** (throw `UnauthorizedError` via `requireProjectAccess`)
- Unauthorized errors **must contain the literal word "Unauthorized"** so test regexes match
- shadcn/ui uses `@base-ui/react` (NOT Radix) — `<DialogTrigger asChild>` does **not** exist; use `<DialogTrigger render={<Button>...</Button>} />`
- Convex queries return `null` to clients when unauthenticated — the React UI then re-renders gracefully
- Import path from `apps/web/app/<route>/page.tsx` to `convex/_generated/*` is **`../../../../convex/_generated/*`** (4 dots)
- Convex's tsc doesn't know Vite's `import.meta.glob` — keep `convex/tsconfig.json` excluding `*.test.ts`
- Always use **idempotent** mutation logic for delete/cascade paths (`if (!doc) return;`)

---

### Task 1: Add `apiTokens` table to schema

**Files:**

- Modify: `convex/schema.ts`

- [ ] **Step 1: Add `apiTokens` table definition**

In `convex/schema.ts`, add this table after `kanbanTasks` (before the closing `})` of `defineSchema`):

```ts
apiTokens: defineTable({
  userId: v.id('profiles'),
  projectId: v.id('projects'),
  name: v.string(),
  tokenHash: v.string(),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
})
  .index('by_user', ['userId'])
  .index('by_project', ['projectId'])
  .index('by_hash', ['tokenHash']),
```

- [ ] **Step 2: Push schema to Convex dev to verify it accepts the new table**

Run: `pnpm exec convex dev --once`
Expected: succeeds with no schema errors; `convex/_generated/dataModel.d.ts` regenerated to include `apiTokens`.

- [ ] **Step 3: Verify typecheck still passes**

Run: `pnpm typecheck`
Expected: PASS, no errors.

- [ ] **Step 4: Commit**

```bash
git checkout -b phase-1d-api-tokens
git add convex/schema.ts convex/_generated
git commit -m "feat(convex): add apiTokens table with by_user/by_project/by_hash indexes"
```

---

### Task 2: Add Zod schema for token name (shared package)

**Files:**

- Create: `packages/shared/src/tokens.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/tokens.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { tokenNameSchema } from './tokens';

describe('tokenNameSchema', () => {
  test('accepts a normal label', () => {
    expect(tokenNameSchema.parse('Claude Code laptop')).toBe('Claude Code laptop');
  });

  test('trims surrounding whitespace', () => {
    expect(tokenNameSchema.parse('  laptop  ')).toBe('laptop');
  });

  test('rejects empty', () => {
    expect(() => tokenNameSchema.parse('   ')).toThrow(/Token name is required/);
  });

  test('rejects names longer than 80 chars', () => {
    expect(() => tokenNameSchema.parse('a'.repeat(81))).toThrow(/80 characters/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/src/tokens.test.ts`
Expected: FAIL with "Cannot find module './tokens'".

- [ ] **Step 3: Create `packages/shared/src/tokens.ts`**

```ts
import { z } from 'zod';

export const tokenNameSchema = z
  .string()
  .trim()
  .min(1, 'Token name is required')
  .max(80, 'Token name must be 80 characters or fewer');

export type TokenName = z.infer<typeof tokenNameSchema>;
```

- [ ] **Step 4: Re-export from `packages/shared/src/index.ts`**

Add this line after the existing `export * from './kanban';`:

```ts
export * from './tokens';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/shared/src/tokens.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/tokens.ts packages/shared/src/tokens.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add tokenNameSchema for API token labels"
```

---

### Task 3: Add token generation and hashing helpers

**Files:**

- Create: `convex/lib/tokens.ts`
- Create: `convex/lib/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// convex/lib/tokens.test.ts
import { describe, expect, test } from 'vitest';
import { generateRawToken, hashToken, TOKEN_PREFIX } from './tokens';

describe('generateRawToken', () => {
  test('returns a string starting with the archv_ prefix', () => {
    const tok = generateRawToken();
    expect(tok.startsWith(TOKEN_PREFIX)).toBe(true);
  });

  test('produces unique values across calls', () => {
    const tokens = new Set();
    for (let i = 0; i < 100; i++) tokens.add(generateRawToken());
    expect(tokens.size).toBe(100);
  });

  test('payload is base64url and at least 40 chars', () => {
    const tok = generateRawToken();
    const payload = tok.slice(TOKEN_PREFIX.length);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload.length).toBeGreaterThanOrEqual(40);
  });
});

describe('hashToken', () => {
  test('returns a deterministic 64-char hex string', async () => {
    const a = await hashToken('archv_abc');
    const b = await hashToken('archv_abc');
    expect(a).toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('different inputs produce different hashes', async () => {
    const a = await hashToken('archv_a');
    const b = await hashToken('archv_b');
    expect(a).not.toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run convex/lib/tokens.test.ts`
Expected: FAIL with "Cannot find module './tokens'".

- [ ] **Step 3: Create `convex/lib/tokens.ts`**

```ts
/**
 * Pure token helpers. Runs in Convex V8 runtime (no Node APIs).
 *
 * Token format: `archv_<43chars-base64url>` — 32 random bytes encoded
 * base64url (unpadded). 256 bits of entropy, identifiable prefix for
 * secret-scanning tooling.
 *
 * Why SHA-256 instead of bcrypt: tokens are random 32-byte secrets,
 * not low-entropy passwords. bcrypt's slow-hash protects against brute
 * force on guessable inputs; brute-forcing a 256-bit random value is
 * infeasible regardless of hash speed. SHA-256 lets us hash inside the
 * V8 query/mutation runtime without spawning a Node action per call.
 */

export const TOKEN_PREFIX = 'archv_';

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export function generateRawToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return TOKEN_PREFIX + bytesToBase64Url(buf);
}

export async function hashToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run convex/lib/tokens.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/tokens.ts convex/lib/tokens.test.ts
git commit -m "feat(convex): add token generation and SHA-256 hashing helpers"
```

---

### Task 4: Implement `apiTokens.list` query

**Files:**

- Create: `convex/apiTokens.ts`
- Create: `convex/apiTokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// convex/apiTokens.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run convex/apiTokens.test.ts`
Expected: FAIL with "Cannot find module './apiTokens'" or `api.apiTokens` undefined.

- [ ] **Step 3: Create `convex/apiTokens.ts` with the `list` query**

```ts
import { v } from 'convex/values';
import { mutation, query, internalMutation } from './_generated/server';
import { getProfile, requireProjectAccess } from './lib/auth';
import { generateRawToken, hashToken } from './lib/tokens';
import { tokenNameSchema } from '@arch-viz/shared';

export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getProfile(ctx);
    if (!profile) return [];
    const tokens = await ctx.db
      .query('apiTokens')
      .withIndex('by_user', (q) => q.eq('userId', profile._id))
      .order('desc')
      .collect();
    // Join project name so the UI can show "<token name> · <project name>".
    return Promise.all(
      tokens.map(async (t) => {
        const project = await ctx.db.get(t.projectId);
        return {
          _id: t._id,
          _creationTime: t._creationTime,
          name: t.name,
          projectId: t.projectId,
          projectName: project?.name ?? '(deleted project)',
          lastUsedAt: t.lastUsedAt,
          revokedAt: t.revokedAt,
        };
      }),
    );
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run convex/apiTokens.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add convex/apiTokens.ts convex/apiTokens.test.ts
git commit -m "feat(convex): add apiTokens.list query"
```

---

### Task 5: Implement `apiTokens.create` mutation

**Files:**

- Modify: `convex/apiTokens.ts`
- Modify: `convex/apiTokens.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `convex/apiTokens.test.ts`:

```ts
import { TOKEN_PREFIX } from './lib/tokens';

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
    // Need a project id from somewhere — create with one user, attempt with none.
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run convex/apiTokens.test.ts`
Expected: FAIL — `api.apiTokens.create is undefined`.

- [ ] **Step 3: Add the `create` mutation to `convex/apiTokens.ts`**

Append to the file (after `list`):

```ts
export const create = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
  },
  handler: async (ctx, { projectId, name }) => {
    const parsedName = tokenNameSchema.parse(name);
    const project = await requireProjectAccess(ctx, projectId);

    const rawToken = generateRawToken();
    const tokenHash = await hashToken(rawToken);

    const tokenId = await ctx.db.insert('apiTokens', {
      userId: project.userId,
      projectId,
      name: parsedName,
      tokenHash,
    });

    return { tokenId, rawToken };
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run convex/apiTokens.test.ts`
Expected: PASS, 6 tests total.

- [ ] **Step 5: Commit**

```bash
git add convex/apiTokens.ts convex/apiTokens.test.ts
git commit -m "feat(convex): add apiTokens.create mutation"
```

---

### Task 6: Implement `apiTokens.revoke` mutation

**Files:**

- Modify: `convex/apiTokens.ts`
- Modify: `convex/apiTokens.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `convex/apiTokens.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run convex/apiTokens.test.ts`
Expected: FAIL — `api.apiTokens.revoke is undefined`.

- [ ] **Step 3: Add the `revoke` mutation**

Append to `convex/apiTokens.ts`:

```ts
import { UnauthorizedError } from './lib/auth';

export const revoke = mutation({
  args: { id: v.id('apiTokens') },
  handler: async (ctx, { id }) => {
    const token = await ctx.db.get(id);
    if (!token) return; // idempotent — already gone

    const profile = await getProfile(ctx);
    if (!profile || token.userId !== profile._id) {
      throw new UnauthorizedError('Unauthorized: you do not own this token');
    }

    if (token.revokedAt) return; // already revoked — idempotent
    await ctx.db.patch(id, { revokedAt: Date.now() });
  },
});
```

Note: place the `import { UnauthorizedError } from './lib/auth';` together with the existing auth imports at the top of the file (don't duplicate the import line).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run convex/apiTokens.test.ts`
Expected: PASS, 9 tests total.

- [ ] **Step 5: Commit**

```bash
git add convex/apiTokens.ts convex/apiTokens.test.ts
git commit -m "feat(convex): add idempotent apiTokens.revoke mutation"
```

---

### Task 7: Cascade-revoke tokens on project delete

**Files:**

- Modify: `convex/projects.ts`
- Modify: `convex/apiTokens.test.ts`

When a project is deleted, its tokens become orphaned. We hard-delete them so they cannot be reused even if the hash were leaked.

- [ ] **Step 1: Write the failing test**

Append to `convex/apiTokens.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run convex/apiTokens.test.ts -t cascade`
Expected: FAIL — list still returns the token with `projectName: '(deleted project)'`.

- [ ] **Step 3: Add token deletion to `projects.remove`**

In `convex/projects.ts`, inside the `remove` mutation, **before** the `await ctx.db.delete(id)` line at the end, insert:

```ts
const tokens = await ctx.db
  .query('apiTokens')
  .withIndex('by_project', (q) => q.eq('projectId', id))
  .collect();
for (const tok of tokens) {
  await ctx.db.delete(tok._id);
}
```

The final `remove` handler should read (entire updated function, replace existing):

```ts
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

    const tokens = await ctx.db
      .query('apiTokens')
      .withIndex('by_project', (q) => q.eq('projectId', id))
      .collect();
    for (const tok of tokens) {
      await ctx.db.delete(tok._id);
    }

    await ctx.db.delete(id);
  },
});
```

- [ ] **Step 4: Run all Convex tests**

Run: `pnpm vitest run convex/`
Expected: PASS — all tests including the new cascade test.

- [ ] **Step 5: Commit**

```bash
git add convex/projects.ts convex/apiTokens.test.ts
git commit -m "feat(convex): cascade-delete apiTokens when project is removed"
```

---

### Task 8: Implement internal `verifyToken` helper for Phase 2

**Files:**

- Modify: `convex/apiTokens.ts`
- Modify: `convex/apiTokens.test.ts`

This is the entry point Phase 2's HTTP actions will call to validate `x-api-key` headers. It is `internalMutation` (not `internalQuery`) because it patches `lastUsedAt`.

- [ ] **Step 1: Write the failing test**

Append to `convex/apiTokens.test.ts`:

```ts
import { internal } from './_generated/api';

describe('apiTokens.verifyToken (internal)', () => {
  test('returns userId + projectId for a valid token, updates lastUsedAt', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const { rawToken } = await asUser.mutation(api.apiTokens.create, {
      projectId,
      name: 'laptop',
    });

    const before = Date.now();
    const result = await t.mutation(internal.apiTokens.verifyToken, { rawToken });

    expect(result).not.toBeNull();
    expect(result?.projectId).toEqual(projectId);

    const list = await asUser.query(api.apiTokens.list);
    expect(list[0]?.lastUsedAt).toBeGreaterThanOrEqual(before);
  });

  test('returns null for an unknown token', async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(internal.apiTokens.verifyToken, {
      rawToken: 'archv_doesnotexist',
    });
    expect(result).toBeNull();
  });

  test('returns null for a revoked token', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(fakeIdentity('user_a', 'a@example.com'));
    const projectId = await asUser.mutation(api.projects.create, { name: 'P' });
    const { rawToken, tokenId } = await asUser.mutation(api.apiTokens.create, {
      projectId,
      name: 'laptop',
    });
    await asUser.mutation(api.apiTokens.revoke, { id: tokenId });

    const result = await t.mutation(internal.apiTokens.verifyToken, { rawToken });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run convex/apiTokens.test.ts -t verifyToken`
Expected: FAIL — `internal.apiTokens.verifyToken` undefined.

- [ ] **Step 3: Add the `verifyToken` internal mutation**

Append to `convex/apiTokens.ts`:

```ts
export const verifyToken = internalMutation({
  args: { rawToken: v.string() },
  handler: async (ctx, { rawToken }) => {
    const tokenHash = await hashToken(rawToken);
    const token = await ctx.db
      .query('apiTokens')
      .withIndex('by_hash', (q) => q.eq('tokenHash', tokenHash))
      .unique();
    if (!token) return null;
    if (token.revokedAt) return null;

    await ctx.db.patch(token._id, { lastUsedAt: Date.now() });
    return {
      userId: token.userId,
      projectId: token.projectId,
      tokenId: token._id,
    };
  },
});
```

- [ ] **Step 4: Run all Convex tests**

Run: `pnpm vitest run convex/`
Expected: PASS — all tests including 3 new verifyToken tests.

- [ ] **Step 5: Commit**

```bash
git add convex/apiTokens.ts convex/apiTokens.test.ts
git commit -m "feat(convex): add internal verifyToken mutation for Phase 2 MCP auth"
```

---

### Task 9: Add shadcn `Select` component

**Files:**

- Create: `apps/web/components/ui/select.tsx`

The create-token dialog needs a Select to choose the project. shadcn's `select` uses Base UI's `Select` primitive.

- [ ] **Step 1: Generate the component via shadcn CLI**

Run: `pnpm --filter @arch-viz/web exec shadcn@latest add select --yes`
Expected: file created at `apps/web/components/ui/select.tsx`. If prompted about overwrites, accept defaults.

- [ ] **Step 2: Verify the component compiles**

Run: `pnpm --filter @arch-viz/web typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/select.tsx
git commit -m "feat(web): add shadcn Select component"
```

---

### Task 10: Build create-token dialog component

**Files:**

- Create: `apps/web/components/tokens/create-token-dialog.tsx`

This dialog has: project select, name input, submit → calls `api.apiTokens.create` → forwards the returned `rawToken` to the parent (which opens a reveal dialog).

- [ ] **Step 1: Create the component**

```tsx
// apps/web/components/tokens/create-token-dialog.tsx
'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from 'convex/react';

import { tokenNameSchema } from '@arch-viz/shared';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const formSchema = z.object({
  projectId: z.string().min(1, 'Pick a project'),
  name: tokenNameSchema,
});
type FormValues = z.infer<typeof formSchema>;

interface Props {
  onCreated: (rawToken: string, name: string) => void;
}

export function CreateTokenDialog({ onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const projects = useQuery(api.projects.list);
  const create = useMutation(api.apiTokens.create);
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { projectId: '', name: '' },
  });

  const onSubmit = async (values: FormValues) => {
    const { rawToken } = await create({
      projectId: values.projectId as Id<'projects'>,
      name: values.name,
    });
    onCreated(rawToken, values.name);
    reset();
    setOpen(false);
  };

  const disabled = !projects || projects.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button disabled={disabled}>New token</Button>} />
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create an API token</DialogTitle>
            <DialogDescription>
              The token grants write access to the selected project for MCP clients. You will only
              see the raw value once.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="project">Project</Label>
            <Controller
              control={control}
              name="projectId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="project">
                    <SelectValue placeholder="Pick a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {(projects ?? []).map((p) => (
                      <SelectItem key={p._id} value={p._id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.projectId && (
              <p className="text-sm text-destructive">{errors.projectId.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Token name</Label>
            <Input id="name" placeholder="e.g. Claude Code laptop" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @arch-viz/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/tokens/create-token-dialog.tsx
git commit -m "feat(web): add create-token dialog with project selector"
```

---

### Task 11: Build token-reveal dialog component

**Files:**

- Create: `apps/web/components/tokens/token-reveal-dialog.tsx`

After creation, parent opens this dialog with the raw token. User copies it; closing dismisses it forever.

- [ ] **Step 1: Create the component**

```tsx
// apps/web/components/tokens/token-reveal-dialog.tsx
'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rawToken: string;
  tokenName: string;
}

export function TokenRevealDialog({ open, onOpenChange, rawToken, tokenName }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(rawToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy your token now</DialogTitle>
          <DialogDescription>
            This is the only time the raw value for <span className="font-medium">{tokenName}</span>{' '}
            will be shown. Store it in your MCP client config now — if you lose it you must revoke
            and create a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {rawToken}
          </code>
          <Button type="button" size="icon" variant="outline" onClick={copy} aria-label="Copy">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            I've stored it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @arch-viz/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/tokens/token-reveal-dialog.tsx
git commit -m "feat(web): add one-time token reveal dialog with copy-to-clipboard"
```

---

### Task 12: Build revoke-token dialog component

**Files:**

- Create: `apps/web/components/tokens/revoke-token-dialog.tsx`

Confirmation dialog before revoking (since this is destructive — any running MCP client using this token will start failing).

- [ ] **Step 1: Create the component**

```tsx
// apps/web/components/tokens/revoke-token-dialog.tsx
'use client';

import { useMutation } from 'convex/react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props {
  tokenId: Id<'apiTokens'>;
  tokenName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RevokeTokenDialog({ tokenId, tokenName, open, onOpenChange }: Props) {
  const revoke = useMutation(api.apiTokens.revoke);

  const onConfirm = async () => {
    await revoke({ id: tokenId });
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke "{tokenName}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Any MCP client using this token will stop working immediately. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Revoke
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @arch-viz/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/tokens/revoke-token-dialog.tsx
git commit -m "feat(web): add revoke-token confirmation dialog"
```

---

### Task 13: Build `/settings/tokens` page

**Files:**

- Create: `apps/web/app/settings/tokens/page.tsx`

Lists all tokens with status, hosts the create dialog, hosts the reveal dialog (parent state), hosts the revoke dialog (parent state).

- [ ] **Step 1: Create the page**

```tsx
// apps/web/app/settings/tokens/page.tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from 'convex/react';
import { UserButton } from '@clerk/nextjs';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CreateTokenDialog } from '@/components/tokens/create-token-dialog';
import { TokenRevealDialog } from '@/components/tokens/token-reveal-dialog';
import { RevokeTokenDialog } from '@/components/tokens/revoke-token-dialog';

export default function TokensPage() {
  const tokens = useQuery(api.apiTokens.list);
  const [reveal, setReveal] = useState<{ rawToken: string; name: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{
    id: Id<'apiTokens'>;
    name: string;
  } | null>(null);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="absolute right-4 top-4">
        <UserButton />
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">API tokens</h1>
          <p className="text-sm text-muted-foreground">
            Used by MCP clients (Claude Code, Codex, Cursor) to update the canvas.{' '}
            <Link href="/projects" className="underline">
              Back to projects
            </Link>
          </p>
        </div>
        <CreateTokenDialog
          onCreated={(rawToken, name) => setReveal({ rawToken, name })}
        />
      </div>

      {tokens === undefined && <p className="text-muted-foreground">Loading…</p>}
      {tokens && tokens.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No tokens yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Create a project first, then issue a token to let an MCP client write to its canvas.
            </p>
          </CardContent>
        </Card>
      )}
      {tokens && tokens.length > 0 && (
        <ul className="space-y-2">
          {tokens.map((t) => (
            <li
              key={t._id}
              className="flex items-center justify-between rounded-md border p-4"
            >
              <div className="space-y-1">
                <div className="font-medium">
                  {t.name}
                  {t.revokedAt && (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                      revoked
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Project: {t.projectName} · Last used:{' '}
                  {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'never'}
                </div>
              </div>
              {!t.revokedAt && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRevokeTarget({ id: t._id, name: t.name })}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {reveal && (
        <TokenRevealDialog
          open
          onOpenChange={(open) => !open && setReveal(null)}
          rawToken={reveal.rawToken}
          tokenName={reveal.name}
        />
      )}
      {revokeTarget && (
        <RevokeTokenDialog
          open
          onOpenChange={(open) => !open && setRevokeTarget(null)}
          tokenId={revokeTarget.id}
          tokenName={revokeTarget.name}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @arch-viz/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/settings/tokens/page.tsx
git commit -m "feat(web): add /settings/tokens page with create/list/revoke flow"
```

---

### Task 14: Add Settings link on the projects page

**Files:**

- Modify: `apps/web/app/projects/page.tsx`

- [ ] **Step 1: Add the Link import and the nav link**

In `apps/web/app/projects/page.tsx`, replace the top of the JSX (the absolute-positioned UserButton block + the header) with this:

Find:

```tsx
      <div className="absolute right-4 top-4">
        <UserButton />
      </div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <CreateProjectDialog />
      </div>
```

Replace with:

```tsx
      <div className="absolute right-4 top-4 flex items-center gap-3">
        <Link href="/settings/tokens" className="text-sm underline">
          Settings
        </Link>
        <UserButton />
      </div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <CreateProjectDialog />
      </div>
```

(`Link` is already imported at the top of the file — no new import needed.)

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @arch-viz/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/projects/page.tsx
git commit -m "feat(web): link to /settings/tokens from projects page header"
```

---

### Task 15: Run all checks and smoke test

**Files:** none

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS — all existing + new tests green.

- [ ] **Step 2: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS, no errors and no warnings.

- [ ] **Step 3: Push Convex schema to dev deployment**

Run: `pnpm exec convex dev --once`
Expected: succeeds; `_generated` is up to date.

- [ ] **Step 4: Start the web dev server and smoke test manually**

Run (in a separate terminal): `pnpm dev`

Then in browser at `http://localhost:3000`:

1. Sign in.
2. Click "Settings" in the top-right of the projects page → land on `/settings/tokens` → empty state shown.
3. If no project exists, the "New token" button is disabled — go back, create a project, return.
4. Click "New token" → pick project, type a name like "Claude Code laptop", submit.
5. Reveal dialog appears with `archv_…` token. Click the copy button → check icon flips to ✓ for ~2s.
6. Close the reveal dialog. The token row appears in the list with "Last used: never" and a Revoke button.
7. Open a second browser tab on `/settings/tokens` — token appears live (Convex reactive sync).
8. Click Revoke → confirmation dialog → confirm. The row gains a "revoked" badge in both tabs; Revoke button disappears.
9. Go back to projects → delete the project. Return to `/settings/tokens` → the revoked token is gone (cascade-delete worked).

If any step fails, stop and ask for help before continuing.

- [ ] **Step 5: Final commit only if any small fixups were needed**

```bash
git status  # confirm clean working tree
# if any fixups were made:
git add <files>
git commit -m "chore(phase-1d): fix issues found in smoke test"
```

---

### Task 16: Wrap up the development branch

- [ ] **Step 1: Use the finishing-a-development-branch skill**

Announce: "I'm using the finishing-a-development-branch skill to complete this work."

Then invoke `superpowers:finishing-a-development-branch` and follow it. Expected outcome: merge `phase-1d-api-tokens` → `main` fast-forward, annotated tag `phase-1d` with message "Phase 1D: API tokens (create/list/revoke + internal verify for MCP)", push tag + main, update memory file `C:\Users\king\.claude\projects\c--Data-Tools-architecture-visualization\memory\project_architecture_visualization.md` to mark Phase 1D done.
