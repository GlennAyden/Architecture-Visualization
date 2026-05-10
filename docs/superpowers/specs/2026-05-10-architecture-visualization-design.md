# Architecture Visualization Tool — Design Spec

**Date:** 2026-05-10
**Status:** Approved (brainstorming phase complete)
**Owner:** akulapar2212@gmail.com

## 1. Purpose

A _living_ architecture canvas that mirrors the structure of a software project and stays in sync with AI-driven development. Each node represents a page or a feature; each node carries a kanban (todo / doing / done), a description, linked files, and an activity log.

The canvas is bidirectional:

- **AI-driven** — when an AI agent (Claude Code, Codex, Cursor, etc.) creates a page, fixes a bug, or implements a feature, it updates the canvas through MCP tools. New nodes appear automatically; status flows todo → doing → done as the work progresses.
- **User-driven** — the user can drag-create nodes as planning artefacts (a page that does not yet exist in code), populate the kanban, and later have the AI implement against those plans.

The goal is to remove the gap between _what is being built_, _what has been built_, and _what is left_, without forcing manual diagram maintenance.

## 2. Scope

### In scope (MVP and near-term)

- **Single-user, hosted web app** opened in a browser (localhost first, hosted later).
- **One canvas per project** (data model: `project` 1—N `nodes`).
- **Hierarchical nodes**: `page` nodes can contain nested `feature` nodes.
- **Per-node modal** with: description, linked files, kanban (todo / doing / done), activity log.
- **MCP server** as the single integration mechanism between AI agents and the canvas.
- **Real-time updates**: changes from the AI side appear in the browser canvas without manual refresh.

### Out of scope (deferred)

- Multi-tenant SaaS, billing, organizations, role-based access. (Multi-user _invite-only_ may come later as Phase 4 — see §11.)
- Public sharing / publish-to-web of canvases.
- Hooks / file-watcher safety net (deferred — see §12 "Future evolution").
- Component-level node granularity (we stay at page + feature).
- Advanced canvas features (presence, multiplayer cursors, comments).

## 3. Key decisions (already approved)

| #   | Decision                  | Choice                                                                                                 |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Source-of-truth direction | **Hybrid** — both AI-driven auto-update and user-driven planning                                       |
| 2   | Form factor               | **Browser-based web app**, localhost for dev, hosted later                                             |
| 3   | User scope                | **Personal first** (single user), evolve to **invite-only multi-user**, never public SaaS              |
| 4   | AI integration            | **MCP server** only for MVP                                                                            |
| 5   | Project model             | **One canvas per project** (A1)                                                                        |
| 6   | Node granularity          | **Page + nested feature** (B2 hierarchical)                                                            |
| 7   | Modal contents            | description, linked files, kanban, activity log                                                        |
| 8   | Build approach            | **Lean MVP** — Next.js + Convex + Clerk + tldraw + stdio MCP                                           |
| 9   | Canvas library            | **tldraw** (matches early sketch, mature custom-shape API, good freeform/group support)                |
| 10  | Backend                   | **Convex** (reactive queries, end-to-end TypeScript, simpler realtime than Supabase for this use case) |
| 11  | Auth provider             | **Clerk** (magic link, free tier 10k MAU, integrates natively with Convex)                             |
| 12  | MCP transport             | **stdio** (universal across Claude Code, Codex, Cursor)                                                |
| 13  | Package manager           | **pnpm** (workspace-friendly, efficient store)                                                         |

## 4. Tech stack (full list)

Grouped by responsibility.

### 4.1 Language & framework

| Tech                     | Role                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| **TypeScript**           | Single language across web app + MCP server + Convex functions; shared types end-to-end |
| **Next.js (App Router)** | Frontend + API routes (where needed) + deploy unit                                      |
| **React 18+**            | UI library (transitively via Next.js); used for tldraw and shadcn/ui                    |

### 4.2 UI & styling

| Tech             | Role                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| **Tailwind CSS** | Utility-first styling; design tokens via `tailwind.config.ts`                                                   |
| **shadcn/ui**    | Copy-paste accessible components (Button, Dialog, Tabs, etc.) — components live in our repo, fully customizable |
| **lucide-react** | Icon set (default for shadcn/ui)                                                                                |
| **tldraw**       | Canvas surface — nodes, arrows, groups, drag/drop, zoom, undo/redo                                              |

### 4.3 Data & state

| Tech                    | Role                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Convex**              | Backend-as-a-service: schema, reactive queries, mutations, HTTP actions, file storage. Single source of truth for all server state          |
| **Convex React client** | `useQuery`/`useMutation` hooks; reactive subscriptions are automatic                                                                        |
| **TanStack Query**      | Caching layer for non-Convex async work (e.g., filesystem scans returned via MCP HTTP). Optional — defer if not needed for MVP              |
| **Zustand**             | Lightweight client-only UI state (modal open/close, selected node id). Optional — added only when local component state proves insufficient |

### 4.4 Auth

| Tech                      | Role                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Clerk**                 | User authentication; magic link / OAuth providers; integrates with Convex via JWT template                |
| **Convex API key tokens** | Custom tokens issued for MCP server use — stored hashed in a Convex table, scoped to `userId + projectId` |

### 4.5 Validation & forms

| Tech                          | Role                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Zod**                       | Schema validation: shared between Convex args validators (via `v.*`), MCP tool inputs, and form validation |
| **Convex `v.*` validators**   | Convex's built-in arg validators; we keep complex validation in Zod and pass results in                    |
| **React Hook Form**           | Performant uncontrolled forms for the node modal (description editor, kanban CRUD, settings)               |
| **`@hookform/resolvers/zod`** | Bridges RHF and Zod                                                                                        |

### 4.6 AI integration

| Tech                                         | Role                                                               |
| -------------------------------------------- | ------------------------------------------------------------------ |
| **Node.js**                                  | Runtime for the local MCP server                                   |
| **`@modelcontextprotocol/sdk` (TypeScript)** | Official SDK for stdio MCP servers                                 |
| **`convex/browser` client**                  | MCP server uses this to call Convex HTTP actions with API key auth |

### 4.7 Testing

| Tech              | Role                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| **Vitest**        | Unit + integration tests for shared packages, MCP tool handlers, Convex function logic |
| **`convex-test`** | Run Convex functions in unit tests against an in-memory backend                        |
| **Playwright**    | E2E browser tests — full canvas + modal + simulated MCP flow                           |

### 4.8 Tooling & dev experience

| Tech                       | Role                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------ |
| **pnpm + workspaces**      | Package manager + monorepo                                                           |
| **ESLint + Prettier**      | Linting and formatting                                                               |
| **TypeScript strict mode** | Catch bugs at compile time                                                           |
| **`convex dev` CLI**       | Local development; syncs schema and functions to Convex dev deployment automatically |

### 4.9 Hosting

| Tech             | Role                                                               |
| ---------------- | ------------------------------------------------------------------ |
| **Vercel**       | Web app hosting + preview deployments per branch                   |
| **Convex Cloud** | Backend hosting (free tier — 1M function calls/month, 1GB storage) |
| **Clerk hosted** | Auth provider — no self-hosting needed                             |

## 5. High-level architecture

```
┌────────────────── User's local machine ──────────────────┐
│  ┌────────────┐     ┌──────────────────────────┐        │
│  │ Claude Code│────►│ Local MCP server (Node)  │        │
│  │ Codex / etc│stdio│ exposes tools to AI      │        │
│  └────────────┘     └────────────┬─────────────┘        │
│  ┌──────────────────────────┐    │ HTTPS + API key      │
│  │ Browser (canvas UI)      │    │                       │
│  │ Next.js + tldraw + Convex│    │                       │
│  │ React client + Clerk SDK │    │                       │
│  └────────────┬─────────────┘    │                       │
└───────────────┼──────────────────┼───────────────────────┘
                │ WebSocket            │ HTTPS
                │ (Convex client)      │ (HTTP Action)
                ▼                       ▼
       ┌──────── Convex Cloud (backend) ────────┐
       │                                        │
       │  Schema   ──  Queries  ──  Mutations   │
       │                  │            │        │
       │                  └─ HTTP Actions ─◄────┤  (MCP entry)
       │                                        │
       │  Built-in: realtime push to subscribed │
       │            clients on any data change  │
       └────────────────────────────────────────┘
                ▲
                │ JWT
                │
       ┌────────────────┐         ┌──────────────────┐
       │ Clerk (auth)   │         │ Vercel (Next.js  │
       │                │         │  app static +    │
       │ magic link, JWT│         │  edge functions) │
       └────────────────┘         └──────────────────┘
```

Two clients, one backend:

- **Browser** uses the Convex React client directly. Every `useQuery` is a live subscription — when data changes anywhere, this client re-renders. Auth via Clerk JWT (Convex validates the JWT signature on every call).
- **Local MCP server** uses Convex HTTP Actions. It carries an API key (long-lived bearer token bound to one user + one project). The HTTP Action validates the key, then runs the corresponding internal mutation — same authorization rules as the browser path.

## 6. Components

### 6.1 Web app — Next.js (App Router)

**Routes (UI):**

- `/(app)/projects` — list, create, delete projects
- `/(app)/canvas/[projectId]` — main tldraw canvas with custom shapes for `page` / `feature` nodes
- `/(app)/settings/tokens` — generate/revoke MCP API tokens
- `/sign-in`, `/sign-up` — Clerk-managed pages

**No traditional `/api/v1/*` REST routes for normal data:** the browser talks to Convex directly. Next.js API routes are reserved only for cases that need server-side secrets (e.g., webhooks from Clerk).

### 6.2 Convex backend (`convex/` directory)

```
convex/
├── schema.ts            # all tables, indexes
├── auth.config.ts       # Clerk JWT template config
├── projects.ts          # query: list, get; mutation: create, rename, delete
├── nodes.ts             # query: listByProject, get; mutation: create, update, move, delete
├── kanban.ts            # query: listByNode; mutation: createTask, updateStatus, reorder, delete
├── activity.ts          # query: listByNode; mutation: log (internal)
├── apiKeys.ts           # mutation: issue, revoke; internal: verify
├── http.ts              # HTTP Actions for MCP server
└── _generated/          # autogenerated types — never edit
```

Convex functions come in three kinds, used as follows:

- **Query** (reactive read, transactional, no side effects) — listing nodes, fetching kanban
- **Mutation** (transactional write) — create/update/delete records
- **HTTP Action** (REST entry point, can call mutations internally) — used by the MCP server

### 6.3 Local MCP server — Node.js, stdio

Distributed as a CLI: `npx @arch-viz/mcp-server` (final package name finalized before Phase 2).

Configured in the user's MCP config (e.g., `claude_desktop_config.json`, `.codex/mcp.json`) with environment variables:

- `ARCHITECTURE_CONVEX_URL` — Convex deployment URL (e.g., `https://famous-otter-123.convex.cloud`)
- `ARCHITECTURE_API_KEY` — long-lived bearer token issued in `/settings/tokens`
- `ARCHITECTURE_PROJECT_ID` — which project this MCP instance writes to

**Tools exposed:**

| Tool                   | Inputs                                                                                     | Purpose                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `list_nodes`           | —                                                                                          | AI reads current canvas state (essential for hybrid mode) |
| `get_node`             | `id`                                                                                       | Drill into one node + kanban + files                      |
| `create_node`          | `type: 'page' \| 'feature'`, `name`, `parent_id?`, `description?`, `files?[]`, `position?` | Create node (uses `parent_id` for nested features)        |
| `update_node`          | `id`, partial fields                                                                       | Update name / description / metadata / position           |
| `delete_node`          | `id`                                                                                       | Cascade delete                                            |
| `link_files`           | `node_id`, `paths: string[]`                                                               | Attach file paths to a node                               |
| `add_kanban_task`      | `node_id`, `title`, `description?`, `status: 'todo' \| 'doing' \| 'done'`                  | Add a kanban task                                         |
| `update_kanban_status` | `task_id`, `status`                                                                        | Move task across columns                                  |
| `log_activity`         | `node_id`, `message`, `metadata?`                                                          | Append to activity log                                    |

Errors are typed and contain self-correction hints, e.g., _"Project not found. Verify `ARCHITECTURE_PROJECT_ID` matches an existing project."_

Internally each tool:

1. Validates input with Zod (shared schema package).
2. Calls the corresponding Convex HTTP Action with `x-api-key` header.
3. Returns the structured response or error to the AI.

### 6.4 Convex schema

```ts
// convex/schema.ts
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  // Users come from Clerk; we store a profile row keyed by Clerk subject ID.
  profiles: defineTable({
    clerkId: v.string(), // Clerk user ID (= subject in JWT)
    email: v.string(),
  }).index('by_clerk', ['clerkId']),

  projects: defineTable({
    userId: v.id('profiles'),
    name: v.string(),
    slug: v.string(),
  }).index('by_user', ['userId']),

  nodes: defineTable({
    projectId: v.id('projects'),
    parentId: v.optional(v.id('nodes')), // nested features (B2)
    type: v.union(v.literal('page'), v.literal('feature')),
    name: v.string(),
    description: v.optional(v.string()),
    positionX: v.number(),
    positionY: v.number(),
    metadata: v.optional(v.any()), // tech stack, custom fields
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
    position: v.number(),
  }).index('by_node_status', ['nodeId', 'status']),

  activityLog: defineTable({
    nodeId: v.id('nodes'),
    actor: v.string(), // 'user' | 'mcp:claude-code' | 'mcp:codex' | …
    message: v.string(),
    metadata: v.optional(v.any()),
  }).index('by_node', ['nodeId']),

  apiKeys: defineTable({
    userId: v.id('profiles'),
    projectId: v.id('projects'),
    name: v.string(), // user-friendly label
    tokenHash: v.string(), // bcrypt hash; raw shown once on creation
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_hash', ['tokenHash']),
});
```

Authorization is enforced inside each function — every query/mutation checks `ctx.auth.getUserIdentity()` (or, for HTTP actions, validates the API key) and rejects requests that don't own the target resource. This pattern is Convex's native equivalent of Postgres RLS, and it scales seamlessly to multi-user without rearchitecture.

### 6.5 Realtime sync (the Convex advantage)

- The browser's `useQuery(api.nodes.listByProject, { projectId })` opens a live subscription. Whenever any mutation affects rows that this query touches, Convex pushes the new result to subscribed clients automatically.
- No subscribe/unsubscribe boilerplate, no payload reconciliation, no `updated_at` tracking — Convex handles all of it.
- When the MCP server triggers a mutation through an HTTP Action, the same subscription mechanism notifies the browser. End-to-end live update is "free."
- Optimistic updates use `useMutation`'s built-in `withOptimisticUpdate` if a smoother UX is needed for drag-edits in tldraw.

## 7. Data flow examples

### A) AI creates a new feature (canvas auto-updates)

1. User to AI: _"Claude, add a Settings page."_
2. AI calls MCP tool `create_node({ type: 'page', name: 'Settings' })`.
3. MCP server → `POST {convexUrl}/api/mcp/nodes/create` with `x-api-key`.
4. Convex HTTP Action validates the key → runs internal `nodes.create` mutation.
5. Convex broadcasts the change → browser's `useQuery` re-renders → tldraw renders the new shape.
6. AI calls `add_kanban_task({ status: 'doing', title: 'Build settings form' })`.
7. After implementing, AI calls `update_kanban_status({ status: 'done' })` and `log_activity({ message: 'Implemented settings form with theme toggle' })`.
8. The user, watching the browser, sees node and kanban progress live.

### B) User plans a feature in the canvas (canvas-driven)

1. User drag-creates a node "Notifications" in tldraw → `useMutation(api.nodes.create)` fires.
2. User opens the modal, fills description, adds three kanban tasks (all `todo`).
3. Later the user prompts the AI: _"Implement the Notifications page from the canvas."_
4. AI calls `list_nodes` → finds the node, reads its kanban → executes them in order, updating status as it goes.

### C) AI fixes a bug (status tracking)

1. AI investigates, calls `add_kanban_task({ status: 'doing', title: 'Fix null pointer in date parser' })` on the affected node.
2. After fixing, `update_kanban_status({ status: 'done' })` and `log_activity({ message: 'Fixed null pointer in date parsing — input now defaults to ISO 8601 when missing' })`.
3. The node modal shows the activity log and the moved-to-done task.

## 8. Error handling

- **MCP server**: typed errors with self-correction hints. Examples:
  - _"Project not found. Verify `ARCHITECTURE_PROJECT_ID`."_
  - _"`parent_id` refers to a node in a different project."_
  - _"API key revoked or invalid. Generate a new one in /settings/tokens."_
- **Browser**: Convex mutations throw on failure → wrapped in toast + revert local UI; tldraw drag operations re-snap to last known position.
- **Realtime**: Convex client auto-reconnects on socket drops; queries refetch on reconnect.
- **Auth**: missing/invalid Clerk JWT → 401 from Convex; the Next.js middleware redirects to `/sign-in`.
- **Cascade delete**: deleting a project removes its nodes, kanban tasks, files, and activity log. Convex doesn't have FK cascades; we handle this in the `projects.delete` mutation explicitly (delete children first, in a transaction).

## 9. Testing strategy

- **Unit (Vitest)** — pure helpers, Zod schema validators, MCP tool input/output transforms.
- **Convex function tests (`convex-test`)** — run queries and mutations against an in-memory Convex backend; assert authorization, cascade deletes, and edge cases.
- **MCP smoke** — spawn the MCP server with a test API key against a local Convex dev deployment; exercise each tool over stdio and assert effects.
- **E2E (Playwright)** — sign in via Clerk test mode → create project → drag-create node → edit modal kanban → simulate a parallel MCP call (via a helper) → assert canvas updates live.

## 10. Repository structure

```
architecture-visualization/
├── apps/
│   ├── web/              # Next.js app
│   │   ├── app/          # App Router pages
│   │   ├── components/   # React components (incl. shadcn/ui)
│   │   ├── lib/
│   │   └── package.json
│   └── mcp-server/       # stdio MCP server, published to npm
│       ├── src/
│       └── package.json
├── packages/
│   └── shared/           # Zod schemas + TypeScript types shared by web + mcp-server
├── convex/               # Convex backend (functions, schema)
│   ├── schema.ts
│   ├── projects.ts
│   ├── nodes.ts
│   ├── kanban.ts
│   ├── activity.ts
│   ├── apiKeys.ts
│   ├── http.ts
│   ├── auth.config.ts
│   └── _generated/
├── docs/
│   └── superpowers/specs/
├── pnpm-workspace.yaml
└── package.json          # workspace root
```

The `convex/` directory is at the repo root because the Convex CLI expects it there; both `apps/web` and `apps/mcp-server` reference its generated client through workspace imports.

## 11. Phased rollout

| Phase                      | Scope                                                                                                                                                                                               | Estimate |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **0 — Setup**              | Monorepo, Convex project, Next.js scaffold, Clerk app, Tailwind + shadcn/ui init, ESLint/Prettier, CI (lint + typecheck)                                                                            | 1–2 days |
| **1 — MVP UI**             | Clerk auth wired into Convex, project CRUD, tldraw canvas with custom page-node shape, drag-create page nodes, per-node modal (description + linked files + kanban CRUD), API token generation page | 4–6 days |
| **2 — MCP integration**    | `mcp-server` package with all tools, Convex HTTP Actions backing each tool, end-to-end test using Claude Code against a localhost Convex dev deployment                                             | 3–5 days |
| **3 — Polish**             | Activity log UI, nested feature nodes (B2 hierarchy with drill-down), deploy to Vercel + Convex prod, custom domain (optional)                                                                      | 3–5 days |
| **4 (later) — Multi-user** | Tighten authorization checks for cross-user isolation, build invite flow via Clerk Organizations or per-project share links                                                                         | 2–3 days |

## 12. Future evolution (deferred)

- **Hooks + file-watcher safety net** — if the AI forgets to call `create_node`, a local hook on Claude Code post-tool / a file watcher detects new files and prompts _"file detected without matching node — create one?"_. Decision deferred until we observe how reliably the AI uses the MCP tools in practice.
- **Component-level granularity** — currently we stop at page + feature. If a need emerges, add `type: 'component'` and a third nesting level.
- **Cross-project / portfolio view** — a "workspace" canvas zoomed out across multiple projects.
- **Activity log analytics** — aggregate views of what was changed and when.
- **Remote HTTP MCP** — distribute MCP without the local Node install (requires Claude Code's HTTP MCP support to mature).

## 13. Open risks

- **AI compliance with MCP protocol.** The whole hybrid model relies on the AI consistently calling `create_node` / `update_kanban_status`. Mitigation: ship a clear `CLAUDE.md` prompt template alongside the MCP server, with explicit instructions ("at the start of any feature work, call `list_nodes` and either `create_node` or `add_kanban_task`"). If reliability is poor, accelerate the §12 hooks safety net.
- **Convex vendor lock.** Migrating away from Convex would require rewriting the data layer (it is a proprietary database). Acceptable for a personal/private tool; reassessed before any wider distribution.
- **API key leakage.** API keys grant full write access for one project. Mitigation: hash on store (bcrypt), show raw value only once at creation, allow revocation, scope to a single `projectId`.
- **Clerk free-tier ceiling.** Free tier covers 10k MAU; this is comfortably above any "invite-only multi-user" plan we have. Reassess if scope changes.
