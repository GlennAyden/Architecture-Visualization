import type { McpConfig } from './config.js';

/**
 * Structured error returned by Convex MCP HTTP routes.
 * Shape: { error: { code, message, hint? } }
 */
export interface ConvexErrorBody {
  error: {
    code: string;
    message: string;
    hint?: string;
  };
}

export class ConvexApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'ConvexApiError';
  }

  /** AI-friendly multi-line representation including the hint. */
  toToolError(): string {
    const lines = [`[${this.code}] ${this.message}`];
    if (this.hint) lines.push(`Hint: ${this.hint}`);
    return lines.join('\n');
  }
}

/**
 * Thin wrapper around fetch that POSTs JSON to a Convex MCP HTTP route,
 * carries the bearer token header, and surfaces structured errors as
 * ConvexApiError instances.
 *
 * The injectable `fetchImpl` parameter lets tests mock fetch without
 * touching globals.
 */
export class ConvexMcpClient {
  constructor(
    private readonly config: McpConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async post<TResponse>(path: string, body: unknown): Promise<TResponse> {
    const url = `${this.config.convexUrl}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ConvexApiError(
        0,
        'network_error',
        `Failed to reach Convex at ${url}: ${msg}`,
        'Check ARCHITECTURE_CONVEX_URL and your network connection.',
      );
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Body wasn't JSON. Fall through with `parsed = null` so the
        // error branch reports the raw text.
      }
    }

    if (!res.ok) {
      const body = parsed as ConvexErrorBody | null;
      const code = body?.error?.code ?? `http_${res.status}`;
      const message = body?.error?.message ?? (text.slice(0, 500) || `HTTP ${res.status}`);
      const hint = body?.error?.hint;
      throw new ConvexApiError(res.status, code, message, hint);
    }

    return parsed as TResponse;
  }
}
