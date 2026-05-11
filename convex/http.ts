import { httpRouter } from 'convex/server';
import { createNodeInput, getNodeInput, updateNodeInput } from '@arch-viz/shared';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { Id } from './_generated/dataModel';
import { errorResponse, jsonResponse, requireApiToken } from './lib/mcpAuth';

const http = httpRouter();

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

http.route({
  path: '/api/mcp/nodes/list',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) {
      return errorResponse(401, 'unauthorized', 'Missing or invalid API token.');
    }
    try {
      const nodes = await ctx.runQuery(internal.mcp.nodes.listForProject, {
        userId: auth.userId,
        projectId: auth.projectId,
      });
      return jsonResponse({ nodes });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Forbidden')) return errorResponse(403, 'forbidden', msg);
      if (msg.includes('Not found')) return errorResponse(404, 'not_found', msg);
      return errorResponse(500, 'internal', msg);
    }
  }),
});

http.route({
  path: '/api/mcp/nodes/get',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) return errorResponse(401, 'unauthorized', 'Missing or invalid API token.');

    const raw = await req.json().catch(() => ({}));
    const parsed = getNodeInput.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'invalid');
    }

    try {
      const node = await ctx.runQuery(internal.mcp.nodes.getDetail, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        nodeId: parsed.data.nodeId as Id<'nodes'>,
      });
      return jsonResponse({ node });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Forbidden') || msg.includes('not in token scope'))
        return errorResponse(403, 'forbidden', msg);
      if (msg.includes('Not found') || msg.includes('not found'))
        return errorResponse(404, 'not_found', msg);
      return errorResponse(400, 'invalid_input', msg);
    }
  }),
});

http.route({
  path: '/api/mcp/nodes/create',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) return errorResponse(401, 'unauthorized', 'Missing or invalid API token.');

    const raw = await req.json().catch(() => ({}));
    const parsed = createNodeInput.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'invalid');
    }

    try {
      const result = await ctx.runMutation(internal.mcp.nodes.createForProject, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        type: parsed.data.type,
        name: parsed.data.name,
        parentId: parsed.data.parentId as Id<'nodes'> | undefined,
        description: parsed.data.description,
        files: parsed.data.files,
        positionX: parsed.data.positionX,
        positionY: parsed.data.positionY,
      });
      return jsonResponse(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Forbidden') || msg.includes('not in token scope'))
        return errorResponse(403, 'forbidden', msg);
      if (msg.includes('Not found')) return errorResponse(404, 'not_found', msg);
      return errorResponse(400, 'invalid_input', msg);
    }
  }),
});

http.route({
  path: '/api/mcp/nodes/update',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) return errorResponse(401, 'unauthorized', 'Missing or invalid API token.');

    const raw = await req.json().catch(() => ({}));
    const parsed = updateNodeInput.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'invalid');
    }

    try {
      await ctx.runMutation(internal.mcp.nodes.updateForProject, {
        userId: auth.userId,
        scopeProjectId: auth.projectId,
        nodeId: parsed.data.nodeId as Id<'nodes'>,
        name: parsed.data.name,
        description: parsed.data.description,
        positionX: parsed.data.positionX,
        positionY: parsed.data.positionY,
      });
      return jsonResponse({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Forbidden') || msg.includes('not in token scope'))
        return errorResponse(403, 'forbidden', msg);
      if (msg.includes('Not found')) return errorResponse(404, 'not_found', msg);
      return errorResponse(400, 'invalid_input', msg);
    }
  }),
});

export default http;
