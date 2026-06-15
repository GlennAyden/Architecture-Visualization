'use client';

import { ViewportPortal } from '@xyflow/react';

import {
  LAYER_CANVAS_HEIGHT,
  LAYER_CANVAS_TOP,
  LAYER_HEADER_HEIGHT,
  computeLayerGeometry,
  getLayerCanvasWidth,
} from '@/lib/architecture-layers';
import { cn } from '@/lib/utils';

interface Props {
  layers:
    | Array<{
        _id: string;
        name: string;
        position: number;
      }>
    | undefined;
  nodes:
    | Array<{
        _id: string;
        type: 'page' | 'feature';
        parentId?: string | null;
        layerId?: string | null;
        positionX: number;
        positionY: number;
        semanticKind?: string | null;
      }>
    | undefined;
}

export function LayerLanes({ layers, nodes }: Props) {
  const layoutNodes = nodes?.map((node) => ({
    ...node,
    parentId: node.parentId ?? undefined,
    layerId: node.layerId ?? undefined,
    semanticKind: node.semanticKind ?? undefined,
  }));
  const geometry = computeLayerGeometry(layers, layoutNodes);
  if (geometry.length === 0) return null;

  return (
    <ViewportPortal>
      <div
        className="pointer-events-none absolute"
        style={{
          left: 0,
          top: LAYER_CANVAS_TOP,
          width: getLayerCanvasWidth(geometry),
          height: LAYER_CANVAS_HEIGHT,
        }}
      >
        {geometry.map(({ layer, index, left, width, nodeCount, isCompact }) => (
          <div
            key={layer._id}
            className={cn(
              'absolute rounded-lg border bg-white/[0.018]',
              isCompact
                ? 'border-dashed border-white/[0.06] bg-white/[0.012]'
                : 'border-white/[0.07]',
            )}
            style={{
              left,
              top: 0,
              width,
              height: LAYER_CANVAS_HEIGHT,
            }}
          >
            <div
              className={cn(
                'flex items-center border-b border-white/[0.08] bg-white/[0.035]',
                isCompact ? 'px-3' : 'px-5',
              )}
              style={{ height: LAYER_HEADER_HEIGHT }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  {layer.name}
                </p>
                <p className="mt-1 truncate text-[10px] uppercase tracking-[0.14em] text-zinc-700">
                  Layer {index + 1}
                </p>
              </div>
              {isCompact && (
                <span className="ml-2 shrink-0 rounded border border-white/[0.08] bg-black/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-zinc-600">
                  {nodeCount} nodes
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </ViewportPortal>
  );
}
