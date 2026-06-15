import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, mutation, query } from './_generated/server';
import { getProfile, getProjectIfAccessible, requireProjectAccess } from './lib/auth';
import { hashToken } from './lib/tokens';
import { upsertSuggestion } from './lib/codebaseSuggestions';
import { upsertRelationshipSuggestion } from './lib/relationshipSuggestions';
import { upsertArchitectureFlow } from './lib/architectureFlows';
import {
  upsertProductSurfaceFlows,
  upsertSemanticNodeSuggestion,
} from './lib/semanticNodeSuggestions';
import { ensureProductLayers } from './projectLayers';
import {
  architectureFlowKindValidator,
  edgeTypeValidator,
  linkedFileRoleValidator,
  manualEdgeTypeValidator,
  nodeSemanticKindValidator,
  productAreaValidator,
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

const semanticNodeSuggestionValidator = v.object({
  sourceFilePath: v.string(),
  semanticKey: v.string(),
  suggestedNodeName: v.string(),
  semanticKind: nodeSemanticKindValidator,
  productArea: productAreaValidator,
  capabilityKey: v.optional(v.string()),
  routeHint: v.optional(v.string()),
  layerId: v.id('projectLayers'),
  parentNodeId: v.optional(v.id('nodes')),
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
  shortTitle: v.optional(v.string()),
  goal: v.optional(v.string()),
  importance: v.optional(v.number()),
  curationKey: v.optional(v.string()),
  description: v.string(),
  kind: architectureFlowKindValidator,
  nodeIds: v.array(v.id('nodes')),
  edgeRefs: v.optional(v.array(flowEdgeRefValidator)),
  steps: v.array(flowStepValidator),
  confidence: v.number(),
  reason: v.string(),
  evidence: v.optional(v.array(v.string())),
  productArea: v.optional(productAreaValidator),
  source: v.string(),
});

const completionProgressValidator = v.object({
  suggestedCount: v.number(),
  appliedCount: v.number(),
  pendingCount: v.number(),
  ignoredCount: v.number(),
  failedCount: v.number(),
});

const COMPLETION_BATCH_SIZES = {
  suggestions: 20,
  semanticNodeSuggestions: 20,
  relationshipSuggestions: 20,
  flowSuggestions: 4,
};

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
    await ensureProductLayers(ctx, projectId);

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
          productArea: node.productArea,
          capabilityKey: node.capabilityKey,
          routeHint: node.routeHint,
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
    const semanticNodeSuggestions = [];
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

      const semanticRows = await ctx.db
        .query('semanticNodeSuggestions')
        .withIndex('by_project_status', (q) => q.eq('projectId', projectId).eq('status', status))
        .take(100);
      semanticNodeSuggestions.push(
        ...semanticRows.map((row) => ({
          sourceFilePath: row.sourceFilePath,
          semanticKey: row.semanticKey,
          suggestedNodeName: row.suggestedNodeName,
          semanticKind: row.semanticKind,
          productArea: row.productArea,
          capabilityKey: row.capabilityKey,
          routeHint: row.routeHint,
          layerId: row.layerId,
          parentNodeId: row.parentNodeId,
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
      semanticNodeSuggestions,
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

function initialCompletionProgress(args: {
  suggestions: unknown[];
  semanticNodeSuggestions?: unknown[];
  relationshipSuggestions?: unknown[];
  flowSuggestions?: unknown[];
}) {
  return {
    suggestedCount:
      args.suggestions.length +
      (args.semanticNodeSuggestions ?? []).length +
      (args.relationshipSuggestions ?? []).length +
      (args.flowSuggestions ?? []).length,
    appliedCount: 0,
    pendingCount: 0,
    ignoredCount: 0,
    failedCount: 0,
  };
}

function addCompletionStatus(
  progress: ReturnType<typeof initialCompletionProgress>,
  status: 'applied' | 'pending' | 'ignored' | 'skipped' | 'failed',
) {
  if (status === 'applied') progress.appliedCount++;
  if (status === 'pending') progress.pendingCount++;
  if (status === 'ignored') progress.ignoredCount++;
  if (status === 'failed') progress.failedCount++;
}

export const complete = internalMutation({
  args: {
    runId: v.id('hermesMappingRuns'),
    submitToken: v.string(),
    status: v.union(v.literal('completed'), v.literal('failed')),
    errorMessage: v.optional(v.string()),
    suggestions: v.array(suggestionValidator),
    semanticNodeSuggestions: v.optional(v.array(semanticNodeSuggestionValidator)),
    relationshipSuggestions: v.optional(v.array(relationshipSuggestionValidator)),
    flowSuggestions: v.optional(v.array(flowSuggestionValidator)),
    progress: v.optional(completionProgressValidator),
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

    const progress = args.progress ?? initialCompletionProgress(args);
    const suggestionBatch = args.suggestions.slice(0, COMPLETION_BATCH_SIZES.suggestions);
    const semanticBatch = (args.semanticNodeSuggestions ?? []).slice(
      0,
      COMPLETION_BATCH_SIZES.semanticNodeSuggestions,
    );
    const relationshipBatch = (args.relationshipSuggestions ?? []).slice(
      0,
      COMPLETION_BATCH_SIZES.relationshipSuggestions,
    );
    const flowBatch = (args.flowSuggestions ?? []).slice(0, COMPLETION_BATCH_SIZES.flowSuggestions);

    for (const suggestion of suggestionBatch) {
      const result = await upsertSuggestion(ctx, run.projectId, {
        ...suggestion,
        runId: args.runId,
      });
      addCompletionStatus(progress, result.status);
    }

    for (const suggestion of semanticBatch) {
      const result = await upsertSemanticNodeSuggestion(ctx, run.projectId, {
        ...suggestion,
        runId: args.runId,
      });
      addCompletionStatus(progress, result.status);
    }

    for (const suggestion of relationshipBatch) {
      const result = await upsertRelationshipSuggestion(ctx, run.projectId, {
        ...suggestion,
        runId: args.runId,
      });
      addCompletionStatus(progress, result.status);
    }

    for (const flow of flowBatch) {
      const result = await upsertArchitectureFlow(ctx, run.projectId, {
        ...flow,
        runId: args.runId,
      });
      addCompletionStatus(progress, result.status);
    }

    const remainingSuggestions = args.suggestions.slice(COMPLETION_BATCH_SIZES.suggestions);
    const remainingSemanticNodeSuggestions = (args.semanticNodeSuggestions ?? []).slice(
      COMPLETION_BATCH_SIZES.semanticNodeSuggestions,
    );
    const remainingRelationshipSuggestions = (args.relationshipSuggestions ?? []).slice(
      COMPLETION_BATCH_SIZES.relationshipSuggestions,
    );
    const remainingFlowSuggestions = (args.flowSuggestions ?? []).slice(
      COMPLETION_BATCH_SIZES.flowSuggestions,
    );
    if (
      remainingSuggestions.length > 0 ||
      remainingSemanticNodeSuggestions.length > 0 ||
      remainingRelationshipSuggestions.length > 0 ||
      remainingFlowSuggestions.length > 0
    ) {
      await ctx.scheduler.runAfter(0, internal.hermesMappingRuns.complete, {
        runId: args.runId,
        submitToken: args.submitToken,
        status: 'completed',
        suggestions: remainingSuggestions,
        semanticNodeSuggestions: remainingSemanticNodeSuggestions,
        relationshipSuggestions: remainingRelationshipSuggestions,
        flowSuggestions: remainingFlowSuggestions,
        progress,
      });
      return {
        ok: true,
        processing: true,
        pending: progress.pendingCount,
        applied: progress.appliedCount,
        ignored: progress.ignoredCount,
        failed: progress.failedCount,
        ...progress,
      };
    }

    await upsertProductSurfaceFlows(ctx, run.projectId, args.runId);

    await ctx.db.patch(args.runId, {
      status: 'completed',
      suggestedCount: progress.suggestedCount,
      appliedCount: progress.appliedCount,
      pendingCount: progress.pendingCount,
      ignoredCount: progress.ignoredCount,
      errorMessage: undefined,
      completedAt: Date.now(),
    });

    return {
      ok: true,
      pending: progress.pendingCount,
      applied: progress.appliedCount,
      ignored: progress.ignoredCount,
      failed: progress.failedCount,
      ...progress,
    };
  },
});
