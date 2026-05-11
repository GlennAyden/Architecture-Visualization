/**
 * Data-flow edge walker — Sprint 3.
 *
 * Finds three flavors of "this page hits a backend":
 *   1. `fetch('/api/...')` / `fetch("/api/...")` — literal-string only.
 *   2. Convex `useMutation(api.foo.bar)` / `useQuery(...)` / `useAction(...)`.
 *   3. Convex client method calls: any `<id>.mutation(api.foo.bar, …)`,
 *      `.query(api.foo.bar, …)`, `.action(api.foo.bar, …)`.
 *
 * ### Canonical apiPaths form
 *
 * For Convex `api.foo.bar`, the walker captures the dotted path **after**
 * `api.` — i.e. `foo.bar`. A node owns the call if `metadata.apiPaths`
 * contains the exact string `foo.bar`. The leading `api.` segment is
 * dropped because it's a fixed namespace token and adds no information;
 * keeping `apiPaths` free of it matches how Convex itself addresses
 * server functions (the module path is `convex/foo.ts:bar`, surfaced to
 * the client as `api.foo.bar`).
 *
 * For `fetch('/api/login')` the canonical form is the raw URL path —
 * `metadata.apiPaths` would contain `'/api/login'`.
 *
 * Static-literal only — template strings, computed indexing, and
 * dynamic dispatch are skipped. The spec accepts heuristic noise but
 * never silently invents an edge.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { EdgeCandidate, NodeSnapshot, WalkInput } from './shared.js';

export interface DataFlowInput extends WalkInput {
  /** All project nodes — matched by exact `apiPaths[]` membership. */
  allNodes: ReadonlyArray<NodeSnapshot>;
}

/**
 * Reduce a PropertyAccessExpression like `api.foo.bar` to its dotted
 * tail after the root identifier. Returns null when the root isn't a
 * plain identifier named `api`, or when any intermediate step isn't a
 * plain identifier (e.g. `api[x].bar`).
 */
function extractApiTail(expr: Node): string | null {
  if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return null;
  const segments: string[] = [];
  let current: Node = expr;
  while (current.isKind(SyntaxKind.PropertyAccessExpression)) {
    segments.unshift(current.getName());
    current = current.getExpression();
  }
  if (!current.isKind(SyntaxKind.Identifier)) return null;
  if (current.getText() !== 'api') return null;
  if (segments.length === 0) return null;
  return segments.join('.');
}

/**
 * Walk a source file and collect every API identifier referenced.
 * Returns the canonical string form (see file header comment for the
 * shape) — caller compares against `node.metadata.apiPaths`.
 */
export function collectApiIdentifiers(input: WalkInput): string[] {
  const out: string[] = [];
  for (const call of input.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    const args = call.getArguments();
    if (args.length === 0) continue;

    // 1. fetch('/api/...')
    if (expr.isKind(SyntaxKind.Identifier) && expr.getText() === 'fetch') {
      const firstArg = args[0];
      if (firstArg && firstArg.isKind(SyntaxKind.StringLiteral)) {
        const value = firstArg.getLiteralText();
        if (value.startsWith('/')) out.push(value);
      }
      continue;
    }

    // 2. useMutation(api.foo.bar) / useQuery(...) / useAction(...)
    if (expr.isKind(SyntaxKind.Identifier)) {
      const name = expr.getText();
      if (name === 'useMutation' || name === 'useQuery' || name === 'useAction') {
        const firstArg = args[0];
        if (firstArg) {
          const tail = extractApiTail(firstArg);
          if (tail) out.push(tail);
        }
        continue;
      }
    }

    // 3. <id>.mutation(api.foo.bar, …) / .query / .action
    if (expr.isKind(SyntaxKind.PropertyAccessExpression)) {
      const method = expr.getName();
      if (method !== 'mutation' && method !== 'query' && method !== 'action') continue;
      const firstArg = args[0];
      if (!firstArg) continue;
      const tail = extractApiTail(firstArg);
      if (tail) out.push(tail);
    }
  }
  return out;
}

/**
 * Emit data-flow edges for one file. Each captured API identifier is
 * matched (exact string) against every node's `metadata.apiPaths`. A
 * match contributes one edge per file-owner, skipping self-loops.
 */
export function emitDataFlowEdges(input: DataFlowInput): EdgeCandidate[] {
  const out: EdgeCandidate[] = [];
  const apiIds = collectApiIdentifiers(input);
  if (apiIds.length === 0) return out;
  for (const apiId of apiIds) {
    for (const target of input.allNodes) {
      if (!target.apiPaths || target.apiPaths.length === 0) continue;
      if (!target.apiPaths.includes(apiId)) continue;
      for (const owner of input.ownerNodeIds) {
        if (owner === target.id) continue;
        out.push({
          sourceNodeId: owner,
          targetNodeId: target.id,
          type: 'data_flow',
        });
      }
    }
  }
  return out;
}
