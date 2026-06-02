# Architecture Visualization

A personal living architecture canvas that mirrors the structure of your project and stays in sync with AI-driven development. Each node represents a page or feature and carries a description, linked files, a kanban (todo / doing / done), and an activity log. AI coding agents (Claude Code, Codex, Cursor) update nodes over MCP as they work, so the canvas reflects reality without manual upkeep.

> **Status:** Active MVP. Core canvas, MCP sync, scan tooling, share links, collaborator invites, and local agent hooks are implemented. Production deploy (Vercel + Convex prod) is deferred.

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

TypeScript · Next.js 16 (App Router) · React 19 · Tailwind CSS 4 + shadcn/ui (zinc + cyan theme) · React Flow · Convex · Clerk · `@modelcontextprotocol/sdk` · pnpm workspaces.

## Repository layout

```
apps/web          Next.js app (UI + API routes)
apps/mcp-server   Stdio MCP server (Node.js)
packages/shared   Zod schemas, shared types
convex/           Schema, queries, mutations, HTTP actions; MCP internal handlers in convex/mcp/
docs/             superpowers/specs/ (design spec) and superpowers/plans/ (phase plans)
```

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 10
- A Convex account (https://convex.dev)
- A Clerk account (https://clerk.com)

## Local development

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Configure environment. Create `apps/web/.env.local` with:

   ```
   NEXT_PUBLIC_CONVEX_URL=<your Convex deployment URL>
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
   CLERK_SECRET_KEY=...
   ```

   See `apps/web/.env.example` for the full variable list.

3. Set the Convex deployment env var (one-time):

   ```bash
   pnpm exec convex env set CLERK_JWT_ISSUER_DOMAIN "https://<your-instance>.clerk.accounts.dev"
   ```

4. Run dev servers in two terminals:

   ```bash
   pnpm exec convex dev   # deploys Convex functions and watches for changes
   pnpm dev               # Next.js web app on http://localhost:3000
   ```

5. Open http://localhost:3000.

## Scripts

| Command                             | What it does                                  |
| ----------------------------------- | --------------------------------------------- |
| `pnpm dev`                          | Run the Next.js web app                       |
| `pnpm test`                         | Run unit / integration tests                  |
| `pnpm test -- convex/nodes.test.ts` | Run one Vitest file                           |
| `pnpm --filter @arch-viz/web e2e`   | Run Playwright tests                          |
| `pnpm --filter arch-viz-mcp build`  | Build the MCP server/CLI package              |
| `pnpm lint`                         | Run ESLint across the repo with zero warnings |
| `pnpm typecheck`                    | Run TypeScript across all workspaces          |
| `pnpm format` / `pnpm format:check` | Apply or verify Prettier formatting           |

## MCP server

The stdio MCP server is published to npm as [`arch-viz-mcp`](https://www.npmjs.com/package/arch-viz-mcp). Wire it into your MCP client with `npx -y arch-viz-mcp` and three env vars — see [`apps/mcp-server/README.md`](apps/mcp-server/README.md). The server talks to Convex HTTP actions on `.convex.site` (not `.convex.cloud`).

## Hermes integration

Hermes can push file-to-layer suggestions into the canvas through the MCP HTTP route and `arch-viz-mcp push-suggestions --from-json <file>`. See [`docs/hermes-integration.md`](docs/hermes-integration.md) for the V1 contract, auth header, payload format, auto-apply threshold, and boundaries.

## Agent hooks

Tracked Claude Code hooks live under `.claude/hooks/`. Codex can mirror the same hook flow locally under `.codex/hooks/`, but `.codex/` is per-checkout and untracked. After file edits the hooks log activity and auto-link imports through Convex; after shell commands they can refresh post-commit node suggestions in `.arch-viz/suggestions.json`. Treat these hooks as part of the MCP/Convex sync path.

Hooks read `ARCHITECTURE_CONVEX_URL`, `ARCHITECTURE_API_KEY`, `ARCHITECTURE_PROJECT_ID` from process env first, then fall back to repo-root `.env.local`. The tracked wiring is in [`.claude/settings.json`](.claude/settings.json); local Codex wiring, when present, lives in `.codex/hooks.json`.
