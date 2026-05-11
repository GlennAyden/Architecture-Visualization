import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  profiles: defineTable({
    clerkId: v.string(),
    email: v.string(),
  }).index('by_clerk', ['clerkId']),

  projects: defineTable({
    userId: v.id('profiles'),
    name: v.string(),
    slug: v.string(),
  })
    .index('by_user', ['userId'])
    .index('by_user_slug', ['userId', 'slug']),

  nodes: defineTable({
    projectId: v.id('projects'),
    parentId: v.optional(v.id('nodes')),
    type: v.union(v.literal('page'), v.literal('feature')),
    name: v.string(),
    description: v.optional(v.string()),
    positionX: v.number(),
    positionY: v.number(),
    metadata: v.optional(v.any()),
  })
    .index('by_project', ['projectId'])
    .index('by_parent', ['parentId']),

  nodeFiles: defineTable({
    nodeId: v.id('nodes'),
    path: v.string(),
  }).index('by_node', ['nodeId']),

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
  // and auto-maintained on create/cascade-delete; other types are reserved for
  // future sprints (dependency, navigation, data_flow). The `type` field is an
  // enum-from-day-one to keep migrations cheap once the other kinds land.
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
  })
    .index('by_project', ['projectId'])
    .index('by_source', ['sourceNodeId'])
    .index('by_target', ['targetNodeId']),
});
