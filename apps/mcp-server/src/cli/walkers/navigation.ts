/**
 * Navigation edge walker — Sprint 3.
 *
 * Finds three flavors of "go to another page":
 *   1. JSX `href` / `to` attributes whose value is a string literal
 *      starting with `/` (e.g. `<Link href="/dashboard">`).
 *   2. `router.push('/foo')` / `router.replace('/foo')` calls — anything
 *      with the property-access pattern `<id>.push(...)` / `.replace(...)`
 *      where the variable name on the LHS contains `router` (case-
 *      insensitive).
 *   3. `redirect('/foo')` — the Next.js `next/navigation` helper.
 *
 * Matches a captured route against `node.metadata.route` (exact string)
 * across every project node. If multiple nodes share the same route, one
 * edge is emitted per node — the spec calls this "intentionally
 * permissive". Skips self-loops (target ∈ owner set).
 *
 * Static-literal only. Template strings, computed property names, and
 * dynamic dispatch are out of scope per the Sprint 3 spec: the roadmap
 * accepts heuristic noise but never silently invents an edge.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { EdgeCandidate, NodeSnapshot, WalkInput } from './shared.js';

export interface NavigationInput extends WalkInput {
  /** All project nodes — looked up by exact `route` match. */
  allNodes: ReadonlyArray<NodeSnapshot>;
}

/** Pull the string-literal route from a JsxAttribute initializer, if any. */
function jsxAttributeRoute(attr: Node): string | null {
  if (!attr.isKind(SyntaxKind.JsxAttribute)) return null;
  const name = attr.getNameNode().getText();
  if (name !== 'href' && name !== 'to') return null;
  const init = attr.getInitializer();
  if (!init) return null;
  // <Link href="/foo">  → StringLiteral
  if (init.isKind(SyntaxKind.StringLiteral)) {
    const value = init.getLiteralText();
    return value.startsWith('/') ? value : null;
  }
  // <Link href={"/foo"}>  → JsxExpression containing a StringLiteral
  if (init.isKind(SyntaxKind.JsxExpression)) {
    const expr = init.getExpression();
    if (expr && expr.isKind(SyntaxKind.StringLiteral)) {
      const value = expr.getLiteralText();
      return value.startsWith('/') ? value : null;
    }
  }
  return null;
}

/**
 * Walk a single source file and collect every static route string the
 * file navigates to.
 */
export function collectRouteStrings(input: WalkInput): string[] {
  const routes: string[] = [];

  for (const attr of input.sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const route = jsxAttributeRoute(attr);
    if (route) routes.push(route);
  }

  for (const call of input.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    const args = call.getArguments();
    if (args.length === 0) continue;
    const firstArg = args[0];
    if (!firstArg || !firstArg.isKind(SyntaxKind.StringLiteral)) continue;
    const value = firstArg.getLiteralText();
    if (!value.startsWith('/')) continue;

    // `router.push('/foo')` / `router.replace('/foo')` — match any
    // identifier whose name includes "router" so we catch `router`,
    // `appRouter`, `nextRouter`, etc. without needing a full type
    // resolver.
    if (expr.isKind(SyntaxKind.PropertyAccessExpression)) {
      const method = expr.getName();
      if (method !== 'push' && method !== 'replace') continue;
      const obj = expr.getExpression();
      if (!obj.isKind(SyntaxKind.Identifier)) continue;
      if (!obj.getText().toLowerCase().includes('router')) continue;
      routes.push(value);
      continue;
    }

    // `redirect('/foo')` — the Next.js helper. We don't try to verify
    // it's imported from 'next/navigation'; cheap-and-loud per Sprint 3.
    if (expr.isKind(SyntaxKind.Identifier) && expr.getText() === 'redirect') {
      routes.push(value);
    }
  }

  return routes;
}

/**
 * Emit navigation edges for a single file. Each route string is matched
 * exactly against `node.metadata.route`; every matching target node
 * produces one edge per owner. Skips edges that would point a node at
 * itself (owner ∈ matched-target set) to keep the canvas clean.
 */
export function emitNavigationEdges(input: NavigationInput): EdgeCandidate[] {
  const out: EdgeCandidate[] = [];
  const routes = collectRouteStrings(input);
  if (routes.length === 0) return out;
  const ownerSet = new Set(input.ownerNodeIds);
  for (const route of routes) {
    for (const target of input.allNodes) {
      if (target.route !== route) continue;
      for (const owner of input.ownerNodeIds) {
        if (ownerSet.has(target.id) && owner === target.id) continue;
        if (owner === target.id) continue;
        out.push({
          sourceNodeId: owner,
          targetNodeId: target.id,
          type: 'navigation',
        });
      }
    }
  }
  return out;
}
