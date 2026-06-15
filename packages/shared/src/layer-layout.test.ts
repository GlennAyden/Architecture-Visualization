import { describe, expect, test } from 'vitest';
import {
  ARCH_LAYER_COMPACT_WIDTH,
  ARCH_LAYER_GAP,
  ARCH_LAYER_NODE_TOP,
  ARCH_LAYER_PADDING_X,
  ARCH_LAYER_WIDTH,
  computeArchLayerLayout,
  computeArchLayerGeometry,
  computeArchLayerUsage,
  estimateLayerClusterHeight,
  getArchLayerCanvasWidth,
  getArchLayerNodeX,
  getLayerFeaturePosition,
} from './layer-layout';
import { FEATURE_NODE_DEFAULT_WIDTH } from './nodes';

const layers = [
  { _id: 'surfaces', position: 0 },
  { _id: 'backend', position: 1 },
];
const productLayers = [
  { _id: 'surfaces', position: 0 },
  { _id: 'ui', position: 1 },
  { _id: 'capabilities', position: 2 },
  { _id: 'backend', position: 3 },
];

describe('layer-first architecture layout', () => {
  test('places top-level nodes in the lane owned by their layer', () => {
    const result = computeArchLayerLayout(layers, [
      node({ _id: 'ui', layerId: 'surfaces', _creationTime: 1 }),
      node({ _id: 'api', layerId: 'backend', _creationTime: 2 }),
    ]);

    expect(result.find((row) => row.id === 'ui')).toMatchObject({
      positionX: getArchLayerNodeX(0),
      positionY: ARCH_LAYER_NODE_TOP,
    });
    expect(result.find((row) => row.id === 'api')).toMatchObject({
      positionX: getArchLayerNodeX(1),
      positionY: ARCH_LAYER_NODE_TOP,
    });
  });

  test('stacks page clusters vertically inside the same lane using their child height', () => {
    const childCount = 5;
    const result = computeArchLayerLayout(layers, [
      node({ _id: 'admin', layerId: 'surfaces', _creationTime: 1 }),
      ...Array.from({ length: childCount }, (_, index) =>
        node({
          _id: `admin-child-${index}`,
          type: 'feature',
          parentId: 'admin',
          layerId: 'surfaces',
          _creationTime: index + 2,
        }),
      ),
      node({ _id: 'dashboard', layerId: 'surfaces', _creationTime: 10 }),
    ]);

    const admin = result.find((row) => row.id === 'admin')!;
    const dashboard = result.find((row) => row.id === 'dashboard')!;

    expect(dashboard.positionX).toBe(admin.positionX);
    expect(dashboard.positionY).toBeGreaterThanOrEqual(
      admin.positionY + estimateLayerClusterHeight(childCount),
    );
  });

  test('keeps feature nodes inside the visual lane instead of using two fixed columns', () => {
    const result = computeArchLayerLayout(layers, [
      node({ _id: 'surface', layerId: 'surfaces' }),
      ...Array.from({ length: 6 }, (_, index) =>
        node({
          _id: `child-${index}`,
          type: 'feature',
          parentId: 'surface',
          layerId: 'surfaces',
          _creationTime: index,
        }),
      ),
    ]);

    const layerRight = ARCH_LAYER_WIDTH;
    for (const child of result.filter((row) => row.id.startsWith('child-'))) {
      expect(child.positionX + FEATURE_NODE_DEFAULT_WIDTH).toBeLessThanOrEqual(layerRight);
    }
  });

  test('fallbacks legacy nodes without layerId to the first lane', () => {
    const result = computeArchLayerLayout(layers, [node({ _id: 'legacy', layerId: undefined })]);

    expect(result.find((row) => row.id === 'legacy')).toMatchObject({
      positionX: ARCH_LAYER_PADDING_X,
      positionY: ARCH_LAYER_NODE_TOP,
    });
  });

  test('default feature positions form a single vertical stack within lane width', () => {
    const parent = { positionX: ARCH_LAYER_PADDING_X, positionY: ARCH_LAYER_NODE_TOP };
    const first = getLayerFeaturePosition(parent, 0);
    const second = getLayerFeaturePosition(parent, 1);
    const nextLayerStart = ARCH_LAYER_WIDTH + ARCH_LAYER_GAP;

    expect(first.positionX).toBe(second.positionX);
    expect(second.positionY).toBeGreaterThan(first.positionY);
    expect(second.positionX + FEATURE_NODE_DEFAULT_WIDTH).toBeLessThan(nextLayerStart);
  });

  test('compacts empty semantic lanes so sparse product maps do not waste space', () => {
    const usage = computeArchLayerUsage(productLayers, [
      node({ _id: 'dashboard', layerId: 'surfaces' }),
      node({ _id: 'api', layerId: 'backend' }),
    ]);
    const geometry = computeArchLayerGeometry({ layers: productLayers, usage, compactEmpty: true });

    expect(geometry.map((lane) => [lane.layer._id, lane.width, lane.nodeCount])).toEqual([
      ['surfaces', ARCH_LAYER_WIDTH, 1],
      ['ui', ARCH_LAYER_COMPACT_WIDTH, 0],
      ['capabilities', ARCH_LAYER_COMPACT_WIDTH, 0],
      ['backend', ARCH_LAYER_WIDTH, 1],
    ]);
    expect(getArchLayerCanvasWidth(geometry)).toBe(
      ARCH_LAYER_WIDTH * 2 + ARCH_LAYER_COMPACT_WIDTH * 2 + ARCH_LAYER_GAP * 3,
    );
  });

  test('places nodes after compact empty lanes inside their visible lane', () => {
    const result = computeArchLayerLayout(productLayers, [
      node({ _id: 'dashboard', layerId: 'surfaces', _creationTime: 1 }),
      node({ _id: 'api', layerId: 'backend', _creationTime: 2 }),
    ]);

    const backendLeft =
      ARCH_LAYER_WIDTH +
      ARCH_LAYER_GAP +
      ARCH_LAYER_COMPACT_WIDTH +
      ARCH_LAYER_GAP +
      ARCH_LAYER_COMPACT_WIDTH +
      ARCH_LAYER_GAP;
    expect(result.find((row) => row.id === 'api')).toMatchObject({
      positionX: backendLeft + ARCH_LAYER_PADDING_X,
      positionY: ARCH_LAYER_NODE_TOP,
    });
  });

  test('expands a semantic lane as soon as it has a node', () => {
    const usage = computeArchLayerUsage(productLayers, [
      node({ _id: 'dashboard', layerId: 'surfaces' }),
      node({ _id: 'header', layerId: 'ui', semanticKind: 'ui_module' }),
    ]);
    const geometry = computeArchLayerGeometry({ layers: productLayers, usage, compactEmpty: true });

    expect(geometry.find((lane) => lane.layer._id === 'ui')).toMatchObject({
      width: ARCH_LAYER_WIDTH,
      nodeCount: 1,
      isCompact: false,
    });
    expect(usage.get('ui')?.semanticKinds).toEqual(['ui_module']);
  });

  test('is idempotent once the layer layout has been applied', () => {
    const input = [
      node({ _id: 'dashboard', layerId: 'surfaces', _creationTime: 1 }),
      node({
        _id: 'dashboard-header',
        type: 'feature',
        parentId: 'dashboard',
        layerId: 'surfaces',
        _creationTime: 2,
      }),
      node({
        _id: 'dashboard-onboarding',
        type: 'feature',
        parentId: 'dashboard',
        layerId: 'surfaces',
        _creationTime: 3,
      }),
      node({ _id: 'api', layerId: 'backend', _creationTime: 4 }),
    ];

    const first = computeArchLayerLayout(layers, input);
    const appliedInput = input.map((item) => {
      const laid = first.find((row) => row.id === item._id)!;
      return { ...item, positionX: laid.positionX, positionY: laid.positionY };
    });

    expect(computeArchLayerLayout(layers, appliedInput)).toEqual(first);
  });

  test('is idempotent when empty middle layers are compact', () => {
    const input = [
      node({ _id: 'dashboard', layerId: 'surfaces', _creationTime: 1 }),
      node({ _id: 'api', layerId: 'backend', _creationTime: 2 }),
    ];

    const first = computeArchLayerLayout(productLayers, input);
    const appliedInput = input.map((item) => {
      const laid = first.find((row) => row.id === item._id)!;
      return { ...item, positionX: laid.positionX, positionY: laid.positionY };
    });

    expect(computeArchLayerLayout(productLayers, appliedInput)).toEqual(first);
  });
});

function node(
  overrides: Partial<{
    _id: string;
    type: 'page' | 'feature';
    parentId: string | null;
    layerId: string;
    semanticKind: string;
    _creationTime: number;
  }>,
) {
  return {
    _id: overrides._id ?? 'node',
    type: overrides.type ?? 'page',
    parentId: overrides.parentId ?? null,
    layerId: overrides.layerId,
    semanticKind: overrides.semanticKind,
    positionX: 0,
    positionY: 0,
    _creationTime: overrides._creationTime ?? 0,
  };
}
