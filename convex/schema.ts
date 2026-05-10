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
    parentId: v.optional(v.id('nodes')), // nested features (Phase 1C); top-level pages omit
    type: v.union(v.literal('page'), v.literal('feature')),
    name: v.string(),
    description: v.optional(v.string()),
    positionX: v.number(),
    positionY: v.number(),
    metadata: v.optional(v.any()),
  })
    .index('by_project', ['projectId'])
    .index('by_parent', ['parentId']),
});
