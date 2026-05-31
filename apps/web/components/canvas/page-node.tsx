'use client';

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { PAGE_NODE_DEFAULT_HEIGHT, PAGE_NODE_DEFAULT_WIDTH } from '@arch-viz/shared';

import { useModalStore } from '@/store/modal-store';
import { useDrillStore } from '@/store/drill-store';
import type { Id } from '../../../../convex/_generated/dataModel';

// React Flow's `Node<Data>` constrains `Data extends Record<string, unknown>`.
// Extending the interface (rather than `& Record<>`) lets us list the keys we
// actually care about while still satisfying the index-signature constraint.
export interface PageNodeData extends Record<string, unknown> {
  name: string;
  readOnly?: boolean;
  // Container mode (true → render as labelled box that wraps children;
  // false / undefined → render as a leaf card). Computed at sync time
  // from the visible children set.
  hasChildren?: boolean;
  // Explicit container dimensions when hasChildren=true. The renderer
  // matches React Flow's node.width/height so children laid out by
  // `computeAutoLayout` line up inside the container.
  containerWidth?: number;
  containerHeight?: number;
  highlighted?: boolean;
  dimmed?: boolean;
}

export type PageNodeType = Node<PageNodeData, 'page-node'>;

export function PageNode({ id, data }: NodeProps<PageNodeType>) {
  // Edge endpoints attach to invisible handles on every side; React Flow
  // picks the closest one automatically. Hidden source/target on all four
  // sides lets arrows route naturally without user-visible connector dots.
  const handleStyle = { opacity: 0, pointerEvents: 'none' as const };

  const onDoubleClick = () => {
    if (data.readOnly) return;
    const nodeId = id as Id<'nodes'>;
    const drill = useDrillStore.getState();
    if (drill.hasChildren(nodeId)) {
      drill.drillIn(nodeId);
      return;
    }
    useModalStore.getState().open(nodeId);
  };

  if (data.hasChildren) {
    // Container mode: a labelled box that wraps its child feature nodes.
    // Border stays solid so the cluster boundary reads at a glance; body
    // is transparent so children render with their own card styles inside.
    return (
      <div
        style={{
          width: data.containerWidth,
          height: data.containerHeight,
          borderRadius: '10px',
          border: data.highlighted ? '1.5px solid #facc15' : '1.5px solid rgba(255,255,255,0.12)',
          background: data.highlighted ? 'rgba(250, 204, 21, 0.06)' : 'rgba(24,24,27,0.24)',
          boxShadow: data.highlighted
            ? '0 0 0 1px rgba(250,204,21,0.18), 0 0 26px rgba(250,204,21,0.12)'
            : '0 14px 28px rgba(0,0,0,0.18)',
          fontFamily: 'var(--font-geist-sans, system-ui)',
          color: '#f4f4f5',
          opacity: data.dimmed ? 0.35 : 1,
          userSelect: 'none',
        }}
      >
        <Handle type="target" position={Position.Top} style={handleStyle} id="t" />
        <Handle type="source" position={Position.Bottom} style={handleStyle} id="b" />
        <Handle type="target" position={Position.Left} style={handleStyle} id="l" />
        <Handle type="source" position={Position.Right} style={handleStyle} id="r" />
        <div
          onDoubleClick={onDoubleClick}
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '40px',
            padding: '0 14px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            fontSize: '13px',
            fontWeight: 600,
            color: data.highlighted ? '#fef3c7' : '#f4f4f5',
            cursor: data.readOnly ? 'default' : 'pointer',
            background: data.highlighted ? 'rgba(250, 204, 21, 0.12)' : 'rgba(39,39,42,0.95)',
            borderTopLeftRadius: '10px',
            borderTopRightRadius: '10px',
          }}
        >
          {data.name}
        </div>
      </div>
    );
  }

  // Leaf mode: original card style — used when the page has no children
  // visible in the current scope.
  return (
    <div
      onDoubleClick={onDoubleClick}
      style={{
        width: PAGE_NODE_DEFAULT_WIDTH,
        height: PAGE_NODE_DEFAULT_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
        borderRadius: '8px',
        border: data.highlighted ? '1.5px solid #facc15' : '1px solid rgba(255,255,255,0.12)',
        background: data.highlighted
          ? 'linear-gradient(180deg, rgba(250, 204, 21, 0.16), rgba(39, 39, 42, 0.94))'
          : 'rgba(24, 24, 27, 0.94)',
        boxShadow: data.highlighted
          ? '0 0 0 1px rgba(250,204,21,0.18), 0 0 24px rgba(250,204,21,0.18)'
          : '0 10px 24px rgba(0,0,0,0.24)',
        fontFamily: 'var(--font-geist-sans, system-ui)',
        fontSize: '14px',
        fontWeight: 500,
        color: data.highlighted ? '#fef3c7' : '#f4f4f5',
        opacity: data.dimmed ? 0.35 : 1,
        userSelect: 'none',
        cursor: data.readOnly ? 'default' : 'pointer',
      }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} id="t" />
      <Handle type="source" position={Position.Bottom} style={handleStyle} id="b" />
      <Handle type="target" position={Position.Left} style={handleStyle} id="l" />
      <Handle type="source" position={Position.Right} style={handleStyle} id="r" />
      <span>{data.name}</span>
    </div>
  );
}
