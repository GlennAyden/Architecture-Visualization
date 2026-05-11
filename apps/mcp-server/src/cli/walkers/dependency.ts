/**
 * Dependency edge walker — Sprint 3.
 *
 * Reuses the (origin file → resolved imports) data produced by the main
 * scan-imports pass. For every (origin_node, imported_node) pair where
 * the two nodes differ, emits `{source, target, type: 'dependency'}`.
 *
 * A file can be linked to multiple nodes (it's a shared util) — each
 * owner contributes its own outgoing edge. Dedup happens at the CLI's
 * final reconcile step via {@link dedupeEdges}.
 */

import type { EdgeCandidate } from './shared.js';

export interface DependencyInput {
  /** Origin file path (repo-relative). */
  originFilePath: string;
  /** Nodes that link the origin. */
  originOwnerNodeIds: ReadonlyArray<string>;
  /** Resolved imports for this origin (repo-relative paths). */
  resolvedImports: ReadonlyArray<string>;
  /**
   * Map from file path → node ids that link the file. Built once across
   * the whole scan so each walker call is O(imports * owners).
   */
  fileToOwners: ReadonlyMap<string, ReadonlyArray<string>>;
}

/**
 * Emit dependency edges for one origin file.
 *
 * Returns a flat array; caller dedupes globally. Self-loops
 * (origin_node === imported_node) are filtered here because two files
 * linked to the same node are an "internal implementation detail" of
 * that node, not a cross-node dependency.
 */
export function emitDependencyEdges(input: DependencyInput): EdgeCandidate[] {
  const out: EdgeCandidate[] = [];
  for (const importedPath of input.resolvedImports) {
    const importedOwners = input.fileToOwners.get(importedPath);
    if (!importedOwners || importedOwners.length === 0) continue;
    for (const origin of input.originOwnerNodeIds) {
      for (const imported of importedOwners) {
        if (origin === imported) continue;
        out.push({
          sourceNodeId: origin,
          targetNodeId: imported,
          type: 'dependency',
        });
      }
    }
  }
  return out;
}
