import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  profiles: defineTable({
    clerkId: v.string(),
    email: v.string(),
  })
    .index('by_clerk', ['clerkId'])
    .index('by_email', ['email']),

  projects: defineTable({
    userId: v.id('profiles'),
    name: v.string(),
    slug: v.string(),
  })
    .index('by_user', ['userId'])
    .index('by_user_slug', ['userId', 'slug']),

  projectLayers: defineTable({
    projectId: v.id('projects'),
    name: v.string(),
    position: v.number(),
  }).index('by_project', ['projectId']),

  nodes: defineTable({
    projectId: v.id('projects'),
    layerId: v.optional(v.id('projectLayers')),
    parentId: v.optional(v.id('nodes')),
    type: v.union(v.literal('page'), v.literal('feature')),
    name: v.string(),
    description: v.optional(v.string()),
    positionX: v.number(),
    positionY: v.number(),
    metadata: v.optional(v.any()),
  })
    .index('by_project', ['projectId'])
    .index('by_project_layer', ['projectId', 'layerId'])
    .index('by_parent', ['parentId']),

  nodeFiles: defineTable({
    nodeId: v.id('nodes'),
    path: v.string(),
    // `archived` lets the user acknowledge a drifted file (path no longer
    // exists on disk) without deleting the link, so it stays as historical
    // breadcrumb but never resurfaces in future drift scans. Absent = false.
    archived: v.optional(v.boolean()),
  })
    .index('by_node', ['nodeId'])
    .index('by_path', ['path']),

  kanbanTasks: defineTable({
    nodeId: v.id('nodes'),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal('todo'), v.literal('doing'), v.literal('done')),
    position: v.number(),
  })
    .index('by_node', ['nodeId'])
    .index('by_node_status', ['nodeId', 'status']),

  apiTokens: defineTable({
    userId: v.id('profiles'),
    projectId: v.id('projects'),
    name: v.string(),
    tokenHash: v.string(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_project', ['projectId'])
    .index('by_hash', ['tokenHash']),

  activityLog: defineTable({
    nodeId: v.id('nodes'),
    actor: v.string(),
    message: v.string(),
    metadata: v.optional(v.any()),
  }).index('by_node', ['nodeId']),

  // Directed edges between nodes. `hierarchy` is mirrored from `nodes.parentId`
  // and auto-maintained on create/cascade-delete; the remaining types are
  // populated by Sprint 3 — `dependency` from the TypeScript import graph,
  // `navigation` from JSX `<Link>` / `router.push` calls, `data_flow` from
  // `fetch`/`useMutation`/`useQuery` calls against `metadata.apiPaths`.
  //
  // The `source` field distinguishes scan-inserted ('auto') edges from
  // AI/user-inserted ('manual') ones. The reconcile pass from
  // `arch-viz-mcp scan-imports` only deletes 'auto' rows for the types it
  // owns — manual edges (e.g. AI's link_nodes for a cross-language Python
  // → Go relationship) survive reconciliation. Absent = 'auto' for
  // backwards-compat with Sprint 1 hierarchy edges.
  nodeEdges: defineTable({
    projectId: v.id('projects'),
    sourceNodeId: v.id('nodes'),
    targetNodeId: v.id('nodes'),
    type: v.union(
      v.literal('hierarchy'),
      v.literal('dependency'),
      v.literal('navigation'),
      v.literal('data_flow'),
    ),
    source: v.optional(v.union(v.literal('auto'), v.literal('manual'))),
  })
    .index('by_project', ['projectId'])
    .index('by_source', ['sourceNodeId'])
    .index('by_target', ['targetNodeId'])
    .index('by_project_type', ['projectId', 'type']),

  // Filesystem scan results pushed from `arch-viz-mcp scan-orphans` and
  // `scan-drift`. Only the most recent row per (projectId, kind) is meaningful;
  // older rows are kept briefly so the UI can show "last scanned X ago" and
  // are pruned by the same archival cron pass that already trims activityLog.
  scanSnapshots: defineTable({
    projectId: v.id('projects'),
    kind: v.union(v.literal('orphans'), v.literal('drift')),
    data: v.any(),
  }).index('by_project_kind', ['projectId', 'kind']),

  codebaseSuggestions: defineTable({
    projectId: v.id('projects'),
    runId: v.optional(v.id('hermesMappingRuns')),
    filePath: v.string(),
    action: v.optional(
      v.union(
        v.literal('create_node'),
        v.literal('link_existing_node'),
        v.literal('group_into_node'),
        v.literal('ignore'),
      ),
    ),
    layerId: v.optional(v.id('projectLayers')),
    targetNodeId: v.optional(v.id('nodes')),
    groupKey: v.optional(v.string()),
    suggestedNodeName: v.string(),
    confidence: v.number(),
    reason: v.string(),
    evidence: v.optional(v.array(v.string())),
    source: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('applied'),
      v.literal('rejected'),
      v.literal('ignored'),
    ),
    appliedNodeId: v.optional(v.id('nodes')),
    createdAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_project_status', ['projectId', 'status'])
    .index('by_project_file', ['projectId', 'filePath']),

  hermesMappingRuns: defineTable({
    projectId: v.id('projects'),
    requestedBy: v.id('profiles'),
    source: v.union(v.literal('canvas'), v.literal('discord'), v.literal('cli')),
    scope: v.union(v.literal('orphans'), v.literal('project')),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
    ),
    totalFiles: v.number(),
    suggestedCount: v.number(),
    appliedCount: v.number(),
    pendingCount: v.number(),
    ignoredCount: v.number(),
    errorMessage: v.optional(v.string()),
    submitTokenHash: v.string(),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index('by_project', ['projectId'])
    .index('by_project_status', ['projectId', 'status']),

  // Sprint 4 — read-only public share tokens. A `/share/<rawToken>` URL
  // resolves a row here, then renders the project's canvas without auth.
  // `tokenHash` is SHA-256 of the raw token (same scheme as apiTokens) so
  // a leaked DB doesn't surface raw shareable URLs. `revokedAt` lets the
  // owner kill access immediately; `expiresAt` is optional auto-revoke.
  shareTokens: defineTable({
    projectId: v.id('projects'),
    name: v.string(),
    tokenHash: v.string(),
    revokedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  })
    .index('by_project', ['projectId'])
    .index('by_hash', ['tokenHash']),

  // Sprint 4 — full-collaborator invites. The project owner sends, the
  // invitee accepts. `acceptedAt` going non-null means the member can
  // mutate nodes / edges / files / kanban for the project. Owner can
  // revoke at any time by deleting the row. Member management itself
  // (invite / revoke) stays owner-only; members do not gain those rights.
  projectMembers: defineTable({
    projectId: v.id('projects'),
    userId: v.id('profiles'),
    invitedAt: v.number(),
    acceptedAt: v.optional(v.number()),
  })
    .index('by_project', ['projectId'])
    .index('by_user', ['userId'])
    .index('by_project_user', ['projectId', 'userId']),
});
