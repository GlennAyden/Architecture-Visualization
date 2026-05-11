# @arch-viz/mcp-server

Local stdio MCP server that lets AI agents (Claude Code, Codex, Cursor) read and update an Arch Viz canvas as they work — plus CLI subcommands for keeping the canvas strictly in sync with the codebase.

One server instance is bound to exactly **one project**. Configure each MCP client that should write to that project to launch this server with the project's environment variables.

## Two modes

### 1. stdio MCP server (default — no args)

```bash
npx -y arch-viz-mcp
```

AI agents call the tools below over MCP. This is what your editor wires up.

### 2. CLI subcommands (Sprint 2)

```bash
npx -y arch-viz-mcp scan-imports   # auto-link imports of every linked file
npx -y arch-viz-mcp scan-orphans   # surface repo source files not linked yet
npx -y arch-viz-mcp scan-drift     # find linked files that disappeared on disk
```

Run from the repo root. Each subcommand reuses the same `ARCHITECTURE_*` env vars as the stdio mode. `scan-orphans` and `scan-drift` push a snapshot to the project — view results at `/canvas/<projectId>/orphans` and in the node modal's `Drift` tab.

## Tools exposed

| Tool                   | Purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `list_nodes`           | Read current canvas state. Call first so the AI knows what exists.      |
| `get_node`             | Drill into one node — description, linked files, kanban tasks, metadata. |
| `create_node`          | Create a page or feature node. Optional `parentId`, `files`, position.  |
| `update_node`          | Partial update: name, description, position, `metadata` (route / apiPaths). |
| `delete_node`          | Cascade-delete a node, its children, files, kanban, and activity log.   |
| `link_files`           | Attach one or more file paths to a node (dedupes against existing).     |
| `link_nodes`           | Manually classify an edge (dependency / navigation / data_flow) between two nodes — for cross-language relations the import scanner cannot see. |
| `unlink_nodes`         | Remove a manually-classified edge. Hierarchy edges are not removable here (they follow `parentId`). |
| `add_kanban_task`      | Add a task to a node's kanban (status: `todo` / `doing` / `done`).      |
| `update_kanban_status` | Move a task across columns; auto-positions to bottom of destination.    |
| `log_activity`         | Append a free-form activity log entry attributing the change to `actor`.|

## Install

Published on npm — no clone needed:

```bash
npx -y arch-viz-mcp
```

For local development from a checkout, build with `pnpm --filter arch-viz-mcp build`; the entrypoint is `apps/mcp-server/dist/index.js`.

## Configuration

Three environment variables are required:

| Variable                   | Value                                                                            |
| -------------------------- | -------------------------------------------------------------------------------- |
| `ARCHITECTURE_CONVEX_URL`  | Deployment HTTP URL — **must end in `.convex.site`** (NOT `.convex.cloud`)       |
| `ARCHITECTURE_API_KEY`     | Token starting with `archv_`, generated at `/settings/tokens` in the web app     |
| `ARCHITECTURE_PROJECT_ID`  | Convex project id (visible in the canvas URL: `/canvas/<projectId>`)             |

> **Why `.convex.site`?** Convex serves HTTP Actions (what this server calls) on a different subdomain than the main client API. `.convex.cloud` will return 404 for every request.

### Claude Code (claude.ai/code)

Add to your MCP settings via the Claude Code UI, or directly to `~/.claude.json` (`mcpServers` section):

```json
{
  "mcpServers": {
    "arch-viz": {
      "command": "npx",
      "args": ["-y", "arch-viz-mcp"],
      "env": {
        "ARCHITECTURE_CONVEX_URL": "https://your-deployment.convex.site",
        "ARCHITECTURE_API_KEY": "archv_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "ARCHITECTURE_PROJECT_ID": "jXXXXXXXXXXXXXXXXXXXXXXXXXXX"
      }
    }
  }
}
```

Replace URL, key, and project id with your own values. `npx -y` downloads `arch-viz-mcp` from the npm registry on first run and caches it.

### Codex CLI

Edit `~/.codex/mcp.json`:

```json
{
  "mcpServers": {
    "arch-viz": {
      "command": "npx",
      "args": ["-y", "arch-viz-mcp"],
      "env": { "ARCHITECTURE_CONVEX_URL": "…", "ARCHITECTURE_API_KEY": "…", "ARCHITECTURE_PROJECT_ID": "…" }
    }
  }
}
```

### Cursor

`Settings → MCP → Add Server`, same shape as above.

### Pin a version

`npx -y arch-viz-mcp@0.1.0` locks to a specific release if you want reproducibility instead of always-latest.

## Verify it works

After configuring, restart your MCP client. From inside a session, ask the AI:

> "List all nodes in the Arch Viz canvas."

The AI should call `list_nodes` and return the current nodes. Watch the canvas in a browser — anything the AI creates, updates, or deletes shows up live.

## Troubleshooting

| Symptom                                          | Likely cause                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Startup error: `ARCHITECTURE_CONVEX_URL points to …convex.cloud …` | URL has the wrong subdomain. Replace `.convex.cloud` with `.convex.site`.        |
| Startup error: `prefix "archv_"`                  | Token was pasted incomplete or the wrong value was copied. Regenerate at `/settings/tokens`.    |
| `[unauthorized] Missing or invalid API token.`    | Token revoked or never existed. Generate a fresh one.                                           |
| `[forbidden] Node not in token scope.`            | The token belongs to a different project than the node being modified. Check `ARCHITECTURE_PROJECT_ID`. |
| AI never calls any tool                           | The MCP server didn't connect. Check the AI's MCP panel for connection state; restart the client. |
| Logs from the server clobbering JSON-RPC output   | The server logs to stderr only — never stdout. If you see message corruption, something else (a wrapper script?) is writing to stdout. |

## Security

- Tokens are bearer secrets. Treat them like passwords.
- Each token is scoped to a single project; do not share across projects.
- Revoke unused tokens at `/settings/tokens`. Revocation is immediate — running MCP clients will start receiving `unauthorized` errors.
- The raw token is shown **once** on creation. If lost, revoke and create a new one.

## Development

```bash
# Run from source (no build step) with stdio
pnpm --filter @arch-viz/mcp-server dev

# Run unit tests
pnpm vitest run apps/mcp-server/
```

For end-to-end smoke testing without an MCP client, pipe JSON-RPC frames to stdin manually:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_nodes","arguments":{}}}' \
  | ARCHITECTURE_CONVEX_URL=https://…convex.site ARCHITECTURE_API_KEY=archv_… ARCHITECTURE_PROJECT_ID=… \
    node apps/mcp-server/dist/index.js
```
