import { httpRouter } from 'convex/server';
import {
  addKanbanTaskInput,
  createNodeInput,
  deleteNodeInput,
  getNodeInput,
  linkFilesInput,
  listNodesInput,
  logActivityByFileInput,
  logActivityInput,
  updateKanbanStatusInput,
  updateNodeInput,
} from '@arch-viz/shared';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { Id } from './_generated/dataModel';
import { errorResponse, jsonResponse, requireApiToken } from './lib/mcpAuth';
import { withMcpRoute } from './lib/mcpRoute';

const http = httpRouter();

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
        parentId: input.parentId as Id<'nodes'> | undefined,
        description: input.description,
        files: input.files,
        positionX: input.positionX,
        positionY: input.positionY,
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

export default http;
