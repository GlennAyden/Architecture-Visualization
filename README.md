# Architecture Visualization

A living architecture canvas that mirrors the structure of your project and stays in sync with AI-driven development. Each node represents a page or feature with a kanban (todo / doing / done), description, linked files, and activity log.

> **Status:** Phase 0 (setup). See `docs/superpowers/specs/2026-05-10-architecture-visualization-design.md` for the full design.

## Stack

TypeScript · Next.js (App Router) · Tailwind CSS 4 + shadcn/ui · tldraw _(Phase 1)_ · Convex · Clerk · Node MCP server _(Phase 2)_ · pnpm workspaces.

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

2. Provision Convex (first time only):

   ```bash
   pnpm dlx convex@latest dev
   ```

   Follow prompts: log in, choose **Start a new project**, name it `architecture-visualization`. This creates a `.env.local` at the repo root containing `CONVEX_DEPLOYMENT` and `CONVEX_URL`.

   Then create `apps/web/.env.local` with:

   ```
   NEXT_PUBLIC_CONVEX_URL=<value of CONVEX_URL from root .env.local>
   ```

3. Provision Clerk (first time only):
   - Create an application in https://dashboard.clerk.com.
   - Copy the publishable and secret keys into `apps/web/.env.local`. See `apps/web/.env.example` for variable names.
   - Create a JWT template named `convex` (use the Convex preset). Copy the issuer URL.
   - Set the Convex deployment env var:

     ```bash
     pnpm dlx convex env set CLERK_JWT_ISSUER_DOMAIN "https://<your-instance>.clerk.accounts.dev"
     ```

4. Run dev servers in two terminals:

   ```bash
   pnpm dlx convex dev   # backend (run from repo root)
   pnpm dev              # web app on http://localhost:3000
   ```

## Repository layout

```
apps/web          Next.js app (UI + API routes)
apps/mcp-server   Stdio MCP server (Phase 2)
packages/shared   Zod schemas, shared types
convex/           Convex backend (schema, queries, mutations, HTTP actions)
docs/             Design specs and implementation plans
```

## Scripts

| Command               | What it does                             |
| --------------------- | ---------------------------------------- |
| `pnpm dev`            | Run the Next.js web app                  |
| `pnpm dlx convex dev` | Run the Convex dev backend (from root)   |
| `pnpm lint`           | Run ESLint across the repo (flat config) |
| `pnpm typecheck`      | Run TypeScript across all workspaces     |
| `pnpm format`         | Apply Prettier formatting                |
| `pnpm format:check`   | Verify Prettier formatting               |
