import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
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

export default http;
