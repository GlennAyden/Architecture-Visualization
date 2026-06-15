import { describe, expect, test } from 'vitest';
import {
  ARCH_LAYER_GAP,
  ARCH_LAYER_NODE_TOP,
  ARCH_LAYER_PADDING_X,
  ARCH_LAYER_WIDTH,
  computeArchLayerLayout,
  estimateLayerClusterHeight,
  getArchLayerNodeX,
  getLayerFeaturePosition,
} from './layer-layout';
import { FEATURE_NODE_DEFAULT_WIDTH } from './nodes';

const layers = [
  { _id: 'surfaces', position: 0 },
  { _id: 'backend', position: 1 },
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
});

function node(
  overrides: Partial<{
    _id: string;
    type: 'page' | 'feature';
    parentId: string | null;
    layerId: string;
    _creationTime: number;
  }>,
) {
  return {
    _id: overrides._id ?? 'node',
    type: overrides.type ?? 'page',
    parentId: overrides.parentId ?? null,
    layerId: overrides.layerId,
    positionX: 0,
    positionY: 0,
    _creationTime: overrides._creationTime ?? 0,
  };
}
