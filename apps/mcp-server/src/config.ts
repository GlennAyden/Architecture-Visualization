/**
 * MCP server runtime configuration parsed from environment variables.
 *
 * The MCP server is configured per-instance via env vars set in the user's
 * MCP client config (claude_desktop_config.json, .codex/mcp.json, etc.).
 * Each instance writes to a single project.
 */

export interface McpConfig {
  /** Convex HTTP base URL, e.g. https://dazzling-seahorse-444.convex.site */
  convexUrl: string;
  /** Raw API token (starts with archv_) */
  apiKey: string;
  /** Project id this MCP instance is bound to */
  projectId: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Parses and validates MCP server config from a given env-like record.
 * Throws ConfigError with an actionable message on any problem.
 *
 * Exported so tests can pass a synthetic env; production code passes
 * `process.env`.
 */
export function loadConfig(env: Record<string, string | undefined>): McpConfig {
  const convexUrl = env.ARCHITECTURE_CONVEX_URL?.trim();
  const apiKey = env.ARCHITECTURE_API_KEY?.trim();
  const projectId = env.ARCHITECTURE_PROJECT_ID?.trim();

  if (!convexUrl) {
    throw new ConfigError(
      'ARCHITECTURE_CONVEX_URL is required. Set it to your Convex deployment HTTP URL, e.g. https://dazzling-seahorse-444.convex.site',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(convexUrl);
  } catch {
    throw new ConfigError(`ARCHITECTURE_CONVEX_URL is not a valid URL: ${convexUrl}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ConfigError(
      `ARCHITECTURE_CONVEX_URL must use http or https, got: ${parsed.protocol}`,
    );
  }

  // Convex HTTP Actions are served on the .convex.site subdomain, NOT
  // .convex.cloud. Using .cloud returns 404 for every MCP route with no
  // useful error — catch the mistake here at startup instead.
  if (parsed.hostname.endsWith('.convex.cloud')) {
    throw new ConfigError(
      `ARCHITECTURE_CONVEX_URL points to ${parsed.hostname} — Convex HTTP Actions are served on .convex.site, not .convex.cloud. Replace .convex.cloud with .convex.site.`,
    );
  }

  if (!apiKey) {
    throw new ConfigError(
      'ARCHITECTURE_API_KEY is required. Generate one at /settings/tokens in the web app.',
    );
  }
  if (!apiKey.startsWith('archv_')) {
    throw new ConfigError(
      'ARCHITECTURE_API_KEY does not look like a valid token (expected prefix "archv_"). Regenerate at /settings/tokens.',
    );
  }

  if (!projectId) {
    throw new ConfigError(
      'ARCHITECTURE_PROJECT_ID is required. Copy it from the URL of the project canvas (/canvas/<projectId>).',
    );
  }

  // Strip a trailing slash so client.ts can blindly concatenate paths.
  const normalizedUrl = convexUrl.endsWith('/') ? convexUrl.slice(0, -1) : convexUrl;

  return { convexUrl: normalizedUrl, apiKey, projectId };
}
