import { ActionCtx, httpAction } from '../_generated/server';
import {
  errorResponse,
  jsonResponse,
  requireApiToken,
  type AuthResult,
} from './mcpAuth';

/**
 * Minimal structural type matching Zod's safeParse output. Declared locally
 * (instead of importing from 'zod') so this file can compile inside Convex's
 * runtime, which doesn't bundle the zod package at root level. Any Zod
 * schema implements this shape.
 */
type SchemaLike<T> = {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: ReadonlyArray<{ message?: string }> } };
};

const UNAUTHORIZED_HINT = 'Set ARCHITECTURE_API_KEY to a token issued in /settings/tokens.';

/**
 * Maps an error thrown inside an MCP route handler to the right HTTP
 * response. Convention (matches `convex/mcp/*` internal handlers):
 *   - `Forbidden` / `not in token scope` → 403
 *   - `Not found` / `not found`         → 404
 *   - anything else                     → 400 invalid_input
 *
 * A `network_error` or true server bug would normally surface as a
 * Convex platform-level 500; we don't try to detect those here.
 */
function mapMcpError(err: unknown): Response {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('Forbidden') || msg.includes('not in token scope'))
    return errorResponse(403, 'forbidden', msg);
  if (msg.includes('Not found') || msg.includes('not found'))
    return errorResponse(404, 'not_found', msg);
  return errorResponse(400, 'invalid_input', msg);
}

/**
 * Wraps an MCP route handler with the standard pipeline:
 *   1. authenticate via `x-api-key` header (→ 401 on miss/revoked)
 *   2. parse JSON body and Zod-validate (→ 400 on parse error)
 *   3. call `run(ctx, auth, input)` and return its result as JSON
 *   4. catch + map any thrown error to a structured `{ error: {…} }`
 *
 * The wrapped value goes directly in `http.route({ handler: … })`.
 */
export function withMcpRoute<Input, Result>(opts: {
  input: SchemaLike<Input>;
  run: (ctx: ActionCtx, auth: AuthResult, input: Input) => Promise<Result>;
}) {
  return httpAction(async (ctx, req) => {
    const auth = await requireApiToken(ctx, req);
    if (!auth) {
      return errorResponse(
        401,
        'unauthorized',
        'Missing or invalid API token.',
        UNAUTHORIZED_HINT,
      );
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = opts.input.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(
        400,
        'invalid_input',
        parsed.error.issues[0]?.message ?? 'invalid',
      );
    }

    try {
      const result = await opts.run(ctx, auth, parsed.data);
      return jsonResponse(result);
    } catch (err) {
      return mapMcpError(err);
    }
  });
}
