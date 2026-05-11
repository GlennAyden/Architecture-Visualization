import { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';

export type AuthResult = {
  userId: Id<'profiles'>;
  projectId: Id<'projects'>;
  tokenId: Id<'apiTokens'>;
};

/**
 * Reads `x-api-key` from the request, verifies against apiTokens.
 * Returns the resolved auth principal or null if the header is missing
 * or the token is unknown / revoked.
 */
export async function requireApiToken(
  ctx: ActionCtx,
  req: Request,
): Promise<AuthResult | null> {
  const raw = req.headers.get('x-api-key');
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
  return jsonResponse(
    { error: { code, message, ...(hint ? { hint } : {}) } },
    status,
  );
}
