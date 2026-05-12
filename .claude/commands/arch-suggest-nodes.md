# /arch-suggest-nodes — Surface post-commit node suggestions

After every `git commit`, the `.claude/hooks/suggest-nodes-post-commit.mjs` hook diffs HEAD against its parent and asks the canvas which changed files aren't yet tracked. It writes the results to `.arch-viz/suggestions.json`. This slash command reads that file and walks you through creating nodes for the files the user agrees should be tracked.

Follow these steps exactly. Do not improvise. Do not propose unrelated work.

---

## Step 1 — Load suggestions

Read `.arch-viz/suggestions.json` (POSIX path, relative to the project root).

- If the file does not exist OR `entries` is empty: tell the user "No pending suggestions. The hook hasn't seen any commits with unlinked files since the last `/arch-suggest-nodes` run." and STOP.
- If the file exists and has `entries`, proceed to Step 2.

The shape is:

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "sha": "<commit sha>",
      "subject": "<commit subject>",
      "committedAt": <ms epoch>,
      "unlinkedFiles": ["path/a.ts", "path/b.ts", ...]
    }
  ]
}
```

Entries are most-recent first (the hook prunes to the last 5). Treat the union of all `unlinkedFiles` across entries as the candidate set, deduped.

---

## Step 2 — Sanity-check against the live canvas (MANDATORY)

The hook's classification can be stale (e.g. the user manually linked some files in the meantime). Re-confirm before proposing.

Call the `lookup_files` MCP tool with the deduped candidate set. Use the response's `unlinked` array as the working set; discard anything the canvas now considers `linked`.

If `unlinked` is empty after re-confirmation: tell the user "All previously suggested files are now tracked. Clearing suggestions." then delete `.arch-viz/suggestions.json` (or write `{"schemaVersion":1,"entries":[]}` over it) and STOP.

---

## Step 3 — Group + present the proposal

Group remaining unlinked files by directory (POSIX path, drop the basename). Then propose a node per group:

- **Page** for directories at depth ≤ 2 from repo root.
- **Feature** for directories at depth ≥ 3, with `parentId` pointing at the nearest existing PAGE node in the canvas whose linked files share a directory prefix. If no such ancestor exists, fall back to creating it as a page.

Print the proposal in this exact shape and ask for confirmation:

```
Pending unlinked files (after lookup re-check):
  <N> files across <M> directories, from <K> commits.

Proposed new nodes:
  - (page) src/lib/parsers
      ↳ src/lib/parsers/json.ts
      ↳ src/lib/parsers/yaml.ts
  - (feature → "API tokens") src/components/tokens/preview
      ↳ src/components/tokens/preview/preview-card.tsx

Reply with:
  - "all"            → create every proposed node
  - "1,3,5"          → cherry-pick by index (1-based, top-to-bottom)
  - "skip"           → drop these suggestions without creating anything
  - "edit"           → walk me through grouping changes (more granular features)
```

Do NOT call `create_node` before the user responds with one of these forms.

---

## Step 4 — Execute (only after explicit confirmation)

For each accepted proposal:

1. Call `create_node` with `type`, `name` (last path segment of the directory), `parentId` (for features), and a position. Scatter pages with `(x = (i % 6) * 300, y = Math.floor(i / 6) * 300)` to avoid stacking. Cluster features around their parent like `/arch-init` does.
2. Call `link_files` with the candidate files for that directory.
3. If the operation throws, log it and continue with the next proposal — do not abort.

Track which directory paths got nodes successfully so you can clear them from `suggestions.json` in Step 5.

---

## Step 5 — Clear processed suggestions

Read `.arch-viz/suggestions.json` again. For each entry, drop file paths whose containing directory got a node in Step 4. If an entry's `unlinkedFiles` is now empty, drop the entry entirely. Write the file back with the trimmed entries.

If the user chose `skip` in Step 3, do NOT clear the file — they may want the suggestions to remain visible for a future `/arch-suggest-nodes` call.

---

## Step 6 — Summary

Print:

```
arch-suggest-nodes complete.
  Created nodes:   <P pages, F features>
  Linked files:    <count>
  Kept pending:    <count>     (files you skipped or edited away)
  Failures:        <count>     (logged above)
```

---

## Hard constraints

- Never call `create_node` before Step 3 confirmation.
- Never call `delete_node` or `update_node` from this command.
- Use the `lookup_files` MCP tool to re-validate before proposing — the hook's snapshot can be minutes or hours old.
- Cap proposal display at the most recent 30 directories. If more, tell the user and ask them to run `/arch-suggest-nodes` again after acting on this batch.
- Do not invent directory groupings beyond "split by parent directory". The user said the original `/arch-init` heuristic was good enough; this command should feel like a smaller targeted version of it.
