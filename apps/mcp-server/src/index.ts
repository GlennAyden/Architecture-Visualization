#!/usr/bin/env node
/**
 * Arch Viz MCP server — stdio transport.
 *
 * Bridges MCP protocol (used by Claude Code, Codex, Cursor) to the Convex
 * HTTP Actions defined in `convex/http.ts`. One MCP instance is bound to
 * exactly one project via env vars.
 *
 * Logging note: stdio is the protocol channel, so EVERY log line MUST go
 * to stderr (`console.error`) or it will corrupt the message stream.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConvexMcpClient } from './client.js';
import { ConfigError, loadConfig } from './config.js';
import { registerTools } from './tools.js';

async function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[arch-viz-mcp] ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  const client = new ConvexMcpClient(config);
  const server = new McpServer({
    name: 'arch-viz',
    version: '0.1.0',
  });

  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `[arch-viz-mcp] connected — project=${config.projectId} url=${config.convexUrl}`,
  );
}

main().catch((err) => {
  console.error('[arch-viz-mcp] fatal:', err);
  process.exit(1);
});
