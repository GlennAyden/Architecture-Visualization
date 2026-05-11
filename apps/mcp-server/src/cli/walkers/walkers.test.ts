import { Project, type SourceFile } from 'ts-morph';
import { describe, expect, test } from 'vitest';
import { emitDependencyEdges } from './dependency.js';
import { emitNavigationEdges } from './navigation.js';
import { emitDataFlowEdges } from './data-flow.js';
import { dedupeEdges, type NodeSnapshot } from './shared.js';

/**
 * Build a ts-morph SourceFile from inline text. The walkers consume a
 * SourceFile rather than raw text so the test fixture has to mirror the
 * real parse step — that way a future ts-morph upgrade that changes JSX
 * tokenisation will be caught here.
 */
function makeSource(text: string, file = '/repo/src/x.tsx'): SourceFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: 1 },
  });
  return project.createSourceFile(file, text, { overwrite: true });
}

function snapshot(over: Partial<NodeSnapshot> & { id: string }): NodeSnapshot {
  return { filePaths: new Set(), ...over };
}

/* ------------------------------------------------------------------------- */
/* Dependency walker                                                          */
/* ------------------------------------------------------------------------- */

describe('emitDependencyEdges', () => {
  test('emits a dependency edge when the importer node differs from the imported node', () => {
    // WHY: this is the core promise of Sprint 3 — every cross-node import
    // surfaces as a dependency arrow on the canvas. Without it the user
    // can't see what depends on what without reading source.
    const edges = emitDependencyEdges({
      originFilePath: 'src/a.ts',
      originOwnerNodeIds: ['nodeA'],
      resolvedImports: ['src/b.ts'],
      fileToOwners: new Map([
        ['src/a.ts', ['nodeA']],
        ['src/b.ts', ['nodeB']],
      ]),
    });
    expect(edges).toEqual([
      { sourceNodeId: 'nodeA', targetNodeId: 'nodeB', type: 'dependency' },
    ]);
  });

  test('emits one edge per importer-owner when the importer file is linked to multiple nodes', () => {
    // WHY: a shared util can legitimately live on two nodes. Both owners
    // should get their own outgoing edge; collapsing them would erase
    // useful information (the user picks which one is canonical later).
    const edges = emitDependencyEdges({
      originFilePath: 'src/shared.ts',
      originOwnerNodeIds: ['A1', 'A2'],
      resolvedImports: ['src/lib.ts'],
      fileToOwners: new Map([
        ['src/shared.ts', ['A1', 'A2']],
        ['src/lib.ts', ['B']],
      ]),
    });
    expect(edges).toEqual([
      { sourceNodeId: 'A1', targetNodeId: 'B', type: 'dependency' },
      { sourceNodeId: 'A2', targetNodeId: 'B', type: 'dependency' },
    ]);
  });

  test('dedupeEdges collapses (A1,B) seen twice to a single entry', () => {
    // WHY: without dedup, multi-node files would explode the edge graph —
    // a file linked to N owners that imports a file linked to M owners
    // would emit N×M edges, and the 2000-cap would trip on small repos.
    const out = dedupeEdges([
      { sourceNodeId: 'A1', targetNodeId: 'B', type: 'dependency' },
      { sourceNodeId: 'A1', targetNodeId: 'B', type: 'dependency' },
      { sourceNodeId: 'A2', targetNodeId: 'B', type: 'dependency' },
    ]);
    expect(out).toEqual([
      { sourceNodeId: 'A1', targetNodeId: 'B', type: 'dependency' },
      { sourceNodeId: 'A2', targetNodeId: 'B', type: 'dependency' },
    ]);
  });

  test('does not emit a self-loop when importer and imported nodes coincide', () => {
    // WHY: two files on the same node importing each other is an
    // internal implementation detail, not a node-to-node dependency.
    // Emitting it would clutter the canvas with self-arrows.
    const edges = emitDependencyEdges({
      originFilePath: 'src/a.ts',
      originOwnerNodeIds: ['nodeA'],
      resolvedImports: ['src/b.ts'],
      fileToOwners: new Map([
        ['src/a.ts', ['nodeA']],
        ['src/b.ts', ['nodeA']],
      ]),
    });
    expect(edges).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* Navigation walker                                                          */
/* ------------------------------------------------------------------------- */

describe('emitNavigationEdges', () => {
  test('emits a navigation edge for a JSX <Link href="/dashboard"> matching node.metadata.route', () => {
    // WHY: navigation arrows are the only way the canvas can show "this
    // page sends the user here" without re-parsing the route table.
    // Missing this case would make Sprint 3's most user-visible feature
    // silently do nothing.
    const sourceFile = makeSource(
      'export default function P() { return <Link href="/dashboard">go</Link>; }',
    );
    const edges = emitNavigationEdges({
      filePath: 'src/login.tsx',
      ownerNodeIds: ['login'],
      sourceFile,
      allNodes: [snapshot({ id: 'dashboard', route: '/dashboard' })],
    });
    expect(edges).toEqual([
      { sourceNodeId: 'login', targetNodeId: 'dashboard', type: 'navigation' },
    ]);
  });

  test('emits a navigation edge for router.push("/auth/login") matching node.metadata.route', () => {
    // WHY: programmatic navigation (router.push) is just as load-bearing
    // as JSX <Link>. Treating only one would skew the graph toward
    // declarative routes, hiding imperative flows like post-submit
    // redirects that are exactly where bugs hide.
    const sourceFile = makeSource(
      'function f(router) { router.push("/auth/login"); }',
    );
    const edges = emitNavigationEdges({
      filePath: 'src/x.tsx',
      ownerNodeIds: ['home'],
      sourceFile,
      allNodes: [snapshot({ id: 'login', route: '/auth/login' })],
    });
    expect(edges).toEqual([
      { sourceNodeId: 'home', targetNodeId: 'login', type: 'navigation' },
    ]);
  });

  test('emits nothing when no project node owns the navigated route', () => {
    // WHY: navigation arrows must skip when no target node exists. The
    // alternative (emit toward a placeholder) would clutter the canvas
    // with phantom edges that the user can't even click through, eroding
    // the canvas's "if it's drawn, it means something" guarantee.
    const sourceFile = makeSource('<Link href="/none" />');
    const edges = emitNavigationEdges({
      filePath: 'src/x.tsx',
      ownerNodeIds: ['home'],
      sourceFile,
      allNodes: [snapshot({ id: 'dashboard', route: '/dashboard' })],
    });
    expect(edges).toEqual([]);
  });

  test('does not match dynamic template-string routes like router.push(`/u/${id}`)', () => {
    // WHY: the roadmap explicitly limits the walker to static literals.
    // Resolving template strings would require a runtime evaluator and
    // would invent edges the user can't reason about. Better to miss an
    // edge than fabricate one.
    const sourceFile = makeSource('function f(router, id) { router.push(`/u/${id}`); }');
    const edges = emitNavigationEdges({
      filePath: 'src/x.tsx',
      ownerNodeIds: ['home'],
      sourceFile,
      allNodes: [snapshot({ id: 'user', route: '/u/1' })],
    });
    expect(edges).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* Data-flow walker                                                           */
/* ------------------------------------------------------------------------- */

describe('emitDataFlowEdges', () => {
  test('emits a data_flow edge for fetch("/api/login") matching node.metadata.apiPaths', () => {
    // WHY: REST-style fetch is the canonical data-flow signal for any
    // codebase that isn't pure Convex. Skipping it would tie data_flow
    // arrows to a single stack and break the project's "stack-agnostic"
    // story.
    const sourceFile = makeSource("async function f() { await fetch('/api/login'); }");
    const edges = emitDataFlowEdges({
      filePath: 'src/login.tsx',
      ownerNodeIds: ['login'],
      sourceFile,
      allNodes: [snapshot({ id: 'authApi', apiPaths: ['/api/login'] })],
    });
    expect(edges).toEqual([
      { sourceNodeId: 'login', targetNodeId: 'authApi', type: 'data_flow' },
    ]);
  });

  test('emits a data_flow edge for useMutation(api.foo.bar) with canonical "foo.bar" apiPaths form', () => {
    // WHY: Convex hooks are the dominant data-flow signal in this stack.
    // We strip the leading `api.` namespace because it's a fixed token
    // — keeping it would force every node owner to remember to type the
    // prefix or silently lose the edge. Canonical form documented in
    // walkers/data-flow.ts header.
    const sourceFile = makeSource(
      "import { useMutation } from 'convex/react'; function f() { useMutation(api.foo.bar); }",
    );
    const edges = emitDataFlowEdges({
      filePath: 'src/x.tsx',
      ownerNodeIds: ['client'],
      sourceFile,
      allNodes: [snapshot({ id: 'server', apiPaths: ['foo.bar'] })],
    });
    expect(edges).toEqual([
      { sourceNodeId: 'client', targetNodeId: 'server', type: 'data_flow' },
    ]);
  });

  test('emits a data_flow edge for convexClient.mutation(api.foo.bar) via property-access call', () => {
    // WHY: Convex code outside React (cron jobs, edge runtimes) uses the
    // method form. Treating only the hook form would create a blind spot
    // for server-to-server calls — exactly where data flow is hardest
    // to trace by hand.
    const sourceFile = makeSource(
      'function f(convexClient) { convexClient.mutation(api.foo.bar, {}); }',
    );
    const edges = emitDataFlowEdges({
      filePath: 'src/x.tsx',
      ownerNodeIds: ['client'],
      sourceFile,
      allNodes: [snapshot({ id: 'server', apiPaths: ['foo.bar'] })],
    });
    expect(edges).toEqual([
      { sourceNodeId: 'client', targetNodeId: 'server', type: 'data_flow' },
    ]);
  });
});
