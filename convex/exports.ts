import { v } from 'convex/values';
import { query } from './_generated/server';
import { getProjectIfAccessible } from './lib/auth';

/**
 * Sprint 5 — full project snapshot for the "Export Project" button on
 * the canvas. Returns one shape the UI can stringify and offer as a
 * JSON download. Lenient on access (owner OR accepted member); returns
 * null when the caller can't see the project so a member's exported
 * file always mirrors what they actually saw in the canvas.
 *
 * The shape is intentionally redundant with the individual queries
 * (`projects.get`, `nodes.listByProject`, etc.) — a single round-trip
 * keeps the export atomic-ish (the snapshot reads inside one query
 * transaction so file / kanban / activity counts are coherent).
 *
 * Format is versioned via `schemaVersion: 1` so a future re-import path
 * can branch on shape changes without re-deriving.
 */
export const exportProject = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const project = await getProjectIfAccessible(ctx, projectId);
    if (!project) return null;

    const nodes = await ctx.db
      .query('nodes')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    const edges = await ctx.db
      .query('nodeEdges')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    const layers = await ctx.db
      .query('projectLayers')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();

    const nodeIds = nodes.map((n) => n._id);
    const files = await Promise.all(
      nodeIds.map((id) =>
        ctx.db
          .query('nodeFiles')
          .withIndex('by_node', (q) => q.eq('nodeId', id))
          .collect(),
      ),
    );
    const tasks = await Promise.all(
      nodeIds.map((id) =>
        ctx.db
          .query('kanbanTasks')
          .withIndex('by_node', (q) => q.eq('nodeId', id))
          .collect(),
      ),
    );
    const activity = await Promise.all(
      nodeIds.map((id) =>
        ctx.db
          .query('activityLog')
          .withIndex('by_node', (q) => q.eq('nodeId', id))
          .order('desc')
          .take(200),
      ),
    );

    return {
      schemaVersion: 2 as const,
      exportedAt: Date.now(),
      project: {
        id: project._id as string,
        name: project.name,
        slug: project.slug,
        createdAt: project._creationTime,
      },
      layers: layers
        .sort((a, b) => a.position - b.position)
        .map((layer) => ({
          id: layer._id as string,
          name: layer.name,
          position: layer.position,
          createdAt: layer._creationTime,
        })),
      nodes: nodes.map((n, i) => ({
        id: n._id as string,
        createdAt: n._creationTime,
        type: n.type,
        name: n.name,
        layerId: (n.layerId as string | undefined) ?? null,
        parentId: (n.parentId as string | undefined) ?? null,
        description: n.description ?? null,
        positionX: n.positionX,
        positionY: n.positionY,
        metadata: (n.metadata as Record<string, unknown> | undefined) ?? null,
        files: files[i]!.map((f) => ({
          id: f._id as string,
          path: f.path,
          archived: f.archived ?? false,
        })),
        kanbanTasks: tasks[i]!.sort((a, b) => a.position - b.position).map((t) => ({
          id: t._id as string,
          title: t.title,
          description: t.description ?? null,
          status: t.status,
          position: t.position,
        })),
        activity: activity[i]!.map((a) => ({
          id: a._id as string,
          createdAt: a._creationTime,
          actor: a.actor,
          message: a.message,
          metadata: a.metadata,
        })),
      })),
      edges: edges.map((e) => ({
        id: e._id as string,
        sourceNodeId: e.sourceNodeId as string,
        targetNodeId: e.targetNodeId as string,
        type: e.type,
        source: (e.source ?? 'auto') as 'auto' | 'manual',
      })),
    };
  },
});
