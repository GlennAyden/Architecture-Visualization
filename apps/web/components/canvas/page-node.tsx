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
        border: '1px solid hsl(214 32% 91%)',
        background: 'white',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        fontFamily: 'var(--font-geist-sans, system-ui)',
        fontSize: '14px',
        fontWeight: 500,
        color: '#0f172a',
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
