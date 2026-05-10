# Architecture Visualization — Phase 1A (Projects + Canvas Foundation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `projects` table and CRUD functions to Convex, build a `/projects` page (list + create + rename + delete), and a `/canvas/[projectId]` page that embeds an empty tldraw canvas. After this plan, a signed-in user can manage their projects and open each one onto a blank canvas — no node persistence yet.

**Architecture:** Project data lives in Convex with row-level authorization enforced inside every query/mutation against the Clerk identity. The web UI uses Convex's reactive `useQuery` hooks so that creating/renaming/deleting a project in one tab updates other tabs automatically. The canvas page embeds tldraw with a stable `persistenceKey` keyed off `projectId` so each project gets its own local tldraw store; node persistence to Convex comes in Phase 1B.

**Tech Stack:** Convex (schema + queries/mutations), Clerk (auth identity), Next.js App Router, React Hook Form + Zod, shadcn/ui (Dialog, Input, Label, DropdownMenu, AlertDialog), tldraw, Vitest + `convex-test`, Playwright.

**Prerequisites:**

- Phase 0 done (tag `phase-0` on `main`).
- Working `pnpm dev` + `pnpm dlx convex dev` setup.
- Signed-in Clerk user with valid Convex JWT integration.

**Out of scope for this plan (deferred to 1B/1C/1D):**

- Custom tldraw shapes for page/feature nodes.
- Node CRUD in Convex.
- Node modal (description, linked files, kanban).
- API token generation page.
- Activity log UI.

---

## File Structure

After this plan, the new and modified files are:

```
convex/
├── schema.ts                     # Modified: add projects table
├── lib/
│   └── auth.ts                   # New: getRequiredIdentity, getOrCreateProfile, requireProjectAccess
├── projects.ts                   # New: list, get, create, rename, delete
└── projects.test.ts              # New: convex-test cases for projects

apps/web/
├── app/
│   ├── page.tsx                  # Modified: redirect signed-in users to /projects
│   ├── projects/
│   │   └── page.tsx              # New: list of projects, create dialog, rename/delete actions
│   └── canvas/
│       └── [projectId]/
│           └── page.tsx          # New: tldraw canvas page
├── components/
│   ├── projects/
│   │   ├── create-project-dialog.tsx
│   │   ├── rename-project-dialog.tsx
│   │   └── delete-project-dialog.tsx
│   └── ui/                       # Modified: add Dialog, Input, Label, DropdownMenu, AlertDialog (shadcn)
├── vitest.config.ts              # New
├── playwright.config.ts          # New
└── tests/
    └── e2e/
        └── projects.spec.ts      # New: sign-in → create → open canvas → delete

packages/shared/
└── src/
    ├── index.ts                  # Modified: re-export schemas
    └── projects.ts               # New: Zod schemas for project name validation
```

---

## Workflow conventions

- Run all commands from the repo root unless explicitly noted.
- Convex functions are auto-deployed by `convex dev`. Keep `pnpm dlx convex dev` running in a terminal during this plan; otherwise schema changes won't propagate.
- Before each commit: `pnpm format`, `pnpm lint`, `pnpm typecheck`. CI will reject if any fails.
- Commit messages: conventional commits (`feat`, `fix`, `chore`, `test`, `docs`).
- Branch off `main` into `phase-1a-projects-canvas`. Merge back fast-forward when complete.

---

## Task 1: Branch off main

- [ ] **Step 1.1: Create and switch to feature branch**

```powershell
git checkout main
git pull origin main
git checkout -b phase-1a-projects-canvas
```

Expected: "Switched to a new branch 'phase-1a-projects-canvas'".

---

## Task 2: Shared Zod schemas for project name

**Files:**

- Create: `packages/shared/src/projects.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 2.1: Write `packages/shared/src/projects.ts`**

```ts
import { z } from 'zod';

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, 'Project name is required')
  .max(80, 'Project name must be 80 characters or fewer');

export type ProjectName = z.infer<typeof projectNameSchema>;

export const projectSlugSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, digits, and hyphens')
  .min(1)
  .max(80);

/**
 * Generates a URL-safe slug from a project name.
 * Used to keep slug generation logic identical across web (form) and Convex (mutation).
 */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
```

- [ ] **Step 2.2: Re-export from `packages/shared/src/index.ts`**

```ts
export * from './projects';
```

- [ ] **Step 2.3: Verify typecheck**

```powershell
pnpm --filter @arch-viz/shared typecheck
```

Expected: exit 0.

- [ ] **Step 2.4: Commit**

```powershell
git add packages/shared
git commit -m "feat(shared): add project name and slug Zod schemas"
```

---

## Task 3: Add `projects` table to Convex schema

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
});
```

- [ ] **Step 3.2: Confirm `convex dev` accepts the schema**

If `pnpm dlx convex dev` is running, watch the terminal for "Schema validation OK" or similar. If not running, run `pnpm dlx convex dev --once` and expect the same.

Expected: deploy succeeds with the new `projects` table.

- [ ] **Step 3.3: Commit**

```powershell
git add convex/schema.ts
git commit -m "feat(convex): add projects table with user and slug indexes"
```

---

## Task 4: Auth helper module

**Files:**

- Create: `convex/lib/auth.ts`

- [ ] **Step 4.1: Create directory**

```powershell
New-Item -ItemType Directory -Path "convex/lib" -Force | Out-Null
```

- [ ] **Step 4.2: Write `convex/lib/auth.ts`**

```ts
import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx, QueryCtx } from '../_generated/server';

type AnyCtx = QueryCtx | MutationCtx;

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Returns the Clerk identity. Throws UnauthorizedError if no signed-in user.
 */
export async function getRequiredIdentity(ctx: AnyCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new UnauthorizedError();
  return identity;
}

/**
 * Returns the profile row for the current user, creating it on first call.
 * Mutation context required because creation is a write.
 */
export async function getOrCreateProfile(ctx: MutationCtx): Promise<Doc<'profiles'>> {
  const identity = await getRequiredIdentity(ctx);
  const existing = await ctx.db
    .query('profiles')
    .withIndex('by_clerk', (q) => q.eq('clerkId', identity.subject))
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert('profiles', {
    clerkId: identity.subject,
    email: identity.email ?? '',
  });
  const inserted = await ctx.db.get(id);
  if (!inserted) throw new Error('failed to read profile after insert');
  return inserted;
}

/**
 * Read-side variant: returns the existing profile or null. Accepts either
 * context type so `requireProjectAccess` can use it from mutations too.
 */
export async function getProfile(ctx: AnyCtx): Promise<Doc<'profiles'> | null> {
  const identity = await getRequiredIdentity(ctx);
  return ctx.db
    .query('profiles')
    .withIndex('by_clerk', (q) => q.eq('clerkId', identity.subject))
    .unique();
}

/**
 * Loads a project by id and verifies the current user owns it. Throws otherwise.
 * Works in both query and mutation contexts because it only reads.
 */
export async function requireProjectAccess(
  ctx: AnyCtx,
  projectId: Id<'projects'>,
): Promise<Doc<'projects'>> {
  const profile = await getProfile(ctx);
  if (!profile) throw new UnauthorizedError('No profile yet — create a project first');
  const project = await ctx.db.get(projectId);
  if (!project) throw new NotFoundError('Project not found');
  if (project.userId !== profile._id) throw new UnauthorizedError('You do not own this project');
  return project;
}
```

- [ ] **Step 4.3: Verify Convex tsc**

```powershell
pnpm dlx convex dev --once
```

Expected: "Convex functions ready!" with no TypeScript errors.

- [ ] **Step 4.4: Commit**

```powershell
git add convex/lib
git commit -m "feat(convex): add auth helpers (profile bootstrap, project access check)"
```

---

## Task 5: `projects.list` query

**Files:**

- Create: `convex/projects.ts`

- [ ] **Step 5.1: Write `convex/projects.ts` with `list` query**

```ts
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getOrCreateProfile, getProfile, requireProjectAccess } from './lib/auth';
import { slugify } from '@arch-viz/shared';

export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getProfile(ctx);
    if (!profile) return [];
    return ctx.db
      .query('projects')
      .withIndex('by_user', (q) => q.eq('userId', profile._id))
      .order('desc')
      .collect();
  },
});
```

- [ ] **Step 5.2: Add `@arch-viz/shared` to convex's reachable deps**

The convex/ directory is at the repo root. Add the workspace dep at root so Convex tsc resolves the import:

```powershell
pnpm add -w @arch-viz/shared
```

- [ ] **Step 5.3: Verify Convex deploys cleanly**

```powershell
pnpm dlx convex dev --once
```

Expected: "Convex functions ready!".

- [ ] **Step 5.4: Commit**

```powershell
git add convex/projects.ts package.json pnpm-lock.yaml
git commit -m "feat(convex): add projects.list query"
```

---

## Task 6: `projects.create` mutation

**Files:**

- Modify: `convex/projects.ts`

- [ ] **Step 6.1: Append `create` mutation to `convex/projects.ts`**

```ts
export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, { name }) => {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('Project name is required');
    if (trimmed.length > 80) throw new Error('Project name must be 80 characters or fewer');

    const profile = await getOrCreateProfile(ctx);

    let slug = slugify(trimmed);
    if (slug.length === 0) slug = 'untitled';

    // Ensure slug uniqueness per user — append -2, -3, ... if taken.
    const existingSlugs = new Set(
      (
        await ctx.db
          .query('projects')
          .withIndex('by_user', (q) => q.eq('userId', profile._id))
          .collect()
      ).map((p) => p.slug),
    );
    let candidate = slug;
    let counter = 2;
    while (existingSlugs.has(candidate)) {
      candidate = `${slug}-${counter++}`;
    }

    return await ctx.db.insert('projects', {
      userId: profile._id,
      name: trimmed,
      slug: candidate,
    });
  },
});
```

- [ ] **Step 6.2: Verify Convex deploys**

```powershell
pnpm dlx convex dev --once
```

Expected: clean deploy.

- [ ] **Step 6.3: Commit**

```powershell
git add convex/projects.ts
git commit -m "feat(convex): add projects.create mutation with unique slug"
```

---

## Task 7: `projects.get`, `projects.rename`, `projects.delete`

**Files:**

- Modify: `convex/projects.ts`

- [ ] **Step 7.1: Append `get` query**

```ts
export const get = query({
  args: { id: v.id('projects') },
  handler: async (ctx, { id }) => {
    return await requireProjectAccess(ctx, id);
  },
});
```

- [ ] **Step 7.2: Append `rename` mutation**

```ts
export const rename = mutation({
  args: {
    id: v.id('projects'),
    name: v.string(),
  },
  handler: async (ctx, { id, name }) => {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('Project name is required');
    if (trimmed.length > 80) throw new Error('Project name must be 80 characters or fewer');

    await requireProjectAccess(ctx, id);
    await ctx.db.patch(id, { name: trimmed });
  },
});
```

- [ ] **Step 7.3: Append `delete` mutation**

```ts
export const remove = mutation({
  args: { id: v.id('projects') },
  handler: async (ctx, { id }) => {
    await requireProjectAccess(ctx, id);
    await ctx.db.delete(id);
    // No child rows yet (nodes/kanban arrive in Phase 1B/1C); cascade will be added then.
  },
});
```

> Naming note: `remove` (not `delete`) because `delete` is a reserved word in JavaScript object syntax in some contexts and the Convex client exposes it as `api.projects.remove`.

- [ ] **Step 7.4: Verify Convex deploys**

```powershell
pnpm dlx convex dev --once
```

Expected: clean deploy.

- [ ] **Step 7.5: Commit**

```powershell
git add convex/projects.ts
git commit -m "feat(convex): add projects.get, rename, remove"
```

---

## Task 8: Vitest + convex-test setup

**Files:**

- Create: `vitest.config.ts` at repo root
- Create: `convex/projects.test.ts`
- Modify: root `package.json`

- [ ] **Step 8.1: Install Vitest and convex-test**

```powershell
pnpm add -Dw vitest convex-test @edge-runtime/vm
```

`@edge-runtime/vm` is the Convex-recommended environment for `convex-test`.

- [ ] **Step 8.2: Write `vitest.config.ts` at repo root**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
    include: ['convex/**/*.test.ts'],
  },
});
```

- [ ] **Step 8.3: Add `test` script to root `package.json`**

In the existing `scripts` block, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

The full scripts block becomes:

```json
"scripts": {
  "dev": "pnpm --filter @arch-viz/web dev",
  "build": "pnpm -r build",
  "lint": "eslint . --max-warnings=0",
  "typecheck": "pnpm -r typecheck",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 8.4: Write a smoke test at `convex/projects.test.ts`**

```ts
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

describe('projects', () => {
  test('list returns empty array for unauthenticated user', async () => {
    const t = convexTest(schema);
    const result = await t.query(api.projects.list);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 8.5: Run the smoke test**

```powershell
pnpm test
```

Expected: 1 passing test, exit 0.

If you see "convex-test: schema validation failed" — confirm `pnpm dlx convex dev --once` ran successfully so `convex/_generated/` is up to date.

- [ ] **Step 8.6: Commit**

```powershell
git add vitest.config.ts convex/projects.test.ts package.json pnpm-lock.yaml
git commit -m "test(convex): set up vitest with convex-test for backend tests"
```

---

## Task 9: Tests for `projects.create` (TDD: write more tests, then verify behaviour)

**Files:**

- Modify: `convex/projects.test.ts`

- [ ] **Step 9.1: Add a test that creates a project as a signed-in user**

Append to `convex/projects.test.ts`:

```ts
const fakeIdentity = (subject: string, email: string) => ({
  subject,
  email,
  tokenIdentifier: `https://test.clerk.accounts.dev|${subject}`,
  issuer: 'https://test.clerk.accounts.dev',
});

describe('projects.create', () => {
  test('creates a project for the signed-in user with a slug derived from the name', async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const id = await asUser.mutation(api.projects.create, { name: 'My First Project' });

    const list = await asUser.query(api.projects.list);
    expect(list).toHaveLength(1);
    expect(list[0]._id).toEqual(id);
    expect(list[0].name).toEqual('My First Project');
    expect(list[0].slug).toEqual('my-first-project');
  });

  test('appends -2 when the slug is already used by the same user', async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    await asUser.mutation(api.projects.create, { name: 'Notes' });
    await asUser.mutation(api.projects.create, { name: 'Notes' });
    const list = await asUser.query(api.projects.list);

    expect(list.map((p) => p.slug).sort()).toEqual(['notes', 'notes-2']);
  });

  test('rejects empty names', async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    await expect(asUser.mutation(api.projects.create, { name: '   ' })).rejects.toThrow(
      /Project name is required/,
    );
  });

  test('rejects creation when not signed in', async () => {
    const t = convexTest(schema);
    await expect(t.mutation(api.projects.create, { name: 'X' })).rejects.toThrow(/Unauthorized/);
  });
});
```

- [ ] **Step 9.2: Run tests**

```powershell
pnpm test
```

Expected: 5 tests passing.

- [ ] **Step 9.3: Commit**

```powershell
git add convex/projects.test.ts
git commit -m "test(convex): cover projects.create (slug, dedupe, validation, auth)"
```

---

## Task 10: Tests for `projects.rename` and `projects.remove`

**Files:**

- Modify: `convex/projects.test.ts`

- [ ] **Step 10.1: Append rename + delete tests**

```ts
describe('projects.rename', () => {
  test('updates the name of the requesting user’s project', async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const id = await asUser.mutation(api.projects.create, { name: 'Old name' });
    await asUser.mutation(api.projects.rename, { id, name: 'New name' });

    const project = await asUser.query(api.projects.get, { id });
    expect(project.name).toEqual('New name');
  });

  test('refuses to rename another user’s project', async () => {
    const t = convexTest(schema);
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
    const t = convexTest(schema);
    const asUser = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));

    const id = await asUser.mutation(api.projects.create, { name: 'Disposable' });
    await asUser.mutation(api.projects.remove, { id });

    const list = await asUser.query(api.projects.list);
    expect(list).toEqual([]);
  });

  test('refuses to remove another user’s project', async () => {
    const t = convexTest(schema);
    const asAlice = t.withIdentity(fakeIdentity('user_alice', 'alice@example.com'));
    const asBob = t.withIdentity(fakeIdentity('user_bob', 'bob@example.com'));

    const id = await asAlice.mutation(api.projects.create, { name: 'Alice project' });

    await expect(asBob.mutation(api.projects.remove, { id })).rejects.toThrow(/Unauthorized/);
  });
});
```

- [ ] **Step 10.2: Run tests**

```powershell
pnpm test
```

Expected: 9 tests passing.

- [ ] **Step 10.3: Commit**

```powershell
git add convex/projects.test.ts
git commit -m "test(convex): cover projects.rename and projects.remove (auth checks)"
```

---

## Task 11: Add shadcn/ui components needed for the projects page

**Files:**

- (auto-created by shadcn CLI) `apps/web/components/ui/dialog.tsx`, `input.tsx`, `label.tsx`, `dropdown-menu.tsx`, `alert-dialog.tsx`

- [ ] **Step 11.1: Add Dialog, Input, Label, DropdownMenu, AlertDialog**

```powershell
cd apps/web
pnpm dlx shadcn@latest add dialog input label dropdown-menu alert-dialog
cd ../..
```

Expected: each command writes a new file under `apps/web/components/ui/`.

- [ ] **Step 11.2: Install React Hook Form + Zod resolver**

```powershell
pnpm --filter @arch-viz/web add react-hook-form @hookform/resolvers zod
```

- [ ] **Step 11.3: Verify typecheck still clean**

```powershell
pnpm --filter @arch-viz/web typecheck
```

Expected: exit 0.

- [ ] **Step 11.4: Commit**

```powershell
git add apps/web pnpm-lock.yaml
git commit -m "chore(web): add shadcn dialog/input/label/dropdown/alert-dialog and RHF+Zod"
```

---

## Task 12: `CreateProjectDialog` component

**Files:**

- Create: `apps/web/components/projects/create-project-dialog.tsx`

- [ ] **Step 12.1: Create directory**

```powershell
New-Item -ItemType Directory -Path "apps/web/components/projects" -Force | Out-Null
```

- [ ] **Step 12.2: Write `apps/web/components/projects/create-project-dialog.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from 'convex/react';
import { useRouter } from 'next/navigation';

import { projectNameSchema } from '@arch-viz/shared';
import { api } from '../../../../convex/_generated/api';
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

const formSchema = z.object({ name: projectNameSchema });
type FormValues = z.infer<typeof formSchema>;

export function CreateProjectDialog() {
  const [open, setOpen] = useState(false);
  const create = useMutation(api.projects.create);
  const router = useRouter();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '' },
  });

  const onSubmit = async (values: FormValues) => {
    const id = await create({ name: values.name });
    reset();
    setOpen(false);
    router.push(`/canvas/${id}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New project</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create a project</DialogTitle>
            <DialogDescription>You can rename or delete it later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" autoFocus {...register('name')} />
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

- [ ] **Step 12.3: Verify typecheck**

```powershell
pnpm --filter @arch-viz/web typecheck
```

Expected: exit 0.

- [ ] **Step 12.4: Commit**

```powershell
git add apps/web/components/projects
git commit -m "feat(web): add CreateProjectDialog with RHF+Zod validation"
```

---

## Task 13: `RenameProjectDialog` and `DeleteProjectDialog` components

**Files:**

- Create: `apps/web/components/projects/rename-project-dialog.tsx`
- Create: `apps/web/components/projects/delete-project-dialog.tsx`

- [ ] **Step 13.1: Write `rename-project-dialog.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from 'convex/react';

import { projectNameSchema } from '@arch-viz/shared';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const formSchema = z.object({ name: projectNameSchema });
type FormValues = z.infer<typeof formSchema>;

interface Props {
  projectId: Id<'projects'>;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameProjectDialog({ projectId, currentName, open, onOpenChange }: Props) {
  const rename = useMutation(api.projects.rename);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: currentName },
  });

  useEffect(() => {
    if (open) reset({ name: currentName });
  }, [open, currentName, reset]);

  const onSubmit = async (values: FormValues) => {
    await rename({ id: projectId, name: values.name });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-name">Name</Label>
            <Input id="rename-name" autoFocus {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 13.2: Write `delete-project-dialog.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useMutation } from 'convex/react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props {
  projectId: Id<'projects'>;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteProjectDialog({ projectId, projectName, open, onOpenChange }: Props) {
  const remove = useMutation(api.projects.remove);
  const [pending, setPending] = useState(false);

  const onConfirm = async () => {
    setPending(true);
    try {
      await remove({ id: projectId });
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &quot;{projectName}&quot;?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the project and (in Phase 1B+) its nodes and kanban tasks.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            {pending ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 13.3: Verify typecheck**

```powershell
pnpm --filter @arch-viz/web typecheck
```

- [ ] **Step 13.4: Commit**

```powershell
git add apps/web/components/projects
git commit -m "feat(web): add RenameProjectDialog and DeleteProjectDialog"
```

---

## Task 14: `/projects` page

**Files:**

- Create: `apps/web/app/projects/page.tsx`

- [ ] **Step 14.1: Create directory**

```powershell
New-Item -ItemType Directory -Path "apps/web/app/projects" -Force | Out-Null
```

- [ ] **Step 14.2: Write `apps/web/app/projects/page.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from 'convex/react';
import { MoreVertical } from 'lucide-react';
import { UserButton } from '@clerk/nextjs';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import { RenameProjectDialog } from '@/components/projects/rename-project-dialog';
import { DeleteProjectDialog } from '@/components/projects/delete-project-dialog';

export default function ProjectsPage() {
  const projects = useQuery(api.projects.list);
  const [renameTarget, setRenameTarget] = useState<Doc<'projects'> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Doc<'projects'> | null>(null);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="absolute right-4 top-4">
        <UserButton />
      </div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <CreateProjectDialog />
      </div>

      {projects === undefined && <p className="text-muted-foreground">Loading…</p>}
      {projects && projects.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No projects yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Create your first project to begin.</p>
          </CardContent>
        </Card>
      )}
      {projects && projects.length > 0 && (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p._id} className="flex items-center justify-between rounded-md border p-4">
              <Link href={`/canvas/${p._id}`} className="flex-1 hover:underline">
                {p.name}
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Project actions">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setRenameTarget(p)}>Rename</DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setDeleteTarget(p)}
                    className="text-destructive"
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      {renameTarget && (
        <RenameProjectDialog
          projectId={renameTarget._id}
          currentName={renameTarget.name}
          open
          onOpenChange={(open) => !open && setRenameTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteProjectDialog
          projectId={deleteTarget._id}
          projectName={deleteTarget.name}
          open
          onOpenChange={(open) => !open && setDeleteTarget(null)}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 14.3: Update root `app/page.tsx` to redirect to `/projects` for signed-in users**

Replace `apps/web/app/page.tsx` with:

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/projects');
}
```

The Clerk middleware already enforces sign-in, so unauthenticated users hit `/sign-in` first.

- [ ] **Step 14.4: Verify typecheck**

```powershell
pnpm --filter @arch-viz/web typecheck
```

- [ ] **Step 14.5: Commit**

```powershell
git add apps/web/app
git commit -m "feat(web): add /projects page (list, create, rename, delete) and redirect from /"
```

---

## Task 15: `/canvas/[projectId]` page with tldraw

**Files:**

- Create: `apps/web/app/canvas/[projectId]/page.tsx`

- [ ] **Step 15.1: Install tldraw**

```powershell
pnpm --filter @arch-viz/web add tldraw
```

- [ ] **Step 15.2: Add tldraw CSS to `globals.css`**

Open `apps/web/app/globals.css` and append at the end:

```css
@import 'tldraw/tldraw.css';
```

- [ ] **Step 15.3: Create directory**

```powershell
New-Item -ItemType Directory -Path "apps/web/app/canvas/[projectId]" -Force | Out-Null
```

- [ ] **Step 15.4: Write `apps/web/app/canvas/[projectId]/page.tsx`**

```tsx
'use client';

import { useQuery } from 'convex/react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';

// tldraw uses browser-only APIs; load it client-side only.
const Tldraw = dynamic(() => import('tldraw').then((m) => m.Tldraw), { ssr: false });

export default function CanvasPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId as Id<'projects'>;
  const project = useQuery(api.projects.get, { id: projectId });

  if (project === undefined) {
    return <p className="p-8 text-muted-foreground">Loading…</p>;
  }
  if (project === null) {
    // requireProjectAccess threw — user does not own this project, or it does not exist.
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
      </header>
      <div className="flex-1">
        <Tldraw persistenceKey={`arch-viz:${projectId}`} />
      </div>
    </main>
  );
}
```

> Note: `useQuery` will throw and the React error boundary in production will hide the message; in dev you'll see "Unauthorized" in the console for non-owned projects. The redirect-to-projects branch above handles user-visible behaviour.

- [ ] **Step 15.5: Verify typecheck**

```powershell
pnpm --filter @arch-viz/web typecheck
```

- [ ] **Step 15.6: Commit**

```powershell
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): add /canvas/[projectId] page with empty tldraw canvas"
```

---

## Task 16: Playwright e2e setup

**Files:**

- Create: `apps/web/playwright.config.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 16.1: Install Playwright**

```powershell
pnpm --filter @arch-viz/web add -D @playwright/test
pnpm --filter @arch-viz/web exec playwright install chromium
```

- [ ] **Step 16.2: Write `apps/web/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
```

- [ ] **Step 16.3: Add e2e scripts to `apps/web/package.json`**

In the `scripts` block, add:

```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui"
```

- [ ] **Step 16.4: Commit**

```powershell
git add apps/web/playwright.config.ts apps/web/package.json pnpm-lock.yaml
git commit -m "test(web): set up Playwright for e2e tests"
```

---

## Task 17: First e2e test (manual sign-in walkthrough)

**Files:**

- Create: `apps/web/tests/e2e/projects.spec.ts`

> **Note on Clerk + Playwright:** Clerk's "test mode" requires extra setup (Clerk Testing Tokens or pre-seeded test users). For Phase 1A we skip automated Clerk sign-in and write a "smoke" e2e that the developer runs after manually signing in with `pnpm e2e --headed` or launches via `pnpm e2e:ui`. Phase 1B+ adds proper Clerk test user setup.

- [ ] **Step 17.1: Create directory**

```powershell
New-Item -ItemType Directory -Path "apps/web/tests/e2e" -Force | Out-Null
```

- [ ] **Step 17.2: Write `apps/web/tests/e2e/projects.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

// This test assumes the user is already signed in (via storageState in a follow-up
// task or via a `pnpm e2e --headed` interactive run). It validates the projects
// page interactions but not the auth flow.

test.describe('projects page', () => {
  test.skip(!process.env.E2E_AUTHED, 'Skipping until authenticated storageState is configured');

  test('create then delete a project', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByLabel('Name').fill('E2E Test Project');
    await page.getByRole('button', { name: 'Create' }).click();

    // After create, we redirect to /canvas/[id]; assert tldraw mounted.
    await expect(page.getByRole('button', { name: '← Projects' })).toBeVisible();

    await page.getByRole('button', { name: '← Projects' }).click();
    await expect(page.getByText('E2E Test Project')).toBeVisible();

    // Delete via dropdown.
    await page.getByRole('button', { name: 'Project actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('E2E Test Project')).not.toBeVisible();
  });
});
```

> The `E2E_AUTHED` env var keeps this skipped in CI until Clerk test setup lands in a later phase. Locally you can run `E2E_AUTHED=1 pnpm --filter @arch-viz/web e2e --headed` after signing in once.

- [ ] **Step 17.3: Commit**

```powershell
git add apps/web/tests
git commit -m "test(web): add e2e smoke for create/delete project (skipped until auth setup)"
```

---

## Task 18: Update CI to run unit tests

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 18.1: Add a `test` step to the workflow**

Open `.github/workflows/ci.yml` and add this step after `Typecheck`:

```yaml
- name: Test
  run: pnpm test
```

The full job now ends with:

```yaml
- name: Format check
  run: pnpm format:check

- name: Lint
  run: pnpm lint

- name: Typecheck
  run: pnpm typecheck

- name: Test
  run: pnpm test
```

> Playwright e2e is not yet wired into CI (it depends on Clerk test setup). Phase 1B+ revisits this.

- [ ] **Step 18.2: Verify the local pipeline still passes**

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all four exit 0.

- [ ] **Step 18.3: Commit**

```powershell
git add .github/workflows/ci.yml
git commit -m "ci: run unit tests in GitHub Actions pipeline"
```

---

## Task 19: Final verification + push + tag

- [ ] **Step 19.1: Run full local pipeline**

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all four exit 0.

- [ ] **Step 19.2: Manual smoke test**

In two terminals:

```powershell
pnpm dlx convex dev   # terminal 1
pnpm dev              # terminal 2
```

Open http://localhost:3000:

1. Should redirect through `/sign-in` → after sign-in, land on `/projects`.
2. Click **New project** → enter name → Create → land on `/canvas/<id>` with empty tldraw canvas + "← Projects" header button.
3. Click "← Projects" → see project listed.
4. Open another tab → /projects → confirm same list (verifies Convex live sync).
5. Use the dropdown → Rename → confirm name changes everywhere.
6. Use dropdown → Delete → confirm project disappears.

- [ ] **Step 19.3: Push branch**

```powershell
git push -u origin phase-1a-projects-canvas
```

Wait for CI to be green at https://github.com/GlennAyden/Architecture-Visualization/actions.

- [ ] **Step 19.4: Merge to main and tag**

```powershell
git checkout main
git pull origin main
git merge phase-1a-projects-canvas --ff-only
git tag -a phase-1a -m "Phase 1A: projects + empty canvas"
git push origin main phase-1a
```

---

## Phase 1A — Definition of Done checklist

- [ ] Convex schema has `projects` table with `by_user` and `by_user_slug` indexes.
- [ ] Convex functions `projects.list`, `get`, `create`, `rename`, `remove` enforce auth and ownership; tested with `convex-test`.
- [ ] Web app `/projects` page lists, creates (via dialog), renames (via dialog), and deletes (via alert dialog) the signed-in user's projects.
- [ ] Web app `/canvas/[projectId]` page renders an empty tldraw canvas for projects the user owns; redirects elsewhere if the project does not exist or is not owned.
- [ ] `/` redirects to `/projects`.
- [ ] Vitest configured at the root, runs in CI; 9 backend tests pass.
- [ ] Playwright installed (e2e skipped pending Clerk test setup).
- [ ] CI green; tag `phase-1a` pushed.
