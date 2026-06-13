# Architecture Visualization

A personal living architecture canvas that mirrors the structure of your project and stays in sync with AI-driven development. Each node represents a page or feature and carries a description, linked files, a kanban (todo / doing / done), and an activity log. AI coding agents (Claude Code, Codex, Cursor) update nodes over MCP as they work, so the canvas reflects reality without manual upkeep.

> **Status:** Active MVP. Core canvas, MCP sync, scan tooling, share links, collaborator invites, Hermes suggestions, and local agent hooks are implemented. The current production target is hybrid: Vercel frontend, VPS auth backend, and Convex app data.

## What's working

- Drag-create page and feature nodes on a React Flow canvas; edit per-node metadata (name, description, files, kanban, etc.) in a side modal.
- AI agents create / update / delete nodes via a stdio MCP server that calls Convex HTTP actions.
- The browser canvas updates live through Convex reactive queries, no manual refresh.
- Drill into nested nodes, run auto-layout, search with the command palette, and export project data.
- Scan imports, orphan files, and drift through the `arch-viz-mcp` CLI.
- Share read-only canvas links and invite signed-in collaborators by email.
- Every AI action is recorded in an activity log, viewable from the node modal.

## Tags timeline

`phase-0` → `phase-1a` → `phase-1b` → `phase-1c` → `phase-1d` → `ui-v1` → `phase-2a` → `phase-2b` → `phase-3`

## Stack

TypeScript · Next.js 16 (App Router) · React 19 · Tailwind CSS 4 + shadcn/ui (zinc + cyan theme) · React Flow · Convex · VPS SQLite auth · `@modelcontextprotocol/sdk` · pnpm workspaces.

## Repository layout

```
apps/web          Next.js app (UI + API routes)
apps/vps-api      VPS backend for SQLite auth/session storage and Convex JWT signing
apps/mcp-server   Stdio MCP server (Node.js)
packages/shared   Zod schemas, shared types
convex/           Schema, queries, mutations, HTTP actions; MCP internal handlers in convex/mcp/
docs/             superpowers/specs/ (design spec) and superpowers/plans/ (phase plans)
```

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 10
- A Convex account (https://convex.dev)

## Local development

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Generate auth keys for the VPS backend:

   ```bash
   pnpm --filter @arch-viz/vps-api auth:keys
   ```

   Copy the `AUTH_*` values into the VPS backend env, then run the printed
   `convex env set` commands so Convex trusts tokens from the VPS issuer.

3. Configure the web environment. Create `apps/web/.env.local` with:

   ```
   NEXT_PUBLIC_CONVEX_URL=<your Convex deployment URL>
   ARCHVIZ_AUTH_BACKEND_URL=http://127.0.0.1:8788
   ARCHVIZ_AUTH_BACKEND_TOKEN=<shared proxy token>
   AUTH_COOKIE_NAME=arch_viz_session
   ```

   Create `apps/vps-api/.env.local` or systemd environment on the VPS with:

   ```
   AUTH_SQLITE_PATH=.data/auth.sqlite
   AUTH_SESSION_DAYS=30
   ARCHVIZ_BACKEND_PROXY_TOKEN=<same shared proxy token>
   AUTH_JWT_ISSUER=http://127.0.0.1:8788
   AUTH_JWT_AUDIENCE=convex
   AUTH_JWT_PRIVATE_KEY=...
   ```

   See `apps/web/.env.example` and `apps/vps-api/.env.example` for the full
   variable lists.

4. Run dev servers in three terminals:

   ```bash
   pnpm exec convex dev   # deploys Convex functions and watches for changes
   pnpm --filter @arch-viz/vps-api dev
   pnpm dev               # Next.js web app on http://localhost:3000
   ```

5. Open http://localhost:3000. On a fresh VPS SQLite database, the app redirects
   to `/setup` so you can create the first local admin user through the web
   proxy.

## Scripts

| Command                               | What it does                                  |
| ------------------------------------- | --------------------------------------------- |
| `pnpm dev`                            | Run the Next.js web app                       |
| `pnpm test`                           | Run unit / integration tests                  |
| `pnpm test -- convex/nodes.test.ts`   | Run one Vitest file                           |
| `pnpm --filter @arch-viz/vps-api dev` | Run the VPS auth backend on `127.0.0.1:8788`  |
| `pnpm --filter @arch-viz/web e2e`     | Run Playwright tests                          |
| `pnpm --filter arch-viz-mcp build`    | Build the MCP server/CLI package              |
| `pnpm lint`                           | Run ESLint across the repo with zero warnings |
| `pnpm typecheck`                      | Run TypeScript across all workspaces          |
| `pnpm format` / `pnpm format:check`   | Apply or verify Prettier formatting           |

## MCP server

The stdio MCP server is published to npm as [`arch-viz-mcp`](https://www.npmjs.com/package/arch-viz-mcp). Wire it into your MCP client with `npx -y arch-viz-mcp` and three env vars — see [`apps/mcp-server/README.md`](apps/mcp-server/README.md). The server talks to Convex HTTP actions on `.convex.site` (not `.convex.cloud`).

## Hermes integration

Hermes Mapping Review can be started from the canvas right panel. Vercel creates
a Convex mapping run, sends bounded project/orphan context to the VPS worker,
and Convex stores the resulting action-aware suggestions for review. The legacy
Discord/CLI path can still push V1 or V2 suggestions through
`arch-viz-mcp push-suggestions --from-json <file>`. See
[`docs/hermes-integration.md`](docs/hermes-integration.md) for the run flow,
payload contract, thresholds, and security boundaries.

## VPS auth backend

The Vercel app does not open SQLite directly. It proxies `/api/auth/*` requests
to the VPS backend with `ARCHVIZ_AUTH_BACKEND_URL` and
`ARCHVIZ_AUTH_BACKEND_TOKEN`; the VPS backend stores sessions in SQLite and
signs Convex JWTs. A systemd template is available at
[`deploy/arch-viz-vps-api.service.example`](deploy/arch-viz-vps-api.service.example).

## Agent hooks

Tracked Claude Code hooks live under `.claude/hooks/`. Codex can mirror the same hook flow locally under `.codex/hooks/`, but `.codex/` is per-checkout and untracked. After file edits the hooks log activity and auto-link imports through Convex; after shell commands they can refresh post-commit node suggestions in `.arch-viz/suggestions.json`. Treat these hooks as part of the MCP/Convex sync path.

Hooks read `ARCHITECTURE_CONVEX_URL`, `ARCHITECTURE_API_KEY`, `ARCHITECTURE_PROJECT_ID` from process env first, then fall back to repo-root `.env.local`. The tracked wiring is in [`.claude/settings.json`](.claude/settings.json); local Codex wiring, when present, lives in `.codex/hooks.json`.
