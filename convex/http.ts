import { httpRouter } from 'convex/server';
import {
  addKanbanTaskInput,
  autoLinkImportsInput,
  createNodeInput,
  deleteNodeInput,
  getNodeInput,
  linkFilesInput,
  linkNodesInput,
  listLayersInput,
  listNodesInput,
  logActivityByFileInput,
  logActivityInput,
  hermesMappingRunCompleteInput,
  lookupFilesInput,
  pushCodebaseSuggestionsInput,
  reconcileEdgesInput,
  scanSnapshotGetInput,
  scanSnapshotPushInput,
  unlinkNodesInput,
  updateKanbanStatusInput,
  updateNodeInput,
} from '@arch-viz/shared';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { Id } from './_generated/dataModel';
import { errorResponse, jsonResponse, requireApiToken } from './lib/mcpAuth';
import { withMcpRoute } from './lib/mcpRoute';

const http = httpRouter();

// Hard cap on scan snapshot payload size. Roughly enough for a repo with
// ~10k file paths at 100 bytes each, well beyond any realistic personal
// project. Pushing more is almost always a CLI bug (e.g. accidental binary).
const SCAN_PAYLOAD_BYTES_LIMIT = 1_000_000;

/* -------------------------------------------------------------------------- */
/* /api/mcp/health                                                            */
/*                                                                            */
/* Kept inline (not via withMcpRoute) because it has unique multi-step logic: */
/* it joins the project + token name and uses a custom 404 message when the   */
/* token's project has been deleted out from under it.                        */
/* -------------------------------------------------------------------------- */

http.route({
  path: '/api/mcp/health',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) {
      return errorResponse(
        401,
        'unauthorized',
        'Missing or invalid API token.',
        'Set ARCHITECTURE_API_KEY to a token issued in /settings/tokens.',
      );
    }

    const project = await ctx.runQuery(internal.mcp.nodes.getProjectSummary, {
      userId: auth.userId,
      projectId: auth.projectId,
    });

    if (!project) {
      return errorResponse(
        404,
        'not_found',
        'Project for this token no longer exists.',
        'Generate a new token in /settings/tokens.',
      );
    }

    const token = await ctx.runQuery(internal.apiTokens.getTokenForHealth, {
      tokenId: auth.tokenId,
    });

    return jsonResponse({
      projectId: auth.projectId,
      projectName: project.name,
      tokenName: token?.name ?? '(unknown)',
    });
  }),
});

/* -------------------------------------------------------------------------- */
/* MCP tool routes                                                            */
/*                                                                            */
/* Each route shares the same pipeline (auth → Zod parse → run → JSON), so    */
/* we use `withMcpRoute` to keep the handler bodies focused on the one piece  */
/* that actually differs: the call into a `convex/mcp/*` internal handler.    */
/* -------------------------------------------------------------------------- */

http.route({
  path: '/api/mcp/layers/list',
  method: 'POST',
  handler: withMcpRoute({
    input: listLayersInput,
    run: async (ctx, auth) => {
      const layers = await ctx.runMutation(internal.mcp.layers.listForProject, {
        userId: auth.userId,
        projectId: auth.projectId,
      });
      return { layers };
    },
  }),
});

http.route({
  path: '/api/mcp/nodes/list',
  method: 'POST',
  handler: withMcpRoute({
    input: listNodesInput,
    run: async (ctx, auth) => {
      const nodes = await ctx.runQuery(internal.mcp.nodes.listForProject, {
        userId: auth.userId,
        projectId: auth.projectId,
      });
      return { nodes };
    },
  }),
});

http.route({
  path: '/api/mcp/nodes/get',
  method: 'POST',
  handler: withMcpRoute({
    input: getNodeInput,
    run: async (ctx, auth, { nodeId }) => {
      const node = await ctx.runQuery(internal.mcp.nodes.getDetail, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        nodeId: nodeId as Id<'nodes'>,
      });
      return { node };
    },
  }),
});

http.route({
  path: '/api/mcp/nodes/create',
  method: 'POST',
  handler: withMcpRoute({
    input: createNodeInput,
    run: async (ctx, auth, input) =>
      ctx.runMutation(internal.mcp.nodes.createForProject, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        type: input.type,
        name: input.name,
        layerId: input.layerId as Id<'projectLayers'> | undefined,
        parentId: input.parentId as Id<'nodes'> | undefined,
        description: input.description,
        files: input.files,
        positionX: input.positionX,
        positionY: input.positionY,
        semanticKind: input.semanticKind,
        productArea: input.productArea,
        capabilityKey: input.capabilityKey,
        routeHint: input.routeHint,
        mappingStatus: input.mappingStatus,
        mappingConfidence: input.mappingConfidence,
        fileRole: input.fileRole,
      }),
  }),
});

http.route({
  path: '/api/mcp/nodes/update',
  method: 'POST',
  handler: withMcpRoute({
    input: updateNodeInput,
    run: async (ctx, auth, input) => {
      await ctx.runMutation(internal.mcp.nodes.updateForProject, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        nodeId: input.nodeId as Id<'nodes'>,
        name: input.name,
        description: input.description,
        positionX: input.positionX,
        positionY: input.positionY,
        metadata: input.metadata,
        semanticKind: input.semanticKind,
        productArea: input.productArea,
        capabilityKey: input.capabilityKey,
        routeHint: input.routeHint,
        mappingStatus: input.mappingStatus,
        mappingConfidence: input.mappingConfidence,
      });
      return { ok: true };
    },
  }),
});

http.route({
  path: '/api/mcp/nodes/delete',
  method: 'POST',
  handler: withMcpRoute({
    input: deleteNodeInput,
    run: async (ctx, auth, { nodeId }) => {
      await ctx.runMutation(internal.mcp.nodes.removeForProject, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        nodeId: nodeId as Id<'nodes'>,
      });
      return { ok: true };
    },
  }),
});

http.route({
  path: '/api/mcp/files/link',
  method: 'POST',
  handler: withMcpRoute({
    input: linkFilesInput,
    run: async (ctx, auth, { nodeId, paths }) =>
      ctx.runMutation(internal.mcp.files.linkMany, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        nodeId: nodeId as Id<'nodes'>,
        paths,
      }),
  }),
});

http.route({
  path: '/api/mcp/kanban/add',
  method: 'POST',
  handler: withMcpRoute({
    input: addKanbanTaskInput,
    run: async (ctx, auth, input) =>
      ctx.runMutation(internal.mcp.kanban.addTask, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        nodeId: input.nodeId as Id<'nodes'>,
        title: input.title,
        description: input.description,
        status: input.status,
      }),
  }),
});

http.route({
  path: '/api/mcp/kanban/status',
  method: 'POST',
  handler: withMcpRoute({
    input: updateKanbanStatusInput,
    run: async (ctx, auth, { taskId, status }) => {
      await ctx.runMutation(internal.mcp.kanban.updateStatus, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        taskId: taskId as Id<'kanbanTasks'>,
        status,
      });
      return { ok: true };
    },
  }),
});

http.route({
  path: '/api/mcp/activity/log',
  method: 'POST',
  handler: withMcpRoute({
    input: logActivityInput,
    run: async (ctx, auth, input) => {
      await ctx.runMutation(internal.mcp.activity.log, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        nodeId: input.nodeId as Id<'nodes'>,
        actor: input.actor,
        message: input.message,
        metadata: input.metadata,
      });
      return { ok: true };
    },
  }),
});

/* -------------------------------------------------------------------------- */
/* /api/mcp/activity/log_by_file                                              */
/*                                                                            */
/* Hook-friendly endpoint: caller passes a repo-relative file path, server   */
/* resolves the linked node. Returns `{ matched: false }` when no node has   */
/* that file linked so a hook can no-op silently. Used by                    */
/* `.claude/hooks/log-activity.mjs` after Edit/Write tool calls.             */
/* -------------------------------------------------------------------------- */

http.route({
  path: '/api/mcp/activity/log_by_file',
  method: 'POST',
  handler: withMcpRoute({
    input: logActivityByFileInput,
    run: async (ctx, auth, input) =>
      ctx.runMutation(internal.mcp.activity.logByFile, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        filePath: input.filePath,
        actor: input.actor,
        message: input.message,
        metadata: input.metadata,
      }),
  }),
});

/* -------------------------------------------------------------------------- */
/* /api/mcp/files/auto_link                                                   */
/*                                                                            */
/* Hook + CLI endpoint: takes an importer file path and resolved imported     */
/* paths, then links the imports to every node that already owns the          */
/* importer. No-op when the importer is unlinked. See `convex/mcp/files.ts`   */
/* `autoLinkByOrigin` for the inner logic.                                    */
/* -------------------------------------------------------------------------- */

http.route({
  path: '/api/mcp/files/auto_link',
  method: 'POST',
  handler: withMcpRoute({
    input: autoLinkImportsInput,
    run: async (ctx, auth, input) =>
      ctx.runMutation(internal.mcp.files.autoLinkByOrigin, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        originFilePath: input.originFilePath,
        importedFilePaths: input.importedFilePaths,
      }),
  }),
});

/* -------------------------------------------------------------------------- */
/* /api/mcp/files/lookup                                                      */
/*                                                                            */
/* Sprint 5 item J — bulk diff of incoming paths against the project's       */
/* nodeFiles set. Post-commit hook calls this to figure out which files in   */
/* a git diff aren't yet tracked, so the next chat turn can offer to create  */
/* matching nodes.                                                            */
/* -------------------------------------------------------------------------- */

http.route({
  path: '/api/mcp/files/lookup',
  method: 'POST',
  handler: withMcpRoute({
    input: lookupFilesInput,
    run: async (ctx, auth, input) =>
      ctx.runMutation(internal.mcp.files.lookupPaths, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        paths: input.paths,
      }),
  }),
});

/* -------------------------------------------------------------------------- */
/* /api/mcp/scans/push                                                        */
/*                                                                            */
/* CLI endpoint: scan-orphans / scan-drift push their JSON payload here.     */
/* The 1MB cap is enforced inline because withMcpRoute doesn't (yet) know     */
/* about size limits, and the request body size matters before we hit Zod.   */
/* -------------------------------------------------------------------------- */

http.route({
  path: '/api/mcp/scans/push',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) {
      return errorResponse(
        401,
        'unauthorized',
        'Missing or invalid API token.',
        'Set ARCHITECTURE_API_KEY to a token issued in /settings/tokens.',
      );
    }

    const rawText = await req.text().catch(() => '');
    if (rawText.length > SCAN_PAYLOAD_BYTES_LIMIT) {
      return errorResponse(
        413,
        'payload_too_large',
        `Scan payload exceeds ${SCAN_PAYLOAD_BYTES_LIMIT} bytes`,
        'Reduce the number of files included in the scan, or split into multiple pushes.',
      );
    }

    let parsed: unknown;
    try {
      parsed = rawText.length > 0 ? JSON.parse(rawText) : {};
    } catch {
      return errorResponse(400, 'invalid_input', 'Invalid JSON body');
    }

    const validated = scanSnapshotPushInput.safeParse(parsed);
    if (!validated.success) {
      return errorResponse(400, 'invalid_input', validated.error.issues[0]?.message ?? 'invalid');
    }

    try {
      const result = await ctx.runMutation(internal.mcp.scans.pushSnapshot, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        kind: validated.data.kind,
        data: validated.data.data,
      });
      return jsonResponse(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Forbidden') || msg.includes('not in token scope')) {
        return errorResponse(403, 'forbidden', msg);
      }
      return errorResponse(400, 'invalid_input', msg);
    }
  }),
});

/* -------------------------------------------------------------------------- */
/* /api/mcp/scans/get_latest                                                  */
/*                                                                            */
/* CLI endpoint: for `arch-viz-mcp scan-orphans --check`-style flows that    */
/* want to know what was pushed last without hitting the UI.                 */
/* -------------------------------------------------------------------------- */

http.route({
  path: '/api/mcp/scans/get_latest',
  method: 'POST',
  handler: withMcpRoute({
    input: scanSnapshotGetInput,
    run: async (ctx, auth, input) => {
      const snapshot = await ctx.runQuery(internal.mcp.scans.getLatestSnapshot, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        kind: input.kind,
      });
      return { snapshot };
    },
  }),
});

/* -------------------------------------------------------------------------- */
/* /api/mcp/codebase_suggestions/push                                         */
/*                                                                            */
/* Hermes-ready bridge: callers push file-to-layer suggestions. Convex stores */
/* low-confidence rows for review and auto-applies high-confidence rows.      */
/* -------------------------------------------------------------------------- */

http.route({
  path: '/api/mcp/codebase_suggestions/push',
  method: 'POST',
  handler: withMcpRoute({
    input: pushCodebaseSuggestionsInput,
    run: async (ctx, auth, input) =>
      ctx.runMutation(internal.mcp.codebaseSuggestions.pushForProject, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        suggestions: input.suggestions.map((suggestion) => ({
          filePath: suggestion.filePath,
          runId: input.runId as Id<'hermesMappingRuns'> | undefined,
          action: suggestion.action,
          layerId: suggestion.layerId as Id<'projectLayers'> | undefined,
          targetNodeId: suggestion.targetNodeId as Id<'nodes'> | undefined,
          groupKey: suggestion.groupKey,
          suggestedNodeName: suggestion.suggestedNodeName,
          confidence: suggestion.confidence,
          reason: suggestion.reason,
          evidence: suggestion.evidence,
          semanticKind: suggestion.semanticKind,
          fileRole: suggestion.fileRole,
          source: suggestion.source,
        })),
        semanticNodeSuggestions: input.semanticNodeSuggestions.map((suggestion) => ({
          runId: input.runId as Id<'hermesMappingRuns'> | undefined,
          sourceFilePath: suggestion.sourceFilePath,
          semanticKey: suggestion.semanticKey,
          suggestedNodeName: suggestion.suggestedNodeName,
          semanticKind: suggestion.semanticKind,
          productArea: suggestion.productArea,
          capabilityKey: suggestion.capabilityKey,
          routeHint: suggestion.routeHint,
          layerId: suggestion.layerId as Id<'projectLayers'>,
          parentNodeId: suggestion.parentNodeId as Id<'nodes'> | undefined,
          confidence: suggestion.confidence,
          reason: suggestion.reason,
          evidence: suggestion.evidence,
          source: suggestion.source,
        })),
        relationshipSuggestions: input.relationshipSuggestions.map((suggestion) => ({
          runId: input.runId as Id<'hermesMappingRuns'> | undefined,
          sourceNodeId: suggestion.sourceNodeId as Id<'nodes'>,
          targetNodeId: suggestion.targetNodeId as Id<'nodes'>,
          type: suggestion.type,
          label: suggestion.label,
          confidence: suggestion.confidence,
          reason: suggestion.reason,
          evidence: suggestion.evidence,
          source: suggestion.source,
        })),
        flowSuggestions: input.flowSuggestions.map((flow) => ({
          runId: input.runId as Id<'hermesMappingRuns'> | undefined,
          title: flow.title,
          shortTitle: flow.shortTitle,
          goal: flow.goal,
          importance: flow.importance,
          curationKey: flow.curationKey,
          description: flow.description,
          kind: flow.kind,
          nodeIds: flow.nodeIds.map((nodeId) => nodeId as Id<'nodes'>),
          edgeRefs: flow.edgeRefs?.map((ref) => ({
            edgeId: ref.edgeId as Id<'nodeEdges'> | undefined,
            sourceNodeId: ref.sourceNodeId as Id<'nodes'> | undefined,
            targetNodeId: ref.targetNodeId as Id<'nodes'> | undefined,
            type: ref.type,
          })),
          steps: flow.steps.map((step) => ({
            title: step.title,
            description: step.description,
            nodeIds: step.nodeIds?.map((nodeId) => nodeId as Id<'nodes'>),
            edgeRefs: step.edgeRefs?.map((ref) => ({
              edgeId: ref.edgeId as Id<'nodeEdges'> | undefined,
              sourceNodeId: ref.sourceNodeId as Id<'nodes'> | undefined,
              targetNodeId: ref.targetNodeId as Id<'nodes'> | undefined,
              type: ref.type,
            })),
          })),
          confidence: flow.confidence,
          reason: flow.reason,
          evidence: flow.evidence,
          productArea: flow.productArea,
          source: flow.source,
        })),
      }),
  }),
});

/* -------------------------------------------------------------------------- */
/* /api/hermes/mapping-runs/complete                                          */
/*                                                                            */
/* Run-scoped submit endpoint for the VPS/Hermes worker. It uses the          */
/* per-run submit token created by the authenticated UI route, not a project  */
/* API token, so the worker can complete only the run it was given.           */
/* -------------------------------------------------------------------------- */

http.route({
  path: '/api/hermes/mapping-runs/complete',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const rawText = await req.text().catch(() => '');
    if (rawText.length > SCAN_PAYLOAD_BYTES_LIMIT) {
      return errorResponse(
        413,
        'payload_too_large',
        `Mapping payload exceeds ${SCAN_PAYLOAD_BYTES_LIMIT} bytes`,
      );
    }

    let raw: unknown;
    try {
      raw = rawText.length > 0 ? JSON.parse(rawText) : {};
    } catch {
      return errorResponse(400, 'invalid_input', 'Invalid JSON body');
    }

    const parsed = hermesMappingRunCompleteInput.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'invalid');
    }

    try {
      const result = await ctx.runMutation(internal.hermesMappingRuns.complete, {
        runId: parsed.data.runId as Id<'hermesMappingRuns'>,
        submitToken: parsed.data.submitToken,
        status: parsed.data.status,
        errorMessage: parsed.data.errorMessage,
        suggestions: parsed.data.suggestions.map((suggestion) => ({
          filePath: suggestion.filePath,
          action: suggestion.action,
          layerId: suggestion.layerId as Id<'projectLayers'> | undefined,
          targetNodeId: suggestion.targetNodeId as Id<'nodes'> | undefined,
          groupKey: suggestion.groupKey,
          suggestedNodeName: suggestion.suggestedNodeName,
          confidence: suggestion.confidence,
          reason: suggestion.reason,
          evidence: suggestion.evidence,
          semanticKind: suggestion.semanticKind,
          fileRole: suggestion.fileRole,
          source: suggestion.source,
        })),
        semanticNodeSuggestions: parsed.data.semanticNodeSuggestions.map((suggestion) => ({
          sourceFilePath: suggestion.sourceFilePath,
          semanticKey: suggestion.semanticKey,
          suggestedNodeName: suggestion.suggestedNodeName,
          semanticKind: suggestion.semanticKind,
          productArea: suggestion.productArea,
          capabilityKey: suggestion.capabilityKey,
          routeHint: suggestion.routeHint,
          layerId: suggestion.layerId as Id<'projectLayers'>,
          parentNodeId: suggestion.parentNodeId as Id<'nodes'> | undefined,
          confidence: suggestion.confidence,
          reason: suggestion.reason,
          evidence: suggestion.evidence,
          source: suggestion.source,
        })),
        relationshipSuggestions: parsed.data.relationshipSuggestions.map((suggestion) => ({
          sourceNodeId: suggestion.sourceNodeId as Id<'nodes'>,
          targetNodeId: suggestion.targetNodeId as Id<'nodes'>,
          type: suggestion.type,
          label: suggestion.label,
          confidence: suggestion.confidence,
          reason: suggestion.reason,
          evidence: suggestion.evidence,
          source: suggestion.source,
        })),
        flowSuggestions: parsed.data.flowSuggestions.map((flow) => ({
          title: flow.title,
          shortTitle: flow.shortTitle,
          goal: flow.goal,
          importance: flow.importance,
          curationKey: flow.curationKey,
          description: flow.description,
          kind: flow.kind,
          nodeIds: flow.nodeIds.map((nodeId) => nodeId as Id<'nodes'>),
          edgeRefs: flow.edgeRefs?.map((ref) => ({
            edgeId: ref.edgeId as Id<'nodeEdges'> | undefined,
            sourceNodeId: ref.sourceNodeId as Id<'nodes'> | undefined,
            targetNodeId: ref.targetNodeId as Id<'nodes'> | undefined,
            type: ref.type,
          })),
          steps: flow.steps.map((step) => ({
            title: step.title,
            description: step.description,
            nodeIds: step.nodeIds?.map((nodeId) => nodeId as Id<'nodes'>),
            edgeRefs: step.edgeRefs?.map((ref) => ({
              edgeId: ref.edgeId as Id<'nodeEdges'> | undefined,
              sourceNodeId: ref.sourceNodeId as Id<'nodes'> | undefined,
              targetNodeId: ref.targetNodeId as Id<'nodes'> | undefined,
              type: ref.type,
            })),
          })),
          confidence: flow.confidence,
          reason: flow.reason,
          evidence: flow.evidence,
          productArea: flow.productArea,
          source: flow.source,
        })),
      });
      return jsonResponse(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Invalid mapping run submit token')) {
        return errorResponse(401, 'unauthorized', 'Invalid mapping run submit token');
      }
      if (msg.includes('not found') || msg.includes('Not found')) {
        return errorResponse(404, 'not_found', msg);
      }
      return errorResponse(400, 'invalid_input', msg);
    }
  }),
});

/* -------------------------------------------------------------------------- */
/* /api/mcp/edges/{link,unlink,reconcile}                                     */
/*                                                                            */
/* Sprint 3 edge endpoints. `link` / `unlink` are AI-facing manual            */
/* classification tools. `reconcile` is the CLI's batch update — it diffs    */
/* the scanner's view of (dependency / navigation / data_flow) against the   */
/* persisted auto edges and converges, leaving manual edges alone.           */
/* -------------------------------------------------------------------------- */

http.route({
  path: '/api/mcp/edges/link',
  method: 'POST',
  handler: withMcpRoute({
    input: linkNodesInput,
    run: async (ctx, auth, input) =>
      ctx.runMutation(internal.mcp.edges.linkNodes, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        sourceNodeId: input.sourceNodeId as Id<'nodes'>,
        targetNodeId: input.targetNodeId as Id<'nodes'>,
        type: input.type,
      }),
  }),
});

http.route({
  path: '/api/mcp/edges/unlink',
  method: 'POST',
  handler: withMcpRoute({
    input: unlinkNodesInput,
    run: async (ctx, auth, input) =>
      ctx.runMutation(internal.mcp.edges.unlinkNodes, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        sourceNodeId: input.sourceNodeId as Id<'nodes'>,
        targetNodeId: input.targetNodeId as Id<'nodes'>,
        type: input.type,
      }),
  }),
});

http.route({
  path: '/api/mcp/edges/reconcile',
  method: 'POST',
  handler: withMcpRoute({
    input: reconcileEdgesInput,
    run: async (ctx, auth, input) =>
      ctx.runMutation(internal.mcp.edges.reconcileEdges, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        edges: input.edges.map((e) => ({
          sourceNodeId: e.sourceNodeId as Id<'nodes'>,
          targetNodeId: e.targetNodeId as Id<'nodes'>,
          type: e.type,
        })),
      }),
  }),
});

export default http;
