# Repository Guidelines

## Project Structure & Module Organization

pnpm workspace pinned to Node ≥ 20 / pnpm ≥ 10.

- `apps/web` — Next.js 16 App Router UI (React 19, Tailwind 4 + shadcn, tldraw 5, Clerk). Canvas state flows through Convex reactive queries.
- `apps/mcp-server` — stdio MCP server (`@arch-viz/mcp-server`, binary `arch-viz-mcp`) that AI agents invoke. It speaks to Convex HTTP actions on `.convex.site` (not `.convex.cloud`).
- `packages/shared` — Zod schemas and types shared by both apps and Convex.
- `convex/` — schema, queries, mutations, HTTP routes. MCP-facing handlers live in `convex/mcp/`; shared HTTP helpers (auth, error mapping, cascades) in `convex/lib/`.
- `docs/superpowers/specs/` holds the design spec; `docs/superpowers/plans/` holds phase plans.

## Build, Test, and Development Commands

- `pnpm install` — install workspaces.
- `pnpm exec convex dev` + `pnpm dev` — run Convex deploy/watch and the Next.js app on `http://localhost:3000` in two terminals.
- `pnpm build` — runs `pnpm -r build` across workspaces.
- `pnpm --filter @arch-viz/mcp-server build` — compile the stdio MCP server only.
- `pnpm test` — Vitest (edge-runtime). Single file: `pnpm test -- convex/nodes.test.ts`.
- `pnpm --filter @arch-viz/web e2e` — Playwright tests under `apps/web/tests/e2e`.
- `pnpm lint` (zero warnings), `pnpm typecheck` (`tsc --noEmit` per workspace), `pnpm format` / `pnpm format:check`.

## Coding Style & Naming Conventions

TypeScript strict mode with `noUncheckedIndexedAccess` (`tsconfig.base.json`). Prettier: single quotes, semicolons, trailing commas, 100-char width, 2-space indent, LF endings. ESLint flat config (`eslint.config.mjs`) extends `@eslint/js` + `typescript-eslint` recommended; unused vars are allowed only if prefixed with `_`. `convex/_generated/`, `.next/`, `dist/`, and `*.config.*` files are linter-ignored. Workspace packages are namespaced `@arch-viz/*`.

## Testing Guidelines

Vitest runs under `edge-runtime` so Convex functions can be exercised via `convex-test`. Place backend tests next to the module as `*.test.ts` under `convex/`, `packages/`, or `apps/mcp-server/` (these globs are configured in `vitest.config.ts`). Per CLAUDE.md Rule 9, tests must encode *why* behavior matters, not just what it does — a test that can't fail when the business rule changes is wrong.

## Commit & Pull Request Guidelines

Conventional Commits with scope: `type(scope): subject` (e.g. `feat(convex): add activity.listByProject query`). Types in active use: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`. Scope names the affected area (`web`, `convex`, `mcp-server`, `readme`, `plans`, `claude`, `e2e`). CI (`.github/workflows/ci.yml`) runs `format:check`, `lint`, `typecheck`, and `test` on PRs to `main` — keep all four green locally before pushing.

## Agent Instructions

Follow CLAUDE.md's 12 rules, especially: surgical changes (Rule 3), read callers and shared utilities before writing (Rule 8), and fail loud rather than silently skipping work (Rule 12).

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
