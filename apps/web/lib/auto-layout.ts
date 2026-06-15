import {
  FEATURE_NODE_DEFAULT_HEIGHT,
  FEATURE_NODE_DEFAULT_WIDTH,
  PAGE_NODE_DEFAULT_HEIGHT,
  PAGE_NODE_DEFAULT_WIDTH,
} from '@arch-viz/shared';

// Visual constants used both here (for sizing parent containers) and by
// the PageNode container-mode renderer. Keep in sync if either changes.
// Tightened from the v1 values (24 / 40 / 16) once the cluster-internal
// hierarchy arrows were dropped — less inter-child noise means we don't
// need as much breathing room.
export const CLUSTER_PADDING = 16;
export const CLUSTER_TITLE_BAR_HEIGHT = 32;
export const CLUSTER_CHILD_SPACING = 10;

// Top-level wrap behaviour. Pages flow left-to-right, wrapping once the
// next page would push past `TOP_LEVEL_MAX_ROW_WIDTH`. Pure layout —
// the canvas itself is pannable, this width just controls density.
const TOP_LEVEL_MAX_ROW_WIDTH = 2200;
const TOP_LEVEL_HSPACING = 80;
const TOP_LEVEL_VSPACING = 80;
const TOP_LEVEL_MARGIN = 40;

export interface LayoutNodeInput {
  id: string;
  type: 'page' | 'feature';
  parentId: string | null;
}

export interface LayoutResult {
  id: string;
  positionX: number;
  positionY: number;
}

/**
 * Two-phase auto-layout.
 *
 *   Phase 1 — for every node that has children: grid the children inside
 *     a virtual parent box. Compute the parent's required width/height
 *     from that grid. Children get positions RELATIVE to the parent
 *     (top-left at (PADDING, TITLE_BAR + PADDING)).
 *
 *   Phase 2 — top-level nodes (no parent in the visible set) flow into
 *     a wrap-row: each gets an absolute (x, y), wrapping to a new row
 *     once `TOP_LEVEL_MAX_ROW_WIDTH` is exceeded. Sizes used for the
 *     wrap maths are the per-parent grids computed in Phase 1.
 *
 *   Finally — absolute positions for children = parent.absolute + child.relative.
 *
 * Output is a flat list of `{id, positionX, positionY}` — what
 * `nodes.update` accepts. Container sizes aren't stored server-side; the
 * renderer (`use-canvas-sync`) recomputes the parent container's width /
 * height on the fly from its children's positions, so containers stay
 * responsive when a child is later added or removed.
 *
 * Stability: top-level pages are sorted by their `id` so the layout is
 * deterministic across re-runs (and reorder-safe — adding a node at the
 * end won't shuffle existing pages). Children within a parent are sorted
 * by `id` too for the same reason.
 */
export function computeAutoLayout(nodes: ReadonlyArray<LayoutNodeInput>): LayoutResult[] {
  if (nodes.length === 0) return [];

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const childrenByParent = new Map<string, LayoutNodeInput[]>();
  for (const n of nodes) {
    if (!n.parentId || !nodeById.has(n.parentId)) continue;
    if (n.parentId === n.id) continue;
    const list = childrenByParent.get(n.parentId) ?? [];
    list.push(n);
    childrenByParent.set(n.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  // Phase 1: per-parent grid layout for children. We store the result as
  // "relative position from parent's top-left", then attach absolute
  // coords in Phase 2 once we know where the parent sits.
  const relChildPos = new Map<string, { relX: number; relY: number }>();
  const parentSize = new Map<string, { w: number; h: number }>();

  for (const [parentId, children] of childrenByParent.entries()) {
    // Square-ish grid: cols ≈ √n. For 1–3 kids: single row. For 4: 2×2.
    // For 15 (the apps/web case): 4 cols × 4 rows, nice and compact.
    const cols = Math.max(1, Math.ceil(Math.sqrt(children.length)));
    let usedRows = 0;
    children.forEach((child, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      relChildPos.set(child.id, {
        relX: CLUSTER_PADDING + col * (FEATURE_NODE_DEFAULT_WIDTH + CLUSTER_CHILD_SPACING),
        relY:
          CLUSTER_TITLE_BAR_HEIGHT +
          CLUSTER_PADDING +
          row * (FEATURE_NODE_DEFAULT_HEIGHT + CLUSTER_CHILD_SPACING),
      });
      usedRows = Math.max(usedRows, row + 1);
    });
    const w =
      CLUSTER_PADDING * 2 + cols * FEATURE_NODE_DEFAULT_WIDTH + (cols - 1) * CLUSTER_CHILD_SPACING;
    const h =
      CLUSTER_TITLE_BAR_HEIGHT +
      CLUSTER_PADDING * 2 +
      usedRows * FEATURE_NODE_DEFAULT_HEIGHT +
      (usedRows - 1) * CLUSTER_CHILD_SPACING;
    parentSize.set(parentId, { w, h });
  }

  // Phase 2: top-level wrap-row layout. We iterate by `id` so two calls
  // with the same input produce the same output (stability matters when
  // the user re-runs auto-layout after dragging — the unchanged pages
  // shouldn't suddenly relocate).
  const topLevel = nodes
    .filter((n) => !n.parentId || n.parentId === n.id || !nodeById.has(n.parentId))
    .sort((a, b) => a.id.localeCompare(b.id));

  const absPos = new Map<string, { x: number; y: number }>();
  let curX = TOP_LEVEL_MARGIN;
  let curY = TOP_LEVEL_MARGIN;
  let rowH = 0;

  for (const n of topLevel) {
    const size = parentSize.get(n.id);
    const w = size?.w ?? (n.type === 'page' ? PAGE_NODE_DEFAULT_WIDTH : FEATURE_NODE_DEFAULT_WIDTH);
    const h =
      size?.h ?? (n.type === 'page' ? PAGE_NODE_DEFAULT_HEIGHT : FEATURE_NODE_DEFAULT_HEIGHT);

    if (curX + w > TOP_LEVEL_MAX_ROW_WIDTH && curX > TOP_LEVEL_MARGIN) {
      curX = TOP_LEVEL_MARGIN;
      curY += rowH + TOP_LEVEL_VSPACING;
      rowH = 0;
    }
    absPos.set(n.id, { x: curX, y: curY });
    curX += w + TOP_LEVEL_HSPACING;
    rowH = Math.max(rowH, h);
  }

  // Children: absolute = parent's absolute + their relative offset.
  for (const n of nodes) {
    if (!n.parentId || !nodeById.has(n.parentId)) continue;
    if (n.parentId === n.id) continue;
    const parentAbs = absPos.get(n.parentId);
    const rel = relChildPos.get(n.id);
    if (!parentAbs || !rel) continue;
    absPos.set(n.id, {
      x: parentAbs.x + rel.relX,
      y: parentAbs.y + rel.relY,
    });
  }

  return Array.from(absPos.entries()).map(([id, p]) => ({
    id,
    positionX: Math.round(p.x),
    positionY: Math.round(p.y),
  }));
}
