# /arch-init — Bulk-populate architecture-visualization from a repo

You are about to scan the current repository and bulk-create architecture nodes in the connected `arch-viz` MCP project. Follow these steps exactly, in order. Do not skip steps. Do not improvise.

This command is for **greenfield population only**. Never delete or update existing nodes here.

---

## Step 1 — Confirm clean slate

Call `list_nodes` on the `arch-viz` MCP server.

- If it returns **0 nodes**: proceed to Step 2.
- If it returns **>0 nodes**: STOP. Tell the user:
  > "Project has N existing nodes. /arch-init only adds nodes (never deletes or updates). Continue and add new nodes alongside the existing ones, or abort?"
  Wait for explicit confirmation. Do not auto-merge. Do not deduplicate against existing nodes — the user will decide.

---

## Step 2 — Walk the repo (filesystem heuristic only)

Use the **Glob** and **Read** tools. Do **NOT** use Bash to walk the tree.

This step is intentionally generic and must work for any stack. Do not special-case Next.js, React, Convex, Django, Rails, or any other framework. Only the rules below apply.

### Skip these directories always (at any depth)

```
node_modules  .git  dist  build  .next  .turbo  coverage  .cache
vendor  target  __pycache__  .venv  venv  .idea  .vscode  .claude
.vercel  .convex
```

Also skip directories whose name matches:

- `*.test`
- `*.spec`
- `__tests__`
- `tests`
- `e2e`

### Source file extensions

```
.ts  .tsx  .js  .jsx  .mjs  .cjs  .py  .go  .rs  .java  .kt  .rb  .php  .cs  .swift  .vue  .svelte
```

### Anchor filenames (basename glob, any extension from the list above)

```
page.*  route.*  index.*  main.*  app.*  server.*  handler.*  controller.*
__init__.py  mod.rs  lib.rs
```

### Node candidate rule

A directory is a node candidate if **EITHER**:

1. It directly contains **≥3 source files** (extensions above, immediate children only — not recursive), **OR**
2. It directly contains at least one **anchor file** (immediate children only).

### Depth and recursion

- Compute depth from repo root. Repo root itself is depth 0.
- Recurse to a **max depth of 5**. Do not descend below depth 5.

### Classification

- Node candidates at **depth ≤ 2** → `type: "page"`.
- Node candidates at **depth ≥ 3** → `type: "feature"`, with `parentId` set to the **nearest ancestor node candidate that is a page**. If no ancestor page exists, promote this node to `type: "page"` instead (so features never orphan).

### What to record per node candidate

- `name`: the directory's basename (not the full path).
- `relativePath`: path from repo root, POSIX-style separators.
- `depth`.
- `sourceFiles`: the list of immediate-child source files in that directory, deduped, **cap at 50** files per node. Each file path must be ≤ **500 characters** (skip any path that exceeds this).

---

## Step 3 — Plan and confirm (MANDATORY)

Before calling any write tool, print a preview to the user:

```
Scan complete.
  Pages to create:    <P>
  Features to create: <F>
  Files to link:      <total, after the 50/node cap>

Page list (depth, path):
  - (1) src/app
  - (1) src/lib
  - ...

Feature list (depth, path, parent):
  - (3) src/app/dashboard/widgets  -> src/app
  - ...

Proceed with creation? (yes/no)
```

If the user does not reply `yes` (or an obvious affirmative), STOP. Do not create anything.

You **must not** call `create_node`, `link_files`, `update_node`, `delete_node`, `add_kanban_task`, `log_activity`, or `update_kanban_status` before this confirmation.

---

## Step 4 — Execute creation (only after confirmation)

Execute in this strict order so that feature `parentId` resolution works:

### 4a. Create pages first

For each page, in arbitrary stable order (sorted by `relativePath`):

1. Call `create_node` with:
   - `name`: directory basename
   - `type`: `"page"`
   - `position`: scatter on a grid. Place the i-th page at `x = (i % 6) * 300`, `y = Math.floor(i / 6) * 300`.
2. Record the returned `nodeId` keyed by `relativePath`.
3. Call `link_files` for this node with its `sourceFiles` list (already capped at 50, paths already ≤500 chars).

### 4b. Create features second

Sort features by **depth ascending**, then by `relativePath`. For each feature:

1. Resolve `parentId` by looking up its nearest-ancestor-page `relativePath` in the map from 4a. If the lookup fails (shouldn't happen given the promotion rule in Step 2), log the error and skip this feature.
2. Call `create_node` with:
   - `name`: directory basename
   - `type`: `"feature"`
   - `parentId`: resolved id
   - `position`: cluster around the parent. For the k-th child of a given parent, use `x = parent.x + 60 + (k % 4) * 70`, `y = parent.y + 120 + Math.floor(k / 4) * 70`.
3. Call `link_files` for this node with its `sourceFiles`.

### Failure handling

If any single `create_node` or `link_files` call fails:

- Capture the error message.
- Continue with the rest of the run. Do **not** abort the whole batch.
- Do **not** retry automatically — log it and move on.

### Forbidden during execution

- Never call `delete_node`.
- Never call `update_node`.
- Never modify any existing node returned by Step 1.
- Never add kanban tasks or activity logs as part of `/arch-init` — those are out of scope here.

---

## Step 5 — Final summary

After the batch completes, print:

```
arch-init complete.
  Pages created:    <count>     (failed: <count>)
  Features created: <count>     (failed: <count>)
  Files linked:     <count>     (failed link calls: <count>)

Failures:
  - <relativePath>: <error message>
  - ...
```

If there were zero failures, say so explicitly. Do not claim success if anything was skipped.

---

## Hard constraints (recap — must hold for the entire run)

- Do not create any node before Step 3 confirmation.
- Do not delete or update existing nodes, ever.
- Skip test directories (`*.test`, `*.spec`, `__tests__`, `tests`, `e2e`).
- Skip the dependency/build/IDE/tooling directories listed in Step 2.
- Cap linked files at 50 per node. Cap path length at 500 chars.
- Max recursion depth: 5.
- No framework-specific assumptions. The heuristic is purely "source-file count" + "anchor filename".
- One failed item does not abort the run; surface it in the final summary.
