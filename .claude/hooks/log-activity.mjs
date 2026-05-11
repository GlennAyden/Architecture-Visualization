#!/usr/bin/env node
// Claude Code PostToolUse hook for Edit / Write / MultiEdit.
//
// Auto-logs an "Edited <file>" activity entry to the arch-viz canvas when the
// edited file is linked to a node in the configured project. Silent no-op
// when the file is not linked, the env is missing, or the API fails — never
// blocks Claude Code's tool pipeline.
//
// Env vars (read from process env first, then `.env.local` at the repo root):
//   ARCHITECTURE_CONVEX_URL   — must end in `.convex.site`
//   ARCHITECTURE_API_KEY      — bearer token from /settings/tokens
//   ARCHITECTURE_PROJECT_ID   — token's project; informational only here,
//                               the server enforces scope from the token

import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

const PROJECT_ROOT = process.cwd();

function loadDotenv() {
  try {
    const text = readFileSync(resolve(PROJECT_ROOT, '.env.local'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
      if (!m) continue;
      const [, key, raw] = m;
      if (process.env[key] !== undefined) continue;
      const val = raw.replace(/^['"]|['"]$/g, '');
      process.env[key] = val;
    }
  } catch {
    // .env.local missing is fine — env may be provided by the OS instead.
  }
}

async function readStdinJson() {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  if (!data.trim()) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function toRepoRelative(filePath) {
  if (!filePath) return null;
  const abs = isAbsolute(filePath) ? filePath : resolve(PROJECT_ROOT, filePath);
  const rel = relative(PROJECT_ROOT, abs);
  if (!rel || rel.startsWith('..')) return null;
  return rel.replace(/\\/g, '/');
}

async function main() {
  loadDotenv();

  const url = process.env.ARCHITECTURE_CONVEX_URL;
  const apiKey = process.env.ARCHITECTURE_API_KEY;
  if (!url || !apiKey) process.exit(0); // not configured: silent no-op

  const payload = await readStdinJson();
  if (!payload) process.exit(0);

  const filePath = payload?.tool_input?.file_path;
  const rel = toRepoRelative(filePath);
  if (!rel) process.exit(0);

  const tool = payload?.tool_name ?? 'unknown';

  try {
    await fetch(`${url}/api/mcp/activity/log_by_file`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        filePath: rel,
        actor: 'hook:claude-code',
        message: `Edited ${rel}`,
        metadata: { tool },
      }),
    });
  } catch {
    // Hooks must never block Claude Code. Swallow network/api errors.
  }
  process.exit(0);
}

main().catch(() => process.exit(0));
