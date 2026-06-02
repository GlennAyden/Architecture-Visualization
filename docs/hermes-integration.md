# Hermes Integration V1

Hermes V1 is a contract and inbox integration. Architecture Visualization does
not call the Hermes VPS directly, and Hermes does not edit this repository. The
only inbound artifact is a batch of file-to-layer suggestions.

Architecture Visualization remains the source of truth for projects, layers,
nodes, and file links. Hermes may recommend a file path, target layer, page node
name, confidence, and a short user-safe reason.

## Endpoint

```text
POST /api/mcp/codebase_suggestions/push
```

Call the Convex HTTP Actions host ending in `.convex.site`.

## Auth

Use an existing project API token. Project scope comes from the token, not from
any `project` string in the payload.

```text
Authorization: Bearer <PROJECT_API_TOKEN>
Content-Type: application/json
```

## Payload

```json
{
  "suggestions": [
    {
      "filePath": "apps/web/app/projects/[projectId]/page.tsx",
      "layerId": "target-layer-id",
      "suggestedNodeName": "Project Detail Page",
      "confidence": 0.92,
      "reason": "File ini merepresentasikan halaman detail project dan cocok ditempatkan di layer UI/page.",
      "source": "hermes"
    }
  ]
}
```

Fields:

- `filePath` is required and must be a non-empty string.
- `layerId` is required and must belong to the token's project.
- `suggestedNodeName` is required and must be a non-empty string.
- `confidence` is required and must be a number from 0 to 1.
- `reason` is required, short, and safe to display to the user.
- `source` is optional and defaults to `hermes`.

## Behavior

- `confidence >= 0.85` creates a `page` node in the suggested layer and links
  `filePath` to it.
- `confidence < 0.85` is stored as `pending` for review in the canvas right
  panel under Hermes Inbox.
- Pending suggestions for the same file are updated with the latest layer,
  name, confidence, and reason.
- Files already linked to any node in the project are skipped so no duplicate
  node is created.
- Suggestions already applied do not create duplicate nodes.
- Users can apply or reject pending suggestions from Hermes Inbox. Applying uses
  the same page-node creation and file-link behavior as auto-apply.

## CLI Bridge

```bash
arch-viz-mcp push-suggestions --from-json suggestions.json
```

The CLI reads and validates the same JSON contract, then posts to
`/api/mcp/codebase_suggestions/push` using the configured project token. It must
not print or persist the token.

## V1 Boundaries

- Do not hard-code a Hermes VPS IP, URL, token, or secret.
- Do not add `HERMES_URL`, `HERMES_KEY`, or similar private configuration.
- Do not surface chain-of-thought or private reasoning.
- Do not treat Hermes output as a final diagram or Mermaid result.
- Do not create a separate Hermes results page outside the canvas workflow.
