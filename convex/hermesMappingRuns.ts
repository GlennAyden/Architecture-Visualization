import { v } from 'convex/values';
import { Id } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import { getProfile, getProjectIfAccessible, requireProjectAccess } from './lib/auth';
import { hashToken } from './lib/tokens';
import { upsertSuggestion } from './lib/codebaseSuggestions';
import { upsertRelationshipSuggestion } from './lib/relationshipSuggestions';
import { upsertArchitectureFlow } from './lib/architectureFlows';
import {
  architectureFlowKindValidator,
  edgeTypeValidator,
  linkedFileRoleValidator,
  manualEdgeTypeValidator,
  nodeSemanticKindValidator,
} from './lib/semantic';

const mappingRunSource = v.union(v.literal('canvas'), v.literal('discord'), v.literal('cli'));
const mappingRunScope = v.union(v.literal('orphans'), v.literal('project'));

const suggestionAction = v.union(
  v.literal('create_node'),
  v.literal('link_existing_node'),
  v.literal('group_into_node'),
  v.literal('ignore'),
);

const suggestionValidator = v.object({
  filePath: v.string(),
  action: v.optional(suggestionAction),
  layerId: v.optional(v.id('projectLayers')),
  targetNodeId: v.optional(v.id('nodes')),
  groupKey: v.optional(v.string()),
  suggestedNodeName: v.optional(v.string()),
  confidence: v.number(),
  reason: v.string(),
  evidence: v.optional(v.array(v.string())),
  semanticKind: v.optional(nodeSemanticKindValidator),
  fileRole: v.optional(linkedFileRoleValidator),
  source: v.string(),
});

const relationshipSuggestionValidator = v.object({
  sourceNodeId: v.id('nodes'),
  targetNodeId: v.id('nodes'),
  type: manualEdgeTypeValidator,
  label: v.optional(v.string()),
  confidence: v.number(),
  reason: v.string(),
  evidence: v.optional(v.array(v.string())),
  source: v.string(),
});

const flowEdgeRefValidator = v.object({
  edgeId: v.optional(v.id('nodeEdges')),
  sourceNodeId: v.optional(v.id('nodes')),
  targetNodeId: v.optional(v.id('nodes')),
  type: v.optional(edgeTypeValidator),
});

const flowStepValidator = v.object({
  title: v.string(),
  description: v.string(),
  nodeIds: v.optional(v.array(v.id('nodes'))),
  edgeRefs: v.optional(v.array(flowEdgeRefValidator)),
});

const flowSuggestionValidator = v.object({
  title: v.string(),
  description: v.string(),
  kind: architectureFlowKindValidator,
  nodeIds: v.array(v.id('nodes')),
  edgeRefs: v.optional(v.array(flowEdgeRefValidator)),
  steps: v.array(flowStepValidator),
  confidence: v.number(),
  reason: v.string(),
  evidence: v.optional(v.array(v.string())),
  source: v.string(),
});

function latestOrphanCount(data: unknown): number {
  if (!data || typeof data !== 'object') return 0;
  const orphans = (data as { orphans?: unknown }).orphans;
  return Array.isArray(orphans) ? orphans.length : 0;
}

function safeErrorMessage(message: string): string {
  return message
    .replace(/archv_[A-Za-z0-9_-]+/g, '[redacted-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 1000);
}

export const start = mutation({
  args: {
    projectId: v.id('projects'),
    source: mappingRunSource,
    scope: mappingRunScope,
    submitTokenHash: v.string(),
  },
  handler: async (ctx, { projectId, source, scope, submitTokenHash }) => {
    const profile = await getProfile(ctx);
    if (!profile) throw new Error('Unauthorized');
    await requireProjectAccess(ctx, projectId);
    if (!submitTokenHash.trim()) throw new Error('submitTokenHash is required');

    const snapshots = await ctx.db
      .query('scanSnapshots')
      .withIndex('by_project_kind', (q) => q.eq('projectId', projectId).eq('kind', 'orphans'))
      .take(1);
    const now = Date.now();
    const runId = await ctx.db.insert('hermesMappingRuns', {
      projectId,
      requestedBy: profile._id,
      source,
      scope,
      status: 'queued',
      totalFiles: latestOrphanCount(snapshots[0]?.data),
      suggestedCount: 0,
      appliedCount: 0,
      pendingCount: 0,
      ignoredCount: 0,
      submitTokenHash,
      createdAt: now,
    });

    return { runId };
  },
});

export const latestByProject = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const project = await getProjectIfAccessible(ctx, projectId);
    if (!project) return [];
    const runs = await ctx.db
      .query('hermesMappingRuns')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .order('desc')
      .take(5);
    return runs.map(({ submitTokenHash: _submitTokenHash, ...run }) => run);
  },
});

export const buildContext = query({
  args: {
    projectId: v.id('projects'),
    runId: v.id('hermesMappingRuns'),
  },
  handler: async (ctx, { projectId, runId }) => {
    const project = await getProjectIfAccessible(ctx, projectId);
    if (!project) throw new Error('Project not found');
    const run = await ctx.db.get(runId);
    if (!run || run.projectId !== projectId) throw new Error('Mapping run not found');

    const layers = await ctx.db
      .query('projectLayers')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect();
    const nodes = await ctx.db
      .query('nodes')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .take(500);

    const nodesWithFiles = await Promise.all(
      nodes.map(async (node) => {
        const files = await ctx.db
          .query('nodeFiles')
          .withIndex('by_node', (q) => q.eq('nodeId', node._id))
          .take(100);
        return {
          _id: node._id,
          name: node.name,
          type: node.type,
          layerId: node.layerId,
          parentId: node.parentId,
          semanticKind: node.semanticKind,
          mappingStatus: node.mappingStatus,
          mappingConfidence: node.mappingConfidence,
          files: files.filter((file) => !file.archived).map((file) => file.path),
          linkedFiles: files
            .filter((file) => !file.archived)
            .map((file) => ({
              path: file.path,
              role: file.role,
              source: file.source,
              confidence: file.confidence,
              reason: file.reason,
              evidence: file.evidence,
              verifiedAt: file.verifiedAt,
            })),
        };
      }),
    );

    const edges = await ctx.db
      .query('nodeEdges')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .take(1000);

    const snapshots = await ctx.db
      .query('scanSnapshots')
      .withIndex('by_project_kind', (q) => q.eq('projectId', projectId).eq('kind', 'orphans'))
      .take(1);

    const statuses = ['pending', 'applied', 'rejected', 'ignored'] as const;
    const suggestions = [];
    const relationshipSuggestions = [];
    const flows = [];
    for (const status of statuses) {
      const rows = await ctx.db
        .query('codebaseSuggestions')
        .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', status))
        .take(100);
      suggestions.push(
        ...rows.map((row) => ({
          filePath: row.filePath,
          action: row.action ?? 'create_node',
          layerId: row.layerId,
          targetNodeId: row.targetNodeId,
          groupKey: row.groupKey,
          status: row.status,
          confidence: row.confidence,
        })),
      );

      const relationshipRows = await ctx.db
        .query('relationshipSuggestions')
        .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', status))
        .take(100);
      relationshipSuggestions.push(
        ...relationshipRows.map((row) => ({
          sourceNodeId: row.sourceNodeId,
          targetNodeId: row.targetNodeId,
          type: row.type,
          label: row.label,
          status: row.status,
          confidence: row.confidence,
        })),
      );

      const flowRows = await ctx.db
        .query('architectureFlows')
        .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', status))
        .take(100);
      flows.push(
        ...flowRows.map((row) => ({
          title: row.title,
          kind: row.kind,
          status: row.status,
          nodeIds: row.nodeIds,
          confidence: row.confidence,
        })),
      );
    }

    return {
      runId,
      project: { _id: project._id, name: project.name },
      layers: layers
        .map((layer) => ({
          _id: layer._id,
          name: layer.name,
          position: layer.position,
          purpose: layer.purpose,
          description: layer.description,
        }))
        .sort((a, b) => a.position - b.position),
      nodes: nodesWithFiles,
      edges: edges.map((edge) => ({
        _id: edge._id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        type: edge.type,
        source: edge.source,
        label: edge.label,
        confidence: edge.confidence,
        reason: edge.reason,
        evidence: edge.evidence,
      })),
      latestScan: snapshots[0]
        ? { id: snapshots[0]._id, createdAt: snapshots[0]._creationTime, data: snapshots[0].data }
        : null,
      suggestions,
      relationshipSuggestions,
      flows,
    };
  },
});

export const markRunning = mutation({
  args: { runId: v.id('hermesMappingRuns') },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error('Mapping run not found');
    await requireProjectAccess(ctx, run.projectId);
    if (run.status === 'completed' || run.status === 'failed') return;
    await ctx.db.patch(runId, {
      status: 'running',
      startedAt: run.startedAt ?? Date.now(),
      errorMessage: undefined,
    });
  },
});

export const markFailed = mutation({
  args: { runId: v.id('hermesMappingRuns'), errorMessage: v.string() },
  handler: async (ctx, { runId, errorMessage }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error('Mapping run not found');
    await requireProjectAccess(ctx, run.projectId);
    await ctx.db.patch(runId, {
      status: 'failed',
      errorMessage: safeErrorMessage(errorMessage),
      completedAt: Date.now(),
    });
  },
});

async function countRunSuggestions(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  runId: Id<'hermesMappingRuns'>,
) {
  const statuses = ['pending', 'applied', 'ignored'] as const;
  const counts = { pending: 0, applied: 0, ignored: 0 };
  for (const status of statuses) {
    const rows = await ctx.db
      .query('codebaseSuggestions')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', status))
      .take(500);
    counts[status] = rows.filter((row) => row.runId === runId).length;
  }
  for (const status of statuses) {
    const rows = await ctx.db
      .query('relationshipSuggestions')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', status))
      .take(500);
    counts[status] += rows.filter((row) => row.runId === runId).length;

    const flowRows = await ctx.db
      .query('architectureFlows')
      .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', status))
      .take(500);
    counts[status] += flowRows.filter((row) => row.runId === runId).length;
  }
  return counts;
}

export const complete = internalMutation({
  args: {
    runId: v.id('hermesMappingRuns'),
    submitToken: v.string(),
    status: v.union(v.literal('completed'), v.literal('failed')),
    errorMessage: v.optional(v.string()),
    suggestions: v.array(suggestionValidator),
    relationshipSuggestions: v.optional(v.array(relationshipSuggestionValidator)),
    flowSuggestions: v.optional(v.array(flowSuggestionValidator)),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error('Mapping run not found');
    if ((await hashToken(args.submitToken)) !== run.submitTokenHash) {
      throw new Error('Invalid mapping run submit token');
    }

    if (args.status === 'failed') {
      await ctx.db.patch(args.runId, {
        status: 'failed',
        errorMessage: safeErrorMessage(args.errorMessage ?? 'Hermes mapping failed'),
        completedAt: Date.now(),
      });
      return { ok: true };
    }

    for (const suggestion of args.suggestions) {
      await upsertSuggestion(ctx, run.projectId, {
        ...suggestion,
        runId: args.runId,
      });
    }

    for (const suggestion of args.relationshipSuggestions ?? []) {
      await upsertRelationshipSuggestion(ctx, run.projectId, {
        ...suggestion,
        runId: args.runId,
      });
    }

    for (const flow of args.flowSuggestions ?? []) {
      await upsertArchitectureFlow(ctx, run.projectId, {
        ...flow,
        runId: args.runId,
      });
    }

    const counts = await countRunSuggestions(ctx, run.projectId, args.runId);
    await ctx.db.patch(args.runId, {
      status: 'completed',
      suggestedCount:
        args.suggestions.length +
        (args.relationshipSuggestions ?? []).length +
        (args.flowSuggestions ?? []).length,
      appliedCount: counts.applied,
      pendingCount: counts.pending,
      ignoredCount: counts.ignored,
      errorMessage: undefined,
      completedAt: Date.now(),
    });

    return { ok: true, ...counts };
  },
});
