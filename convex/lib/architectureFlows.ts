import { Doc, Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';

export const FLOW_AUTO_APPLY_CONFIDENCE = 0.9;

export type ArchitectureFlowKind =
  | 'user_journey'
  | 'system_process'
  | 'data_flow'
  | 'agent_workflow'
  | 'build_deploy'
  | 'integration';

export interface ArchitectureFlowEdgeRefInput {
  edgeId?: Id<'nodeEdges'>;
  sourceNodeId?: Id<'nodes'>;
  targetNodeId?: Id<'nodes'>;
  type?: Doc<'nodeEdges'>['type'];
}

export interface ArchitectureFlowStepInput {
  title: string;
  description: string;
  nodeIds?: Id<'nodes'>[];
  edgeRefs?: ArchitectureFlowEdgeRefInput[];
}

export interface ArchitectureFlowInput {
  runId?: Id<'hermesMappingRuns'>;
  title: string;
  description: string;
  kind: ArchitectureFlowKind;
  nodeIds: Id<'nodes'>[];
  edgeRefs?: ArchitectureFlowEdgeRefInput[];
  steps: ArchitectureFlowStepInput[];
  confidence: number;
  reason: string;
  evidence?: string[];
  source: string;
}

function normalizeText(value: string, fallback: string, max: number) {
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, max);
}

function uniqueIds<T extends string>(ids: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function shouldAutoApplyArchitectureFlow(
  flow: Pick<Doc<'architectureFlows'>, 'confidence'>,
) {
  return flow.confidence >= FLOW_AUTO_APPLY_CONFIDENCE;
}

async function ensureNodeInProject(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  nodeId: Id<'nodes'>,
) {
  const node = await ctx.db.get(nodeId);
  if (!node || node.projectId !== projectId) {
    throw new Error('Architecture flow node must belong to the same project');
  }
  return node;
}

async function normalizeEdgeRef(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  ref: ArchitectureFlowEdgeRefInput,
) {
  if (ref.edgeId) {
    const edge = await ctx.db.get(ref.edgeId);
    if (!edge || edge.projectId !== projectId) {
      throw new Error('Architecture flow edge must belong to the same project');
    }
    return {
      edgeId: ref.edgeId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      type: edge.type,
    };
  }

  if (!ref.sourceNodeId || !ref.targetNodeId || !ref.type) {
    throw new Error('Architecture flow edge ref requires edgeId or sourceNodeId/targetNodeId/type');
  }
  if (ref.sourceNodeId === ref.targetNodeId) {
    throw new Error('Architecture flow edge source and target must differ');
  }
  await ensureNodeInProject(ctx, projectId, ref.sourceNodeId);
  await ensureNodeInProject(ctx, projectId, ref.targetNodeId);
  return {
    sourceNodeId: ref.sourceNodeId,
    targetNodeId: ref.targetNodeId,
    type: ref.type,
  };
}

async function normalizeEdgeRefs(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  refs: ArchitectureFlowEdgeRefInput[] | undefined,
) {
  const out = [];
  for (const ref of refs ?? []) {
    out.push(await normalizeEdgeRef(ctx, projectId, ref));
  }
  return out.length > 0 ? out : undefined;
}

async function normalizeSteps(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  steps: ArchitectureFlowStepInput[],
) {
  const normalized = [];
  for (const step of steps.slice(0, 12)) {
    const nodeIds = step.nodeIds ? uniqueIds(step.nodeIds).slice(0, 12) : undefined;
    if (nodeIds) {
      for (const nodeId of nodeIds) await ensureNodeInProject(ctx, projectId, nodeId);
    }
    normalized.push({
      title: normalizeText(step.title, 'Step', 120),
      description: normalizeText(step.description, '', 600),
      nodeIds,
      edgeRefs: await normalizeEdgeRefs(ctx, projectId, step.edgeRefs),
    });
  }
  return normalized;
}

export async function upsertArchitectureFlow(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  input: ArchitectureFlowInput,
) {
  const nodeIds = uniqueIds(input.nodeIds).slice(0, 40);
  if (input.confidence < 0 || input.confidence > 1) {
    throw new Error('Architecture flow confidence must be between 0 and 1');
  }
  if (nodeIds.length < 2) {
    return { status: 'skipped' as const, reason: 'not_enough_nodes' as const };
  }
  for (const nodeId of nodeIds) await ensureNodeInProject(ctx, projectId, nodeId);
  if (input.steps.length === 0) {
    return { status: 'skipped' as const, reason: 'not_enough_steps' as const };
  }

  const title = normalizeText(input.title, 'Architecture flow', 120);
  const existing = await ctx.db
    .query('architectureFlows')
    .withIndex('by_project_title', (q) => q.eq('projectId', projectId).eq('title', title))
    .unique();

  if (existing?.status === 'applied' || existing?.status === 'ignored') {
    return {
      status: 'skipped' as const,
      reason:
        existing.status === 'applied' ? ('already_applied' as const) : ('already_ignored' as const),
      flowId: existing._id,
    };
  }

  const now = Date.now();
  const patch = {
    runId: input.runId,
    title,
    description: normalizeText(input.description, '', 1000),
    kind: input.kind,
    nodeIds,
    edgeRefs: await normalizeEdgeRefs(ctx, projectId, input.edgeRefs),
    steps: await normalizeSteps(ctx, projectId, input.steps),
    confidence: input.confidence,
    reason: normalizeText(input.reason, 'Suggested by Hermes.', 1000),
    evidence: input.evidence?.slice(0, 8),
    source: normalizeText(input.source, 'hermes', 80),
    status:
      input.confidence >= FLOW_AUTO_APPLY_CONFIDENCE ? ('applied' as const) : ('pending' as const),
    updatedAt: now,
  };

  const flowId = existing
    ? existing._id
    : await ctx.db.insert('architectureFlows', {
        projectId,
        createdAt: now,
        ...patch,
      });

  if (existing) await ctx.db.patch(existing._id, patch);

  return { status: patch.status, flowId };
}
