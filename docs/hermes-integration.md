# Hermes Mapping Review

Hermes Mapping Review lets Architecture Visualization ask Hermes to classify
orphan files against the current canvas. Convex remains the source of truth for
projects, layers, nodes, file links, suggestions, and run state. The VPS/Hermes
side is only an analysis worker and bridge.

## Canvas Flow

From the canvas right panel, click **Ask Hermes**. The Vercel route:

1. validates the local session through the VPS auth backend,
2. creates a Convex `hermesMappingRuns` row,
3. builds a bounded context from layers, nodes, linked files, orphan scan, and
   existing suggestions,
4. sends that context to the VPS endpoint,
5. returns only `{ runId, status }` to the browser.

The browser never receives the run submit token.

```text
POST /api/hermes/mapping-runs/start
```

Required body:

```json
{ "projectId": "j..." }
```

## VPS Bridge

Vercel calls the VPS backend with the existing backend proxy token.

```text
POST /hermes/mapping-runs/start
Authorization: Bearer <ARCHVIZ_BACKEND_PROXY_TOKEN>
```

The VPS receives:

- `runId`
- `submitToken`
- `convexSiteUrl`
- bounded mapping context

The current V1 worker uses a deterministic heuristic mapper so the system is
usable before a direct Hermes runtime connection is wired in. Hermes can later
replace that mapper as long as it returns the same structured suggestions.

## Convex Completion Route

The worker completes a run through Convex HTTP Actions on `.convex.site`:

```text
POST /api/hermes/mapping-runs/complete
```

Payload:

```json
{
  "runId": "run-id",
  "submitToken": "run-scoped-token",
  "status": "completed",
  "suggestions": [
    {
      "filePath": "apps/web/app/api/auth/login/route.ts",
      "action": "link_existing_node",
      "targetNodeId": "node-id",
      "suggestedNodeName": "Auth Proxy",
      "confidence": 0.91,
      "reason": "Final explanation safe for UI",
      "evidence": ["route /api/auth/login", "exports POST"],
      "source": "hermes"
    }
  ]
}
```

Failed runs must submit a safe error message:

```json
{
  "runId": "run-id",
  "submitToken": "run-scoped-token",
  "status": "failed",
  "errorMessage": "Hermes output was malformed",
  "suggestions": []
}
```

## Suggestion Contract V2

Each row is still one file. `action` defaults to `create_node` for V1
compatibility.

| Field               | Notes                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| `filePath`          | Required repo-relative path.                                                  |
| `action`            | `create_node`, `link_existing_node`, `group_into_node`, or `ignore`.          |
| `layerId`           | Required for `create_node` and `group_into_node`. Must belong to the project. |
| `targetNodeId`      | Required for `link_existing_node`. Must belong to the project.                |
| `groupKey`          | Required for `group_into_node`; grouped rows share one stable key.            |
| `suggestedNodeName` | Optional for V2; fallback comes from the file path.                           |
| `confidence`        | Number from `0` to `1`.                                                       |
| `reason`            | Final, user-safe explanation.                                                 |
| `evidence`          | Optional short UI-safe facts, max 8.                                          |
| `source`            | Optional, defaults to `hermes`.                                               |

Auto-apply thresholds:

- `create_node` and `group_into_node`: confidence `>= 0.85`
- `link_existing_node` and `ignore`: confidence `>= 0.90`

Low-confidence suggestions stay pending in Hermes Inbox. Users can apply,
reject, ignore, bulk-apply high-confidence rows, or edit action/layer/node
before applying.

## CLI / Discord Compatibility

The existing project API token route remains available for Discord/CLI paths:

```text
POST /api/mcp/codebase_suggestions/push
Authorization: Bearer <PROJECT_API_TOKEN>
```

The CLI reads the same JSON contract:

```bash
arch-viz-mcp push-suggestions --from-json suggestions.json
```

V1 payloads still work:

```json
{
  "suggestions": [
    {
      "filePath": "apps/web/app/page.tsx",
      "layerId": "target-layer-id",
      "suggestedNodeName": "Home Page",
      "confidence": 0.92,
      "reason": "This page is a UI surface."
    }
  ]
}
```

## Scanner Context

`arch-viz-mcp scan-orphans` now includes optional `fileFacts`:

- `path`
- `kind`
- `imports`
- `exports`
- `routeHint`
- `apiHint`

These facts help Hermes classify files without receiving raw source contents.

## Boundaries

- Do not hard-code Hermes VPS IPs, URLs, or secrets.
- Do not expose run submit tokens to the browser.
- Do not expose project API tokens to Hermes unless the caller is explicitly
  using the MCP token route.
- Do not display chain-of-thought or private reasoning.
- Do not store product data in the VPS as the source of truth.
- Do not reintroduce Clerk.
