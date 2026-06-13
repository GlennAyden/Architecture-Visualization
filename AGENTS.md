# Repository Guidelines

## Project Structure & Module Organization

pnpm workspace pinned to Node >= 20, pnpm >= 10.

- `apps/web` - Next.js 16 App Router UI (React 19, Tailwind 4 + shadcn, React Flow). Canvas state flows through Convex reactive queries; auth routes proxy to the VPS backend.
- `apps/vps-api` - Node HTTP backend for Local/VPS mode. Owns SQLite users/sessions, signs Convex custom JWTs, and is only called by the web app through a backend proxy token.
- `apps/mcp-server` - unscoped package `arch-viz-mcp`, binary `arch-viz-mcp`; stdio MCP server plus scan CLI for AI agents. It calls Convex HTTP actions on `.convex.site`, not `.convex.cloud`.
- `packages/shared` - Zod schemas and types shared by the web app, MCP server, and Convex.
- `convex/` - schema, queries, mutations, HTTP routes. MCP-facing handlers live in `convex/mcp/`; shared HTTP helpers live in `convex/lib/`.
- `docs/superpowers/specs/` holds the design spec; `docs/superpowers/plans/` holds phase plans.

## Build, Test, and Development Commands

- `pnpm install` - install workspaces.
- `pnpm exec convex dev` + `pnpm dev` - run Convex deploy/watch and the Next.js app on `http://localhost:3000` in two terminals.
- `pnpm build` - runs `pnpm -r build` across workspaces.
- `pnpm --filter arch-viz-mcp build` - compile the MCP server/CLI only.
- `pnpm test` - run Vitest under `edge-runtime`; single file: `pnpm test -- convex/nodes.test.ts`.
- `pnpm --filter @arch-viz/web e2e` - run Playwright tests under `apps/web/tests/e2e`.
- `pnpm lint`, `pnpm typecheck`, `pnpm format`, and `pnpm format:check` - repo quality gates.

## Coding Style & Naming Conventions

TypeScript strict mode with `noUncheckedIndexedAccess` is set in `tsconfig.base.json`. Prettier uses single quotes, semicolons, trailing commas, 100-character width, 2-space indent, and LF endings. ESLint flat config (`eslint.config.mjs`) extends `@eslint/js` + `typescript-eslint` recommended; unused variables are allowed only when prefixed with `_`. Lint ignores include `convex/_generated/`, `.next/`, `dist/`, and `*.config.*`. Workspace packages are `@arch-viz/web`, `@arch-viz/shared`, and unscoped `arch-viz-mcp`.

## Testing Guidelines

Vitest includes `convex/**/*.test.ts`, `packages/**/*.test.ts`, `apps/mcp-server/**/*.test.ts`, and focused web auth tests, with Convex modules exercised through `convex-test`. Per `CLAUDE.md` Rule 9, tests must encode why behavior matters, not just what happened.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commits with scopes, for example `feat(canvas): ...` and `fix(deploy): ...`. Active types include `feat`, `fix`, `refactor`, `chore`, `docs`, and `test`; scopes name the affected area (`web`, `convex`, `mcp-server`, `readme`, `plans`, `claude`, `e2e`). CI (`.github/workflows/ci.yml`) runs `format:check`, `lint`, `typecheck`, and `test` on pushes and PRs to `main`.

## Agent Instructions

Follow `CLAUDE.md`'s 12 rules, especially surgical changes, reading callers/shared utilities before writing, and failing loud. Do not change tracked `.claude/hooks` or local `.codex/hooks` mirrors without verifying the MCP/Convex activity, auto-link, and post-commit suggestion flows they trigger. For Convex code, read `convex/_generated/ai/guidelines.md` first.
