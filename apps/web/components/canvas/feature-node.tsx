'use client';

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { FEATURE_NODE_DEFAULT_HEIGHT, FEATURE_NODE_DEFAULT_WIDTH } from '@arch-viz/shared';

import { useModalStore } from '@/store/modal-store';
import { useDrillStore } from '@/store/drill-store';
import type { Id } from '../../../../convex/_generated/dataModel';

// React Flow's `Node<Data>` constrains `Data extends Record<string, unknown>`.
export interface FeatureNodeData extends Record<string, unknown> {
  name: string;
  parentName: string | null;
  // True when this feature renders INSIDE its parent's cluster container.
  // The container already labels the parent, so the "↳ parent" subtitle
  // would just duplicate that visual cue — we hide it in that case and
  // give the name the whole card. Standalone features (no visible parent
  // in scope) still show the subtitle.
  insideCluster?: boolean;
  readOnly?: boolean;
}

export type FeatureNodeType = Node<FeatureNodeData, 'feature-node'>;

export function FeatureNode({ id, data }: NodeProps<FeatureNodeType>) {
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

  const showSubtitle = !data.insideCluster && data.parentName;

  return (
    <div
      onDoubleClick={onDoubleClick}
      style={{
        width: FEATURE_NODE_DEFAULT_WIDTH,
        height: FEATURE_NODE_DEFAULT_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        // Center the name vertically when there's no subtitle (cluster
        // mode); otherwise top-align so the subtitle has room below.
        justifyContent: showSubtitle ? 'center' : 'center',
        gap: '2px',
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid oklch(0.62 0.16 220 / 0.4)',
        background: 'oklch(0.62 0.16 220 / 0.06)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        fontFamily: 'var(--font-geist-sans, system-ui)',
        color: '#0f172a',
        userSelect: 'none',
        cursor: data.readOnly ? 'default' : 'pointer',
      }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} id="t" />
      <Handle type="source" position={Position.Bottom} style={handleStyle} id="b" />
      <Handle type="target" position={Position.Left} style={handleStyle} id="l" />
      <Handle type="source" position={Position.Right} style={handleStyle} id="r" />
      <span
        style={{
          fontSize: '13px',
          fontWeight: 500,
          lineHeight: 1.25,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {data.name}
      </span>
      {showSubtitle && (
        <span
          style={{
            fontSize: '10px',
            color: 'oklch(0.62 0.16 220)',
            opacity: 0.85,
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
          }}
        >
          <span aria-hidden>↳</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.parentName}
          </span>
        </span>
      )}
    </div>
  );
}
