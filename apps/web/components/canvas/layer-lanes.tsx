'use client';

import { ViewportPortal } from '@xyflow/react';

import {
  LAYER_CANVAS_HEIGHT,
  LAYER_CANVAS_TOP,
  LAYER_GAP,
  LAYER_HEADER_HEIGHT,
  LAYER_WIDTH,
  getLayerX,
  sortLayers,
} from '@/lib/architecture-layers';

interface Props {
  layers:
    | Array<{
        _id: string;
        name: string;
        position: number;
      }>
    | undefined;
}

export function LayerLanes({ layers }: Props) {
  const sortedLayers = sortLayers(layers);
  if (sortedLayers.length === 0) return null;

  return (
    <ViewportPortal>
      <div
        className="pointer-events-none absolute"
        style={{
          left: 0,
          top: LAYER_CANVAS_TOP,
          width: sortedLayers.length * LAYER_WIDTH + (sortedLayers.length - 1) * LAYER_GAP,
          height: LAYER_CANVAS_HEIGHT,
        }}
      >
        {sortedLayers.map((layer, index) => (
          <div
            key={layer._id}
            className="absolute rounded-lg border border-white/[0.07] bg-white/[0.018]"
            style={{
              left: getLayerX(index),
              top: 0,
              width: LAYER_WIDTH,
              height: LAYER_CANVAS_HEIGHT,
            }}
          >
            <div
              className="flex items-center border-b border-white/[0.08] bg-white/[0.035] px-5"
              style={{ height: LAYER_HEADER_HEIGHT }}
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  {layer.name}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-700">
                  Layer {index + 1}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </ViewportPortal>
  );
}
