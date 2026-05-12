#!/usr/bin/env node
// Claude Code PostToolUse hook for Bash matching `git commit`.
//
// After every commit, list the files in HEAD's diff, ask the canvas which
// of them aren't tracked by any node yet, and append the unlinked ones to
// `.arch-viz/suggestions.json`. The next chat turn can then invoke the
// `/arch-suggest-nodes` slash command to walk the list and propose
// `create_node` follow-ups.
//
// Constraints (matching every other hook in this repo):
//   - NEVER block Claude Code. Swallow every error, exit 0.
//   - Cap suggestions file at the last 5 commits so it doesn't grow.
//   - Skip silently when env isn't configured, when not in a git repo,
//     or when the bash command isn't recognisably a commit.

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ROOT = process.cwd();
const SUGGESTIONS_DIR = resolve(PROJECT_ROOT, '.arch-viz');
const SUGGESTIONS_FILE = resolve(SUGGESTIONS_DIR, 'suggestions.json');
const KEEP_LAST_N = 5;
const MAX_FILES_PER_COMMIT = 200;

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

/**
 * Recognise the bash command we just ran as a git commit. We deliberately
 * match liberally: `git commit -m "..."`, `git commit --amend`, `git
 * commit -F file`, and even multi-line commits all qualify. We do NOT
 * want to recognise `git commit -n` followed by a `--dry-run` style flag
 * because nothing changed in HEAD — guard against that.
 */
function isCommitCommand(rawCommand) {
  if (typeof rawCommand !== 'string') return false;
  if (!/\bgit\s+commit\b/.test(rawCommand)) return false;
  if (/--dry-run/.test(rawCommand)) return false;
  return true;
}

function git(args) {
  try {
    return execSync(`git ${args}`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function changedFilesForHead() {
  // HEAD~1..HEAD covers normal commits. For the very first commit there's
  // no HEAD~1, so we fall back to listing every tracked file.
  const hasParent = git('rev-parse --verify HEAD~1');
  const list = hasParent
    ? git('diff --name-only HEAD~1 HEAD')
    : git('ls-tree -r --name-only HEAD');
  if (!list) return [];
  return list
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.length <= 500);
}

function commitMeta() {
  const sha = git('rev-parse HEAD');
  const subject = git('log -1 --format=%s');
  return { sha: sha ?? null, subject: subject ?? null };
}

function pruneOlder(entries) {
  // Keep the most recent N entries by `commitedAt` desc.
  entries.sort((a, b) => (b.committedAt ?? 0) - (a.committedAt ?? 0));
  return entries.slice(0, KEEP_LAST_N);
}

async function main() {
  loadDotenv();

  const url = process.env.ARCHITECTURE_CONVEX_URL;
  const apiKey = process.env.ARCHITECTURE_API_KEY;
  if (!url || !apiKey) process.exit(0);

  const payload = await readStdinJson();
  if (!payload) process.exit(0);

  const cmd = payload?.tool_input?.command;
  if (!isCommitCommand(cmd)) process.exit(0);

  const meta = commitMeta();
  if (!meta.sha) process.exit(0);

  const changed = changedFilesForHead().slice(0, MAX_FILES_PER_COMMIT);
  if (changed.length === 0) process.exit(0);

  let unlinked = changed;
  try {
    const res = await fetch(`${url}/api/mcp/files/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ paths: changed }),
    });
    if (res.ok) {
      const body = await res.json();
      if (Array.isArray(body?.unlinked)) unlinked = body.unlinked;
    }
  } catch {
    // Network/api failures: keep the local-only conservative answer
    // (treat every changed file as a candidate). The slash command
    // will let the user filter later.
  }

  if (unlinked.length === 0) process.exit(0);

  let existing = [];
  try {
    const raw = readFileSync(SUGGESTIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.entries)) existing = parsed.entries;
  } catch {
    // First run or corrupt file — start fresh.
  }

  // Replace an existing entry for the same sha (commit amended / re-run).
  const filtered = existing.filter((e) => e.sha !== meta.sha);
  filtered.push({
    sha: meta.sha,
    subject: meta.subject ?? '',
    committedAt: Date.now(),
    unlinkedFiles: unlinked,
  });
  const pruned = pruneOlder(filtered);

  try {
    mkdirSync(SUGGESTIONS_DIR, { recursive: true });
    writeFileSync(
      SUGGESTIONS_FILE,
      JSON.stringify({ schemaVersion: 1, entries: pruned }, null, 2),
      'utf8',
    );
  } catch {
    // Hooks must never block Claude Code. Swallow filesystem errors.
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
