import { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';

export type AuthResult = {
  userId: Id<'profiles'>;
  projectId: Id<'projects'>;
  tokenId: Id<'apiTokens'>;
};

function readRawToken(req: Request): string | null {
  const authorization = req.headers.get('Authorization');
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;

  const legacy = req.headers.get('x-api-key')?.trim();
  return legacy && legacy.length > 0 ? legacy : null;
}

/**
 * Reads `Authorization: Bearer <token>` from the request, with `x-api-key`
 * retained as a compatibility fallback for older MCP clients.
 * Returns the resolved auth principal or null if the header is missing
 * or the token is unknown / revoked.
 */
export async function requireApiToken(ctx: ActionCtx, req: Request): Promise<AuthResult | null> {
  const raw = readRawToken(req);
  if (!raw) return null;
  const result = await ctx.runMutation(internal.apiTokens.verifyToken, { rawToken: raw });
  if (!result) return null;
  return result as AuthResult;
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  hint?: string,
): Response {
  return jsonResponse({ error: { code, message, ...(hint ? { hint } : {}) } }, status);
}
