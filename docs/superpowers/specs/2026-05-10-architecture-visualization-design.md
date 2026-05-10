# Architecture Visualization Tool — Design Spec

**Date:** 2026-05-10
**Status:** Approved (brainstorming phase complete)
**Owner:** akulapar2212@gmail.com

## 1. Purpose

A *living* architecture canvas that mirrors the structure of a software project and stays in sync with AI-driven development. Each node represents a page or a feature; each node carries a kanban (todo / doing / done), a description, linked files, and an activity log.

The canvas is bidirectional:

- **AI-driven** — when an AI agent (Claude Code, Codex, Cursor, etc.) creates a page, fixes a bug, or implements a feature, it updates the canvas through MCP tools. New nodes appear automatically; status flows todo → doing → done as the work progresses.
- **User-driven** — the user can drag-create nodes as planning artefacts (a page that does not yet exist in code), populate the kanban, and later have the AI implement against those plans.

The goal is to remove the gap between *what is being built*, *what has been built*, and *what is left*, without forcing manual diagram maintenance.

## 2. Scope

### In scope (MVP and near-term)

- **Single-user, hosted web app** opened in a browser (localhost first, hosted later).
- **One canvas per project** (data model: `project` 1—N `nodes`).
- **Hierarchical nodes**: `page` nodes can contain nested `feature` nodes (a feature lives inside a page; sub-canvas / drill-down view).
- **Per-node modal** with: description, linked files, kanban (todo / doing / done), activity log.
- **MCP server** as the single integration mechanism between AI agents and the canvas.
- **Real-time updates**: changes from the AI side appear in the browser canvas without manual refresh.

### Out of scope (deferred)

- Multi-tenant SaaS, billing, organizations, role-based access. (Multi-user *invite-only* may come later as Phase 4 — see §10.)
- Public sharing / publish-to-web of canvases.
- Hooks / file-watcher safety net (deferred — see §11 "Future evolution").
- Component-level node granularity (we stay at page + feature).
- Advanced canvas features (presence, multiplayer cursors, comments).

## 3. Key decisions (already approved)

| # | Decision | Choice |
|---|---|---|
| 1 | Source-of-truth direction | **Hybrid** — both AI-driven auto-update and user-driven planning |
| 2 | Form factor | **Browser-based web app**, localhost for dev, hosted later |
| 3 | User scope | **Personal first** (single user), evolve to **invite-only multi-user**, never public SaaS |
| 4 | AI integration | **MCP server** only for MVP |
| 5 | Project model | **One canvas per project** (A1) |
| 6 | Node granularity | **Page + nested feature** (B2 hierarchical) |
| 7 | Modal contents | description, linked files, kanban, activity log |
| 8 | Build approach | **Approach 1 — Lean MVP** (Next.js + Supabase + tldraw + stdio MCP) |
| 9 | Canvas library | **tldraw** (matches early sketch, mature custom-shape API) |
| 10 | Auth provider | **Supabase Auth**, magic link (passwordless) |
| 11 | MCP transport | **stdio** (universal across Claude Code, Codex, Cursor) |
| 12 | Package manager | **pnpm** (workspace-friendly) |

## 4. High-level architecture

```
┌─────────────── User's local machine ────────────────┐
│  ┌────────────┐     ┌────────────────────────┐     │
│  │ Claude Code│────►│ Local MCP server (Node)│     │
│  │ Codex/etc  │stdio│  exposes tools to AI    │     │
│  └────────────┘     └─────────┬───────────────┘     │
│  ┌──────────────────────────┐ │ HTTPS + Bearer     │
│  │ Browser (canvas UI)      │ │                    │
│  └────────────┬─────────────┘ │                    │
└───────────────┼───────────────┼────────────────────┘
                ▼               ▼
       ┌────── Hosted (Vercel + Supabase) ──────┐
       │  Next.js (App Router): UI + /api/*     │
       │  Supabase: Postgres + Auth + Realtime  │
       └────────────────────────────────────────┘
```

Two clients talk to one backend:

- **Browser** — renders the canvas, modals, and kanban. Reads via REST + Supabase Realtime subscription. Writes via REST.
- **Local MCP server** — bridges AI ↔ backend. Writes via REST using a per-user API token bound to a project ID. Does not talk to Supabase directly; everything goes through the Next.js API so the same authorization layer applies to both clients.

## 5. Components

### 5.1 Web app — Next.js (App Router)

**Routes (UI):**
- `/(app)/projects` — list, create, delete projects
- `/(app)/canvas/[projectId]` — main tldraw canvas with custom shapes
- `/(app)/settings/tokens` — generate/revoke MCP API tokens

**Routes (API):**
- `POST/GET/PATCH/DELETE /api/v1/projects[/:id]`
- `POST/GET/PATCH/DELETE /api/v1/nodes[/:id]`
- `POST/GET/PATCH/DELETE /api/v1/kanban[/:id]`
- `POST /api/v1/activity` (append-only log)
- `POST /api/v1/auth/token` — issue API tokens for MCP

**Auth:** Supabase Auth with email magic link. One user for MVP; row-level security policies are written from day 1 so flipping to multi-user later (Phase 4) requires no rearchitecture.

### 5.2 Local MCP server — Node.js, stdio

Distributed as a CLI: `npx @arch-viz/mcp-server` (final package name TBD before Phase 2).

Configured in the user's MCP config (e.g. `claude_desktop_config.json`, `.codex/mcp.json`) with environment variables:

- `ARCHITECTURE_API_BASE_URL` — base URL of the hosted Next.js app (or `http://localhost:3000` during dev)
- `ARCHITECTURE_API_TOKEN` — long-lived bearer token issued in `/settings/tokens`
- `ARCHITECTURE_PROJECT_ID` — which project this MCP instance writes to

**Tools exposed:**

| Tool | Inputs | Purpose |
|---|---|---|
| `list_nodes` | — | AI reads current canvas state (essential for hybrid mode) |
| `get_node` | `id` | Drill into one node + kanban + files |
| `create_node` | `type: 'page' \| 'feature'`, `name`, `parent_id?`, `description?`, `files?[]`, `position?` | Create node (uses `parent_id` for nested features) |
| `update_node` | `id`, partial fields | Update name / description / metadata / position |
| `delete_node` | `id` | Cascade delete |
| `link_files` | `node_id`, `paths: string[]` | Attach file paths to a node |
| `add_kanban_task` | `node_id`, `title`, `description?`, `status: 'todo' \| 'doing' \| 'done'` | Add a kanban task |
| `update_kanban_status` | `task_id`, `status` | Move task across columns |
| `log_activity` | `node_id`, `message`, `metadata?` | Append to activity log |

Errors are typed and contain self-correction hints, e.g. *"Project not found. Verify `ARCHITECTURE_PROJECT_ID` matches an existing project."*

### 5.3 Database schema (Postgres on Supabase)

```
profiles      (id uuid pk, email, created_at)

projects      (id uuid pk, user_id fk profiles, name, slug,
               created_at, updated_at)

nodes         (id uuid pk, project_id fk projects,
               parent_id fk nodes nullable,           -- nested features (B2)
               type text,                              -- 'page' | 'feature'
               name, description,
               position_x int, position_y int,
               metadata jsonb,                         -- tech stack etc.
               created_at, updated_at)

node_files    (id uuid pk, node_id fk nodes, path text,
               created_at)

kanban_tasks  (id uuid pk, node_id fk nodes,
               title, description,
               status text,                            -- 'todo' | 'doing' | 'done'
               position int,
               created_at, updated_at)

activity_log  (id uuid pk, node_id fk nodes,
               actor text,                             -- 'user' | 'mcp:claude-code' | 'mcp:codex' | …
               message text,
               metadata jsonb,
               created_at)

api_tokens    (id uuid pk, user_id fk profiles,
               name text,                              -- user-friendly label
               token_hash text,                        -- bcrypt hash, never store raw
               last_used_at, created_at, revoked_at)
```

Row-level security is enabled on every user-owned table from day 1, with policies keyed off `auth.uid() = user_id` (directly or via the `project_id → user_id` join). For MVP there is one user, so policies effectively no-op; for Phase 4 they activate without changes.

### 5.4 Realtime sync

- The browser subscribes to a Supabase Realtime channel filtered by `project_id` for the tables `nodes`, `kanban_tasks`, and `activity_log`.
- When the MCP server writes to the DB through the API, Realtime broadcasts the change → the browser updates the tldraw canvas / open modal without a manual refresh.
- Browser-originated edits (drag a shape, rename, edit a kanban task) apply optimistically locally, send a REST request, and reconcile on the Realtime echo using `updated_at` for idempotence.
- If the Realtime connection drops, the browser falls back to polling the affected resources every 10 seconds until reconnect.

## 6. Data flow examples

### A) AI creates a new feature (canvas auto-update)

1. User: *"Claude, add a Settings page."*
2. AI calls MCP `create_node({ type: 'page', name: 'Settings' })`.
3. MCP → `POST /api/v1/nodes` with bearer token → Supabase insert.
4. Supabase Realtime → browser → tldraw renders the new shape.
5. AI calls `add_kanban_task({ status: 'doing', title: 'Build settings form' })`.
6. AI completes implementation → `update_kanban_status({ status: 'done' })` and `log_activity({ message: 'Implemented settings form with theme toggle' })`.
7. The user, watching the browser, sees node and kanban progress live.

### B) User plans a feature in the canvas (canvas-driven)

1. User drag-creates a node "Notifications" in tldraw → `POST /api/v1/nodes`.
2. User opens the modal, fills description, adds three kanban tasks (all `todo`).
3. Later the user prompts the AI: *"Implement the Notifications page from the canvas."*
4. AI calls `list_nodes` → finds the node, reads its kanban, executes them in order, updating status as it goes.

### C) AI fixes a bug (status tracking)

1. AI investigates, calls `add_kanban_task({ status: 'doing', title: 'Fix null pointer in date parser' })` on the affected node.
2. After fixing, `update_kanban_status({ status: 'done' })` and `log_activity({ message: 'Fixed null pointer in date parsing — input now defaults to ISO 8601 when missing' })`.
3. The node modal shows the activity log and a moved-to-done task.

## 7. Error handling

- **MCP server**: typed errors with self-correction hints. Examples:
  - *"Project not found. Verify `ARCHITECTURE_PROJECT_ID`."*
  - *"Node parent_id refers to a node in a different project."*
  - *"Token revoked or expired. Generate a new one in /settings/tokens."*
- **Browser**: optimistic updates with rollback on REST 4xx/5xx; user-visible toast on failure.
- **Realtime drop**: fallback polling every 10s until reconnect.
- **Auth**: missing/invalid token → 401 → MCP returns a clear error to the AI.
- **DB**: foreign keys with `ON DELETE CASCADE` so deleting a project removes its nodes, kanban tasks, files, and activity log.

## 8. Testing strategy

- **Unit (Vitest)** — API route handlers, MCP tool handlers, Zod schema validators.
- **Integration** — Supabase test branch; full round-trip `POST /api/v1/nodes` → DB insert → Realtime broadcast → consumer assertion.
- **E2E (Playwright)** — open canvas, drag-create a node, edit modal kanban, simulate an MCP call and confirm the canvas updates live.
- **MCP smoke test** — spawn the MCP server with a test API token and exercise each tool over stdio.

## 9. Repository structure

```
architecture-visualization/
├── apps/
│   ├── web/              # Next.js app (UI + API routes)
│   └── mcp-server/       # stdio MCP server, published to npm
├── packages/
│   └── shared/           # Zod schemas, TypeScript types, shared between web and mcp-server
├── supabase/
│   ├── migrations/
│   └── seed.sql
├── docs/
│   └── superpowers/specs/
└── pnpm-workspace.yaml
```

A monorepo (pnpm workspaces) lets the MCP server share types and Zod schemas with the web app, so the request/response contract has one definition.

## 10. Phased rollout

| Phase | Scope | Estimate |
|---|---|---|
| **0 — Setup** | Monorepo, Supabase project, Next.js scaffold, initial migrations, CI lint/typecheck | 1–2 days |
| **1 — MVP UI** | Supabase Auth (magic link), project CRUD, tldraw canvas, drag-create page nodes, per-node modal (description, files, kanban CRUD), API token generation page | 3–5 days |
| **2 — MCP integration** | `mcp-server` package with all tools, REST endpoints they call, end-to-end test using Claude Code against a localhost API | 3–5 days |
| **3 — Polish** | Activity log UI, nested feature nodes (B2 hierarchy with drill-down), Supabase Realtime sync, deploy to Vercel + Supabase prod | 3–5 days |
| **4 (later) — Multi-user** | Activate RLS for true multi-user, invite flow, per-user MCP tokens isolated by user_id | 2–3 days |

## 11. Future evolution (deferred)

- **Hooks + file-watcher safety net** — if the AI forgets to call `create_node`, a local hook on Claude Code post-tool / a file watcher detects new files and prompts *"file detected without matching node — create one?"*. Decision deferred until we observe how reliably the AI uses the MCP tools in practice.
- **Component-level granularity** — currently we stop at page + feature. If a need emerges, add `type: 'component'` and a third nesting level.
- **Cross-project / portfolio view** — a "workspace" canvas zoomed out across multiple projects.
- **Activity log analytics** — aggregate views of what was changed and when.

## 12. Open risks

- **AI compliance with MCP protocol.** The whole hybrid model relies on the AI consistently calling `create_node` / `update_kanban_status`. Mitigation: ship a clear `CLAUDE.md` prompt template alongside the MCP server, with explicit instructions ("at the start of any feature work, call `list_nodes` and either `create_node` or `add_kanban_task`"). If reliability is poor, accelerate the §11 hooks safety net.
- **Realtime cost / connection limits** at the Supabase free tier if the user keeps many tabs open. Mitigation: subscribe per-project, not globally; close subscriptions on tab visibility hidden.
- **Token leakage.** API tokens have full write access for one project. Mitigation: hash on store, show once on creation, allow revocation, scope to one `project_id`.
