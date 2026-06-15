# Architecture Visualization — Roadmap (Sprints 1–5)

> **Status snapshot:** All 5 sprints shipped 2026-05-12 (item J of Sprint 5
> deferred per roadmap). Sprint 3 npm publish still held back — `arch-viz-mcp`
> v0.3.0 in package.json, not on npm.
> Author: Claude Code session, 2026-05-12.

This is the operating roadmap. Each sprint section is self-contained enough to
hand off to a fresh contributor (human or agent) without needing to read the
session transcript that produced it. Read the **Background** section first,
then jump to whichever sprint you're picking up.

---

## Background — what this project is

**Architecture Visualization** is a personal "living architecture canvas" that
mirrors the structure of a software project and stays in sync with AI-driven
development. The premise: as Claude Code (or Codex, or Cursor) edits a
codebase, those agents simultaneously update a tldraw canvas via an MCP
server. The canvas becomes a high-fidelity, always-current architecture
diagram that you can use to navigate, plan, and onboard others — without the
hand-maintenance that kills most architecture docs.

### Stack at a glance

| Layer           | Tech                                                 | Notes                                                                       |
| --------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| Web UI          | Next.js 16 App Router, React 19, Tailwind 4 + shadcn | tldraw 5 for canvas, Clerk for auth                                         |
| Realtime / data | Convex                                               | Reactive queries; HTTP actions on `.convex.site` (NOT `.convex.cloud`)      |
| MCP server      | Node ≥18, `@modelcontextprotocol/sdk` 1.29           | Published as `arch-viz-mcp` on npm                                          |
| Shared          | `packages/shared` Zod schemas + type constants       | One source of truth for inputs                                              |
| Hosting         | Vercel (Next.js) + Convex prod                       | `architecture-visualization.vercel.app`, `honorable-viper-174.convex.cloud` |
| Auth (MCP)      | SHA-256 hashed API tokens, scoped per project        | Generated at `/settings/tokens`                                             |

### Domain model

- **Project** — top-level container, one per software project a user is tracking.
- **Node** — a page or feature. `type: 'page' | 'feature'`. Page nodes are top-level; feature nodes nest under a page via `parentId`.
- **Linked files** — each node has 0..N file paths (`nodeFiles.path`) pointing at source files in the actual repo.
- **Kanban task** — each node has a small kanban (`todo` / `doing` / `done`).
- **Activity log** — every meaningful change appends an entry attributed to an `actor` (e.g. `mcp:claude-code`, `hook:claude-code`, or the user).
- **Edges** (added Sprint 1) — directed edges between nodes. Multi-type from day one: `hierarchy` (mirrored from `parentId`), `dependency`, `navigation`, `data_flow`. Only `hierarchy` is auto-populated as of Sprint 1; the rest are reserved.

### The 9 MCP tools the AI uses

`list_nodes`, `get_node`, `create_node`, `update_node`, `delete_node`,
`link_files`, `add_kanban_task`, `update_kanban_status`, `log_activity`.
There is also `log_by_file` (used internally by hooks, not exposed as an MCP
tool yet).

### What's already shipped (pre-Sprint 1)

1. Phase 0–3: schema, projects, canvas with page + feature shapes, modal with
   Description/Files/Kanban/Activity tabs, API tokens, MCP server (stdio),
   project activity feed, "Add feature" UI, activity tab in modal.
2. Item A — Real Claude Code session test (validated end-to-end; AI follows
   MCP instructions cleanly, no hallucination, no flakiness).
3. Item B — Production deploy. Vercel + Convex prod live.
4. Item C — `arch-viz-mcp` published on npm. `npx -y arch-viz-mcp` works for
   anyone with a token.
5. Item E — Activity log archival cron. Daily 03:00 UTC, deletes entries
   older than 90 days, capped at 500 per run.
6. Item G — Claude Code hook (`.claude/hooks/log-activity.mjs`). Auto-appends
   activity entries to whichever node has the edited file linked. Silent
   no-op when the file isn't linked or env is missing.
7. **Sprint 1 (shipped 2026-05-12):**
   - A.1 hierarchy arrows: `nodeEdges` table + auto-mirror from `parentId`,
     tldraw arrow bindings on the canvas.
   - B1 `/arch-init` slash command: filesystem-heuristic codebase scanner
     that bulk-populates nodes from a fresh repo.
8. **Sprint 2 (shipped 2026-05-12):**
   - Item D — Auto-link by import analysis. `POST /api/mcp/files/auto_link`
     route + `convex/mcp/files.ts:autoLinkByOrigin` internal mutation.
     `apps/mcp-server/src/cli/scan-imports.ts` walks linked files with
     `ts-morph`, batches calls. `.claude/hooks/auto-link-imports.mjs`
     sibling hook (regex parser, cap 20 imports per Edit/Write fire,
     foreground per-edit per Open Question #1 decision).
   - Item E — Orphan detector. `arch-viz-mcp scan-orphans` walks repo
     source files, diffs against linked set, pushes a `scanSnapshots`
     row (option-2 push-to-table per the roadmap). New UI page
     `/canvas/<projectId>/orphans` with filter + link-to-node modal.
   - Item F — Drift detection. `arch-viz-mcp scan-drift` checks
     `fs.existsSync` per linked path, basename-rename heuristic.
     Drift tab (5th) in node modal with count badge; per-row actions:
     delete link / archive (set `nodeFiles.archived = true`) / adopt
     rename for `renamed_candidate` entries.
   - Backend: `scanSnapshots` table + `nodeFiles.archived?` optional
     field. 3 new HTTP routes (`/auto_link`, `/scans/push` with 1MB
     cap, `/scans/get_latest`). Shared Zod validators in
     `packages/shared/src/mcp.ts`.
   - 23 new vitest cases (138 → 161 total pass).
   - `arch-viz-mcp` v0.2.0 published to npm — adds CLI subcommand
     dispatch alongside the existing stdio MCP path. ts-morph kept
     entirely inside `cli/*` (lazy-loaded, never enters the stdio
     hot path).
   - Convex prod deployed (`scanSnapshots.by_project_kind` index
     added; no destructive schema changes).
9. **Sprint 3 (shipped 2026-05-12 — npm publish held back):**
   - Schema: `nodeEdges.source: 'auto' | 'manual'` (optional, default
     'auto') + new index `by_project_type`. Manual edges survive scan
     reconciliations; auto edges are owned by the CLI scanner.
   - 2 new MCP tools: `link_nodes(source, target, type)` and
     `unlink_nodes(source, target, type)`. Hierarchy edges are not
     accessible through either — they remain auto-mirrored from
     `parentId`. `update_node` now accepts `metadata` (merge semantics)
     so AI can populate `metadata.route` / `metadata.apiPaths` per node.
   - 3 new HTTP routes (`/api/mcp/edges/{link,unlink,reconcile}`).
     Reconcile diff is per (projectId, type) — partial emits in a
     single type bucket would delete rows the scan didn't cover, so
     the CLI MUST emit the full per-type list each run.
   - CLI: `arch-viz-mcp scan-imports` extended with three walkers
     under `apps/mcp-server/src/cli/walkers/*.ts`:
     - dependency — origin file's owning node(s) → imported file's
       owning node(s).
     - navigation — JSX `<Link href="/...">` + `router.push('/...')`
       (+ `redirect`) string literals matched against node
       `metadata.route` (exact).
     - data_flow — `fetch('/api/...')` string literals + Convex
       `useMutation(api.foo.bar)` / `useQuery` / `useAction` calls
       (canonical apiPaths form is the dotted path AFTER the `api.`
       prefix). Plain `convexClient.mutation(api.x.y)` also matched.
   - `--skip-edges` flag for development. Reconcile cap 2000 edges.
     Single batched call covers all three types.
   - UI: `apps/web/hooks/use-canvas-sync.ts` renders edges with
     distinct tldraw arrow styles per type — `EDGE_STYLE_BY_TYPE`
     map is exhaustive against the schema enum (would fail typecheck
     if a type lands without a style). Hierarchy edges are NOT
     user-deletable via canvas (un-delete + skip the mutation);
     dependency / navigation / data_flow can be deleted by the user
     in tldraw, calling the new `api.nodeEdges.remove` mutation.
   - 27 new tests (161 → 186 total). 11 walker tests, 11 edge HTTP
     tests, 3 `nodeEdges.remove` tests, 2 `update_node metadata`,
     plus a CLI flag parse test.
   - Deploy: Convex prod live with `nodeEdges.by_project_type` index
     added. `arch-viz-mcp@0.3.0` built locally but publish to npm
     held back by user (will publish later via manual `pnpm publish`).
   - Weekly reconcile cron NOT shipped — Convex cron runs server-side
     without filesystem access, so it cannot run the scanner. The
     hook (Sprint 2) plus manual `scan-imports` runs cover the gap.
10. **Sprint 4 (shipped 2026-05-12):**
    - Schema: `shareTokens` (per-project tokenHash + name + optional
      revokedAt / expiresAt) and `projectMembers` (per-project membership
      with invitedAt + optional acceptedAt). Both cascade-delete with
      `projects.remove`, which also picked up the long-missing cascade
      for `scanSnapshots` (Sprint 2 left it orphaned).
    - Auth refactor: `requireOwnership(ctx, projectId)` separated from
      `requireProjectAccess(ctx, projectId)`. The former gates owner-only
      operations (project delete, apiToken create, share / member
      management); the latter accepts owner OR accepted member. Lenient
      read helpers renamed `getProjectIfOwned` → `getProjectIfAccessible`
      (member-inclusive) across all 8 caller files.
    - `convex/shareTokens.ts`: create / revoke / listByProject + raw
      token reveal-once flow. Owner-only minting + revoke; revoked +
      expired tokens stop resolving.
    - `convex/projectMembers.ts`: invite (by email) / accept / decline /
      revoke / listByProject / listInvitesForCurrentUser. Cap of 3
      members per project (pending + accepted combined). Invite fails
      cleanly when the target email has no Convex profile yet.
    - `convex/shareView.ts`: public lenient queries `get(rawToken)` and
      `getNodeDetail(rawToken, nodeId)` — no Clerk identity required.
      Sanitized payload (only nodes / edges / per-node files / kanban /
      activity); never surfaces apiTokens, members, or owner email.
    - `projects.list` now returns rows with `role: 'owner' | 'member'`
      and includes accepted-member projects in the user's list.
    - UI (owner-side): `/settings/share` and `/settings/members` pages
      mirroring `/settings/tokens` layout. Native radio expiration
      picker (Never / 7d / 30d / Custom). Cap notice (`X / 3 members`).
      Invite banner on `/projects` for pending invites with Accept /
      Decline buttons. "Member" pill + hidden owner-only menu on member
      rows in the project list. New cross-links from `/settings/tokens`
      to the two new pages.
    - UI (public): `/share/[token]` route (Clerk `proxy.ts` matcher
      exempt). Read-only tldraw canvas via new `useShareCanvasSync` hook
      (one-way reconcile, no `editor.store.listen`, no echo guard).
      Read-only `ShareNodeModal` reusing existing Dialog + Tabs
      primitives. Tldraw read-only mode set via
      `editor.updateInstanceState({ isReadonly: true })`.
    - Tests: +17 new vitest cases (186 → 203). 6 share-token cases
      (round-trip, revoke, expire, owner-only, unknown-token-null,
      sanitized-payload). 11 projectMembers cases (invite/accept,
      pending-no-access, accepted-can-edit, owner-only-delete,
      no-tokens-for-members, unknown-email, duplicate-invite,
      cap-enforced, only-invitee-accepts, cascade, revoke-ends-access).
      Tests encode WHY per Rule 9.
    - Deploy: Convex prod live with 5 new indexes
      (`shareTokens.{by_project, by_hash}`,
      `projectMembers.{by_project, by_user, by_project_user}`). No
      breaking changes — only additive tables + optional field
      tightening on the auth split (member access path is strictly
      additive; existing owners keep working).
    - `arch-viz-mcp` package untouched in Sprint 4 (no new CLI / MCP
      tools). Web app only.
11. **Sprint 5 (shipped 2026-05-12 — item J deferred):**
    - Item C — drill-down sub-canvas. New `apps/web/store/drill-store.ts`
      (Zustand mirror of modal-store) holding `drillNodeId` + a
      `childrenByParentId` map. Double-clicking a page node that HAS
      children drills in; leaves and feature nodes still open the modal
      (conditional dispatch in both shape utils, reads from the store).
      `useCanvasSync` filters nodes / edges to `{drill root} ∪ descendants`
      when drill is active. Breadcrumb bar appears below the canvas
      header: Home → ancestor → … → current, plus `× Exit`. Global
      Escape exits drill. Drill state resets on `projectId` change.
      Auto zoom-to-fit on every drill-state flip (200ms anim).
    - Item F — Cmd-K / Ctrl-K command palette. New
      `apps/web/components/canvas/command-palette.tsx`. Global window
      keybinding ignores inputs / textareas / contenteditables when
      closed. Substring match on node names, exact-prefix ranks first;
      empty query shows 10 most-recent. Keyboard nav + auto-scroll on
      highlight. Selection centers the canvas via `editor.centerOnPoint`
      - opens the node modal.
    - Item H — Mini-map + auto-fit-on-first-load. Tldraw 5's
      `DefaultMinimap` plumbed into `<Tldraw components={{Minimap}} />`
      (its `null` default replaced). New effect tracks
      `autoFittedFor: projectId` ref; first nodes-loaded render after
      a `projectId` change runs `editor.zoomToFit()` once.
    - Item S — Data export. Backend `convex/exports.ts:exportProject`
      public query returns a versioned (`schemaVersion: 1`) full
      snapshot — project meta + nodes (with files / kanban / activity
      joined) + edges. Lenient on access: owner OR member can export
      (members get the same view they see in the canvas). New
      `ExportProjectButton` in the canvas header gates the query with
      `'skip'` until clicked, then builds a Blob and triggers a
      `download` anchor for `<slug>-YYYYMMDD.json`. Auto-cleans the
      anchor + revokes the object URL. Null-access surface as inline
      `text-destructive` for 5s.
    - Item J — DEFERRED. AI-suggests-new-nodes-post-commit needs deeper
      Claude Code integration (system-reminder injection or a slash
      command to surface suggestions) than a single hook can deliver.
      Captured as future-iteration scope.
    - 3 new vitest cases for exports (206/206 total; export round-trip,
      member-can-export, stranger-null).
    - Deploy: Convex prod live. No new indexes (exports is a query
      over existing tables). No schema changes.

---

## Strategic decisions (the four forks)

Before Sprint 1 started, the user picked the following four directions. Every
sprint below assumes these are still true; if the user changes their mind,
re-read the implications.

### 1. Target end-user — **Aku + 2-3 teman dekat (private)**

- Multi-user / invite features ARE in scope (Sprint 4).
- Public-grade polish, RBAC, billing, marketing site — NOT in scope.
- Mobile support is "decent if cheap, skip if expensive".
- Onboarding docs target small private group, not random discovery.

### 2. Sync strictness — **Strict (canvas must match code reality)**

- Auto-link by import analysis is **mandatory** (Sprint 2 item D).
- Orphan file detector is **mandatory** (Sprint 2 item E).
- Drift detection (file in `nodeFiles` deleted/renamed on disk) is **mandatory** (Sprint 2).
- Hook coverage already in place (item G) is necessary but not sufficient — we need server-side reconciliation too.

### 3. Arrow semantics — **Multi-type (hierarchy / dependency / navigation / data_flow)**

- Schema already supports all four types from Sprint 1.
- Sprint 3 adds the three non-hierarchy types.
- Visual style differs per type (Sprint 3 details).

### 4. `/arch-init` scope — **Generic filesystem heuristic**

- Already shipped in Sprint 1.
- No framework special-casing (no Next.js, Convex, Django, etc. knowledge).
- Trade-off accepted: less accurate on any given stack, but portable to every
  stack.

---

## Cross-cutting conventions

These apply to every sprint. Don't re-derive them per task.

- **Convex deployments:** dev is `dazzling-seahorse-444`, prod is `honorable-viper-174`. HTTP routes are at `.convex.site`, NOT `.convex.cloud`. Forgetting this costs ~30 min every time.
- **Function call style:** every new MCP HTTP route uses `withMcpRoute({ input, run })` in `convex/http.ts`. Don't roll your own auth + parse pipeline.
- **Internal vs public:** AI-facing handlers go in `convex/mcp/*` and are `internalMutation` / `internalQuery`. The UI-facing copies live in the root `convex/*.ts` files and are `mutation` / `query`. They have similar bodies but different auth (token-scoped vs Clerk identity).
- **Validators:** shared between UI/MCP/HTTP via `packages/shared/src/mcp.ts` Zod schemas. Use `.strict()` and tight bounds (length caps, regex where useful).
- **Tests:** every backend change ships a `*.test.ts` next to the module. Vitest under edge-runtime, `convex-test` for ctx. Tests must encode WHY behavior matters (CLAUDE.md Rule 9), not just WHAT it does.
- **Activity log:** any meaningful state change should append an `activityLog` row with a sensible `actor`. AI uses `mcp:claude-code`, hooks use `hook:claude-code`, user actions use `user`.
- **Hooks safety:** the hook script must NEVER block Claude Code's tool pipeline. Swallow every error, exit 0. Logging failure is a worse outcome than no logging.
- **Permission boundaries:** every read/write checks token scope (project-id match) or Clerk ownership (`requireProjectAccess` / `requireOwnership`). Lenient queries (return `[]` on no auth) for UI views; strict throws for mutations.
- **Schema migrations:** Convex doesn't have explicit migrations. Add new optional fields freely. For new tables, deploy schema first, then a separate `internalMutation` for backfill, then call via `npx convex run`.

---

## Sprint 1 — **SHIPPED ✅** (Hierarchy arrows + `/arch-init`)

Documented here for completeness. See commit `<short-sha>` on `main` (feat(canvas):
hierarchy arrows + /arch-init slash command).

### What got built

- `nodeEdges` table with multi-type enum.
- `convex/lib/edges.ts` — `ensureHierarchyEdge`, `removeEdgesForNode`.
- Edge insert in both `nodes.create` (UI path) and `mcp.nodes.createForProject` (AI path).
- Edge cascade in `deleteNodeCascade`.
- `convex/nodeEdges.ts` — public `listByProject` (lenient) + internal `backfillHierarchy`.
- `useCanvasSync` extended to render tldraw arrow shapes with bindings.
- `.claude/commands/arch-init.md` slash command.
- 6 new vitest cases (131/131 total pass).
- Backfilled dev (1 edge created); prod was empty.

### Verification status

- Backend tests pass.
- Typecheck passes across 4 workspaces.
- Frontend visual verification = **manual TODO** (user runs `pnpm dev` and looks).
- `/arch-init` runtime test = **manual TODO** (requires Claude Code restart to load slash commands).

---

## Sprint 2 — **SHIPPED ✅** (Strict sync foundation)

> See commit on `main` (feat(sprint-2): strict sync — auto-link + orphan
> detector + drift detection). v0.2.0 of `arch-viz-mcp` on npm.
> Open Question #1 resolved: foreground per-edit hook. ts-morph used for
> the CLI; regex parser in the hook. Sibling hook file (NOT extension of
> log-activity). All three decisions match the original brief.

### Original spec (kept for context)

**Goal:** ensure the canvas's view of the repo (`nodeFiles`) stays accurate as
code evolves. Right now, when a developer deletes or renames a file, the
node's `nodeFiles` row still points at a ghost — that's exactly the kind of
drift "strict sync" requires us to prevent.

**Estimated effort:** ~1.5 working days, broken into three parallelizable
work items (D, E, drift detection).

### Item D — Auto-link by import analysis

When a file is created or edited and it imports another file, the importee
should be linked to the same node(s) as the importer. This means if you link
`apps/web/components/LoginForm.tsx` to a node, and LoginForm imports `useAuthStore`
from `apps/web/hooks/use-auth-store.ts`, the hook file gets auto-linked too.

**Mechanism:**

- New script `apps/mcp-server/src/import-analysis.ts` (or sibling), runnable
  standalone via the `arch-viz-mcp` package (`npx arch-viz-mcp scan-imports`).
- Uses `ts-morph` (or `@typescript-eslint/parser` if lighter) to walk imports
  in each linked file.
- For each resolved import target, calls a new MCP endpoint
  `POST /api/mcp/files/auto_link` with `{ originFilePath, importedFilePath }`.
  Server: look up which node(s) own `originFilePath`, then `link_files` the
  imported path to those same nodes (deduped).
- Returns `{ linked: N, alreadyLinked: M, skipped: K }`.

**Hook integration:**

- `.claude/hooks/log-activity.mjs` already fires on Edit/Write. Extend it (or
  add `.claude/hooks/auto-link-imports.mjs`) to also run a one-file import
  scan and call `/api/mcp/files/auto_link` per discovered import.
- Cap: max 20 imports per file per hook fire, to avoid runaway.

**Schema / API:**

- New MCP HTTP route `/api/mcp/files/auto_link` using `withMcpRoute`.
- New internal mutation `convex/mcp/files.ts:autoLinkByOrigin` doing the
  node-lookup + `link_files` insert.
- New Zod validator `autoLinkImportsInput` in `packages/shared/src/mcp.ts`.

**Tests:**

- `convex/http.test.ts`: auto_link 200 + `{linked: 1}` when origin is in one
  node; 200 + `{linked: 2}` when origin spans two nodes; 200 + `{linked: 0}`
  when origin is unlinked (no-op, no error).
- `apps/mcp-server/src/import-analysis.test.ts`: parses a sample TS file,
  resolves `from './foo'` and `from '../utils/bar'` correctly, ignores
  package imports (`react`, etc.), handles `.ts` vs `.tsx` resolution.

**Done criteria:**

- Editing a linked file with `import {x} from './sibling'` causes `./sibling`
  to appear in `nodeFiles` for the same node within ~1 second of the edit.
- Bulk re-scan command (`npx arch-viz-mcp scan-imports`) walks every linked
  file in the project and converges.

### Item E — Orphan file detector

A page in the UI that lists every source file in the repo that is NOT linked
to any node. Useful for "I scanned with `/arch-init`, what got missed?" and
for ongoing hygiene.

**Mechanism:**

- New CLI: `npx arch-viz-mcp scan-orphans` walks repo source files
  (same heuristic as `/arch-init` for what counts as "source"), pulls the
  full `nodeFiles` list from the API, and prints the diff.
- Optionally also writes a new file `.arch-viz/orphans.json` so the UI can
  pick it up.
- New UI page `/canvas/<projectId>/orphans` — server-side reads a snapshot
  (either fresh on demand if the user uploads, or from a stored most-recent
  scan).

**Trade-off:** the UI page needs a way to get the filesystem state. Three
options:

1. **Client uploads scan result.** Web UI has a button "Upload orphan scan from `arch-viz-mcp scan-orphans`". User runs CLI, drag-drops the JSON. Simple, but two-step.
2. **MCP push.** The CLI `POST`s the scan result to a new endpoint. Server stores it as a `scanSnapshot` row. UI reads from there. One step but adds a table.
3. **No persistence.** UI page just has the upload button + ad-hoc preview. No backend storage.

**Recommendation:** option 2 (MCP push to a `scanSnapshots` table, retention 7 days).

**Schema:**

```ts
scanSnapshots: defineTable({
  projectId: v.id('projects'),
  kind: v.union(v.literal('orphans'), v.literal('drift')),
  data: v.any(), // { repoFiles: string[], orphans: string[], timestamp: number }
}).index('by_project_kind', ['projectId', 'kind']),
```

**Tests:**

- CLI: produces a stable orphan list given fixture filesystem + nodeFiles state.
- HTTP route: rejects oversized payloads (cap ~1MB).
- UI: orphan page shows count, filtered by extension, click-to-bulk-link.

**Done criteria:**

- Running `arch-viz-mcp scan-orphans` on a repo where `/arch-init` was run
  surfaces every source file not under a known node.
- UI page shows the list; clicking a file offers "link to existing node…"
  modal.

### Item F (Sprint 2 sub-item) — Drift detection

A file is "drift" if it's in `nodeFiles` but no longer exists on disk. Or it's
been renamed (file at the old path is gone, but a similar file exists at a
new path).

**Mechanism:**

- Same CLI extended: `npx arch-viz-mcp scan-drift` writes a `drift` snapshot.
- Detection logic:
  - **Missing:** `nodeFiles.path` is set, but `fs.exists(path)` is false.
  - **Renamed (heuristic):** missing path's basename matches a file under
    a similar directory (e.g. `apps/web/components/Login.tsx` missing, but
    `apps/web/features/auth/Login.tsx` exists — suggest rename).
- New UI tab on the node modal: "Drift" badge with `N` when drift > 0.

**Edge cases:**

- Newly-created file fixtures can flap the detector. Solution: only flag
  drift after a path has been missing for `≥ 1 hour` (timestamp in the
  snapshot).
- Same-basename rename suggestions can be wrong. UI should let user
  confirm/dismiss each one.

**Tests:**

- Fixture file deleted from disk → drift snapshot records it.
- Similar file elsewhere → rename suggestion offered.
- `archived` flag on `nodeFiles` (new optional field) keeps deleted-but-acknowledged files out of drift forever.

**Done criteria:**

- Deleting a linked file from disk and re-scanning surfaces it as drift in
  the UI.
- Acknowledging drift either removes the link (user picks "delete link") or
  marks the path with `archived: true` (user picks "keep as historical").

### Sprint 2 done definition

- All three CLI subcommands ship in `arch-viz-mcp` v0.2.0 on npm.
- New MCP HTTP routes for auto_link + scan snapshot push.
- UI: `/orphans` page exists; drift badge appears in node modal.
- Tests: 8+ new vitest cases (3 auto_link, 3 orphan, 2 drift).
- Deploy: Convex schema migrations applied to prod; new arch-viz-mcp version
  published.

### Sprint 2 risks

- **`ts-morph` bundle size.** It's ~10MB. For the CLI it's fine; for the web
  bundle it's not. Keep the parser in the CLI / hook script ONLY, never in
  `apps/web`.
- **Path normalization across OS.** Windows backslashes vs POSIX forward slashes. Re-use the normalize logic from `convex/mcp/activity.ts:logByFile`.
- **Performance at scale.** A repo with 5k files + 50 nodes does a 250k pair-scan if naive. Build a path-to-node index in the lookup endpoint.

---

## Sprint 3 — **SHIPPED ✅** (Arrow expansion: dependency / navigation / data_flow)

> See commit on `main` (feat(sprint-3): arrow expansion — dependency +
> navigation + data_flow). v0.3.0 of `arch-viz-mcp` built but not yet
> on npm (user request). Open Question #2 resolved: always-rebuild
> with manual-edge survival via `source: 'auto'|'manual'`. The weekly
> cron from the original spec was dropped because Convex crons cannot
> read the filesystem; hook + manual scan-imports cover the gap.

### Original spec (kept for context)

**Goal:** make the canvas show _what_ nodes do to each other, not just _which_ nests under which. By the end of Sprint 3, a glance at the canvas tells you which features call which features (dependency), which pages route to which pages (navigation), and which pages send data to which features (data_flow).

**Estimated effort:** ~1 day.

**Depends on:** Sprint 2 item D (auto-link by import). Dependency edges are easiest to derive from the same import graph we already need for auto-linking.

### A.2 — Dependency arrows

A "dependency" edge connects a node X to a node Y when X has a file that
imports a file in Y.

**Mechanism:**

- The import-analysis pipeline from Sprint 2D already knows: (origin file, imported file). The same scan can emit edges: for each (origin → imported) pair where both files are linked to nodes, insert a `dependency` edge between their respective nodes (deduped on source+target+type).
- Cron job: `convex/crons.ts` adds a weekly "edge reconcile" — re-scans imports, inserts new dependency edges, removes stale ones (file no longer imported).

**MCP tool (new):** `link_nodes(source, target, type)` — manual classification when AI knows two nodes are connected but the import graph doesn't show it (e.g. cross-language, cross-process).

**UI:** dependency arrows render in a distinct visual style (proposed: thin dashed line, neutral gray). Hierarchy stays solid + arrowhead.

### A.3a — Navigation arrows

A "navigation" edge means clicking something in page X takes you to page Y.
Heuristic: any `<Link href="/foo">` or `router.push('/foo')` call in X's
linked files targeting Y's known route.

**Mechanism:**

- Extends import-analysis to also walk JSX attributes for `href` / `to` / `Link`-component children, and arrow functions for `router.push(...)` / `router.replace(...)`.
- Resolves the route string to a node — needs a route-to-node map. New optional `metadata.route` field on `nodes` (e.g. `/dashboard`). The `/arch-init` heuristic should populate it when the directory name suggests a route (anything under `app/**/page.*`).
- Heavy heuristic; expect noise and false-positives. UI lets user delete navigation edges they disagree with.

### A.3b — Data-flow arrows

A "data_flow" edge means page X calls a backend handler in feature Y.
Heuristic: `fetch('/api/...')` calls, Convex `useMutation(api.foo.bar)` /
`useQuery(api.foo.bar)`, or matching string identifiers between client +
backend.

**Mechanism:**

- Same scan pipeline, different rule pack.
- New optional `metadata.apiPaths: string[]` on nodes for API endpoint paths owned by that node (e.g. `convex/foo.ts:bar`).

### Visual treatment summary

| Type         | Style                                      | When auto-created                         |
| ------------ | ------------------------------------------ | ----------------------------------------- |
| `hierarchy`  | Solid, arrowhead, neutral foreground color | On `create_node` with parentId (Sprint 1) |
| `dependency` | Dashed, thin, gray                         | Import scan (Sprint 3)                    |
| `navigation` | Solid, double-arrowhead, blue              | Link / router scan (Sprint 3)             |
| `data_flow`  | Dotted, orange                             | API-call scan (Sprint 3)                  |

### Tests

- Each new auto-edge type: 3 vitest cases (create, dedupe, cleanup-on-import-removed).
- UI: each edge type renders in the correct style (jest-style snapshot or DOM assertion).

### Done criteria

- A canvas with two pages (Login + Dashboard) and a feature (AuthService) shows: Login →hier→ AuthForm, Login →nav→ Dashboard, Dashboard →data_flow→ AuthService.
- All three relationships are auto-discovered, not hand-entered, when fixtures match.

### Risks

- **Heuristic noise.** Navigation + data_flow are guess-y. Have an easy way for the user to dismiss false positives (UI-side filter or per-edge delete that persists as a "won't auto-recreate" flag in metadata).
- **Cross-language.** Generic stack scope means we won't catch Python ↔ Go dependencies. That's OK; manual `link_nodes` covers it.

---

## Sprint 4 — **SHIPPED ✅** (Friend sharing: read-only links + private invite)

> See commit on `main` (feat(sprint-4): friend sharing — read-only
> share links + private invite). Convex prod deployed with shareTokens
>
> - projectMembers tables and 5 new indexes. Open Question #3 resolved:
>   API tokens stay user-scoped — members never see other members'
>   tokens. Member edit scope: full peer on nodes/edges/files/kanban;
>   settings (tokens, members, project delete) remain owner-only.

### Original spec (kept for context)

**Goal:** the user can invite 2-3 trusted friends to view (and optionally
edit) a project. Public sharing is NOT in scope.

**Estimated effort:** ~1 day.

### P — Read-only share link

A token-based URL like `/share/<shareToken>` that renders the canvas in viewer
mode (no auth required to view, but no edit / no MCP access either).

**Schema:**

```ts
shareTokens: defineTable({
  projectId: v.id('projects'),
  tokenHash: v.string(), // SHA-256 of the raw shareToken
  name: v.string(),       // user label, e.g. "share with Andi"
  revokedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
}).index('by_hash', ['tokenHash']).index('by_project', ['projectId']),
```

**Routes:**

- `/share/<token>` — public Next.js route, reads token, validates, renders read-only canvas.
- `/settings/share` — owner UI to create + revoke share tokens.

**Read-only enforcement:**

- No `useMutation` calls. Modal opens in read-only mode (description, kanban, activity all visible but no edit affordance).
- The canvas allows pan/zoom but no shape edits (`editor.setReadOnly(true)`).

**Trade-off:** since there's no auth, shared canvas is fully visible to anyone with the link. We mitigate with: token rotation, expiration, revocation.

### Q — Simple invite (full collaborator, capped at 3)

Add a `projectMembers` table. Each project keeps its `userId` (owner) but can have up to 3 additional members. Members have full CRUD.

**Schema:**

```ts
projectMembers: defineTable({
  projectId: v.id('projects'),
  userId: v.id('profiles'),
  invitedAt: v.number(),
  acceptedAt: v.optional(v.number()),
}).index('by_project', ['projectId']).index('by_user', ['userId']),
```

**Flow:**

- Owner: `/settings/members` page → "Invite by email" → enters email.
- Server: looks up profile by email, creates a `projectMembers` row with `acceptedAt: null`.
- Invitee: when they log in, sees "Project X invited you" banner → accept → row gets `acceptedAt` timestamp → project appears in their list.

**Auth helper changes:**

- `requireProjectAccess(ctx, projectId)` now succeeds if the user is the owner OR an accepted member.
- Existing token-scoped auth (MCP) stays unchanged — tokens belong to the owner.

**Cap enforcement:** can't invite a 4th member while 3 active ones exist. UI surfaces the cap clearly.

### Tests

- `shareTokens`: create + use + revoke + expire.
- `projectMembers`: invite → accept → access works; reject duplicate invite; cap at 3.
- `requireProjectAccess`: owner ✓, accepted member ✓, pending member ✗, revoked member ✗.

### Done criteria

- User can generate a share link, send it to a friend not signed up, friend opens the URL, sees a read-only canvas.
- User can invite a friend by email; friend signs in, sees an invite, accepts, can edit nodes.

### Risks

- **Member sees secrets.** Activity log might contain commit messages / file paths that the owner considers sensitive. Acceptable for "trusted friends" target but document the assumption.
- **Token leakage.** Share token URL ends up in browser history / Slack. Mitigate via rotation + the user understands "this URL = access".

---

## Sprint 5 — **SHIPPED ✅** (Polish: drill-down + search + mini-map + export; item J deferred)

> See commit on `main` (feat(sprint-5): polish — drill-down + Ctrl-K
> search + mini-map + export). Item J (AI suggests post-commit) deferred
> per roadmap note — needs Claude Code system-reminder integration that
> a single hook can't deliver. Other four items shipped end-to-end.

### Original spec (kept for context)

**Goal:** quality-of-life additions that don't fit cleanly into a single
theme. Pick + ship in whatever order.

**Estimated effort:** half-day each, ~2 days total if you do all of them.

### C — Drill-down sub-canvas

Double-click a page → canvas filters to show only that page's children. Breadcrumb at top, Esc to leave. Right now everything renders flat at full zoom-out.

**Implementation sketch:** keep one tldraw editor instance, manipulate which shapes are visible via `editor.setShapeVisibility`. Cleaner than multiple pages.

### F — Ctrl-K search command palette

Search by node name → jump to + open modal. Use cmdk or build inline. Probably small enough not to need an external library.

### H — Mini-map + auto-fit-on-load

Tldraw has a built-in minimap component, just plumb it in. Also call `editor.zoomToFit()` once on first mount.

### S — Data export

Tombol "Export Project" → JSON bundle containing nodes, files, kanban, activity, edges. Future: re-import.

### J — AI suggests new nodes post-commit

Hook on `Bash` matching `git commit -m`. Parse the commit + diff, detect files that aren't linked to any node, surface as "want me to create a node for these?" in the next chat turn.

This one is **bigger** than the others (~3 hours alone). Skip if running short.

---

## Cross-sprint dependencies

```
Sprint 1 (done)
   ↓
Sprint 2 (strict sync) — independent of 3/4/5
   ↓
Sprint 3 (arrow expansion) — depends on Sprint 2's import graph
   ↓
Sprint 4 (sharing) — independent of 3, but mid-priority once Sprint 2 lands
   ↓
Sprint 5 (polish) — last; small surface area
```

You can do Sprint 4 and Sprint 5 in either order, or even parallel, after
Sprint 2. Sprint 3 specifically wants Sprint 2's machinery.

---

## Operational notes for whoever picks this up

- **Local dev:** `pnpm install && pnpm exec convex dev` (terminal 1) and
  `pnpm dev` (terminal 2). Canvas at `http://localhost:3000/canvas/<projectId>`.
- **Running tests:** `pnpm test` (vitest). Single file: `pnpm test -- convex/foo.test.ts`.
- **Typechecking:** `pnpm typecheck` (runs across 4 workspaces).
- **Deploying:** `pnpm dlx convex deploy -y` for prod Convex. Vercel auto-deploys
  on push to `main` (production branch).
- **MCP client config (local):** `~/.claude.json` `mcpServers.arch-viz` points
  at `npx -y arch-viz-mcp` with `ARCHITECTURE_*` env vars. Currently configured
  against dev deployment — switch the URL to `honorable-viper-174.convex.site`
  to test against prod.
- **Hooks env:** `.claude/hooks/log-activity.mjs` reads env from process env
  or repo-root `.env.local`. Don't commit secrets there.

---

## Open questions / future forks

These weren't decided in the four-fork pass and may need revisiting before
each sprint:

1. **Sprint 2:** is auto-link by import a foreground hook (runs blocking on
   Edit/Write, increasing latency) or background reconcile (cron every N
   minutes, may lag)? Background is safer; foreground is more "strict".
2. **Sprint 3:** should manual node-deletion of a dependency arrow persist as
   "don't re-auto-create" (the import scan is the source of truth, so the
   user fighting it = sticky preference) or get overwritten on next scan?
3. **Sprint 4:** members with edit access — should they see other members'
   tokens? Probably no, but the UI design hasn't settled.
4. **Sprint 5J (AI suggest):** does the suggest happen inside the same Claude
   Code session that made the commit, or via a separate background job? The
   former is friendlier UX; the latter is more reliable.
