/**
 * Tiny output helpers for the CLI subcommands.
 *
 * Two output channels:
 *  - `progress(msg)`  → stderr. Status lines the user reads as the scan runs.
 *  - `summary(msg)`   → stdout. The single final line / JSON the user can pipe.
 *
 * Why split? The same binary also serves stdio MCP traffic. If a CLI handler
 * accidentally writes status to stdout, a future regression that re-uses any
 * helper from the stdio path would corrupt the JSON-RPC stream. Keeping the
 * stdout channel exclusively for the final summary makes the contract obvious.
 */

export function progress(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function summary(message: string): void {
  process.stdout.write(`${message}\n`);
}
