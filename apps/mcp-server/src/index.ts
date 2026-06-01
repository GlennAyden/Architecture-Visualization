#!/usr/bin/env node
/**
 * Arch Viz MCP server — dual-mode entry point.
 *
 * Two modes:
 *  1. `arch-viz-mcp` (no args)       → stdio MCP server. Reads JSON-RPC on
 *     stdin, writes on stdout. EVERY log line goes to stderr so it doesn't
 *     corrupt the protocol channel.
 *  2. `arch-viz-mcp <subcommand>`    → CLI mode. Subcommand handler is run
 *     and the process exits with its return code. Available subcommands:
 *       - scan-imports → walk linked files, batch-call /api/mcp/files/auto_link
 *       - scan-orphans → diff disk vs canvas, push orphans snapshot
 *       - scan-drift   → check linked paths exist, push drift snapshot
 *       - push-suggestions → push Hermes-ready file-to-layer suggestions
 *
 * The dispatch logic intentionally checks `process.argv[2]` against the
 * known subcommand list before doing anything else — that way an
 * unrecognized arg falls through to stdio rather than failing loudly,
 * mirroring how MCP clients sometimes pass benign extra flags.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConvexMcpClient } from './client.js';
import { ConfigError, loadConfig } from './config.js';
import { registerTools } from './tools.js';

// CLI handlers are dynamic-imported on demand so the stdio path never pays
// the cost of loading ts-morph (a ~MB-scale module) at startup.

type Subcommand = 'scan-imports' | 'scan-orphans' | 'scan-drift' | 'push-suggestions';

const SUBCOMMANDS: ReadonlySet<Subcommand> = new Set([
  'scan-imports',
  'scan-orphans',
  'scan-drift',
  'push-suggestions',
]);

function printHelp(): void {
  // stderr so it never collides with a piped consumer; matches the rest of
  // the CLI which reserves stdout for the final summary.
  const lines = [
    'arch-viz-mcp — Architecture Visualization MCP server + CLI',
    '',
    'Usage:',
    '  arch-viz-mcp                    Run stdio MCP server (default)',
    '  arch-viz-mcp scan-imports       Walk linked files and auto-link their imports',
    '  arch-viz-mcp scan-orphans       Push an orphan-files snapshot for this project',
    '  arch-viz-mcp scan-drift         Push a drift (missing/renamed) snapshot',
    '  arch-viz-mcp push-suggestions --from-json <path>',
    '  arch-viz-mcp --help             Show this message',
    '',
    'Environment variables (all modes):',
    '  ARCHITECTURE_CONVEX_URL         https://<deployment>.convex.site',
    '  ARCHITECTURE_API_KEY            archv_… token from /settings/tokens',
    '  ARCHITECTURE_PROJECT_ID         id from /canvas/<projectId>',
  ];
  process.stderr.write(lines.join('\n') + '\n');
}

async function runStdioServer(): Promise<void> {
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
    version: '0.4.0',
  });

  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[arch-viz-mcp] connected — project=${config.projectId} url=${config.convexUrl}`);
}

async function runSubcommand(name: Subcommand, rest: string[]): Promise<number> {
  try {
    switch (name) {
      case 'scan-imports': {
        const { runScanImports } = await import('./cli/scan-imports.js');
        return await runScanImports(rest);
      }
      case 'scan-orphans': {
        const { runScanOrphans } = await import('./cli/scan-orphans.js');
        return await runScanOrphans(rest);
      }
      case 'scan-drift': {
        const { runScanDrift } = await import('./cli/scan-drift.js');
        return await runScanDrift(rest);
      }
      case 'push-suggestions': {
        const { runPushSuggestions } = await import('./cli/push-suggestions.js');
        return await runPushSuggestions(rest);
      }
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[arch-viz-mcp] ${err.message}`);
      return 2;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[arch-viz-mcp] ${name} failed: ${msg}`);
    return 1;
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2];

  if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  }

  if (arg && SUBCOMMANDS.has(arg as Subcommand)) {
    const code = await runSubcommand(arg as Subcommand, process.argv.slice(3));
    process.exit(code);
  }

  // Default mode: stdio MCP server. Unrecognized args fall through here on
  // purpose — the stdio handshake is the safer default for a process the
  // user may have wired up to their editor.
  await runStdioServer();
}

main().catch((err) => {
  console.error('[arch-viz-mcp] fatal:', err);
  process.exit(1);
});
