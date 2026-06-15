import { describe, expect, test } from 'vitest';
import {
  ARCH_LAYER_GAP,
  ARCH_LAYER_NODE_SPACING,
  ARCH_LAYER_NODE_TOP,
  ARCH_LAYER_PADDING_X,
  ARCH_LAYER_WIDTH,
} from '@arch-viz/shared';
import { defaultNodePosition } from './layers';

describe('defaultNodePosition', () => {
  test('places page nodes in the requested layer lane', () => {
    const position = defaultNodePosition({
      type: 'page',
      layer: { position: 2 } as never,
      siblingCount: 3,
    });

    expect(position).toEqual({
      x: 2 * (ARCH_LAYER_WIDTH + ARCH_LAYER_GAP) + ARCH_LAYER_PADDING_X,
      y: ARCH_LAYER_NODE_TOP + 3 * ARCH_LAYER_NODE_SPACING,
    });
  });

  test('places feature nodes in a vertical stack inside the parent lane', () => {
    const parent = {
      positionX: ARCH_LAYER_PADDING_X,
      positionY: ARCH_LAYER_NODE_TOP,
    } as never;

    const first = defaultNodePosition({
      type: 'feature',
      parent,
      siblingCount: 0,
    });
    const second = defaultNodePosition({
      type: 'feature',
      parent,
      siblingCount: 1,
    });

    expect(second.x).toBe(first.x);
    expect(second.y).toBeGreaterThan(first.y);
    expect(second.x).toBeLessThan(ARCH_LAYER_WIDTH);
  });
});
