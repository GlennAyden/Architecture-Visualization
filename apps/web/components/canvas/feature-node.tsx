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
  highlighted?: boolean;
  dimmed?: boolean;
  semanticKind?: string;
  productArea?: string;
  mappingStatus?: string;
  mappingConfidence?: number;
  fileCount?: number;
  verifiedCount?: number;
  edgeCount?: number;
}

export type FeatureNodeType = Node<FeatureNodeData, 'feature-node'>;

function formatLabel(value: string | undefined) {
  return (value ?? 'unknown').replace(/_/g, ' ');
}

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
        padding: '7px 10px',
        borderRadius: '6px',
        border: data.highlighted ? '1.5px solid #facc15' : '1px solid oklch(0.72 0.16 220 / 0.35)',
        background: data.highlighted
          ? 'linear-gradient(180deg, rgba(250, 204, 21, 0.16), rgba(39, 39, 42, 0.92))'
          : 'rgba(24, 24, 27, 0.92)',
        boxShadow: data.highlighted
          ? '0 0 0 1px rgba(250,204,21,0.18), 0 0 24px rgba(250,204,21,0.18)'
          : '0 10px 24px rgba(0,0,0,0.24)',
        fontFamily: 'var(--font-geist-sans, system-ui)',
        color: '#f4f4f5',
        opacity: data.dimmed ? 0.35 : 1,
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
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '6px',
          minWidth: 0,
          color: data.highlighted ? '#fde68a' : 'oklch(0.72 0.16 220)',
          fontSize: '9.5px',
          lineHeight: 1.1,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {formatLabel(data.semanticKind)}
        </span>
        <span style={{ color: '#a1a1aa' }}>
          {data.productArea && data.productArea !== 'unknown'
            ? formatLabel(data.productArea)
            : `${data.fileCount ?? 0}f/${data.edgeCount ?? 0}r`}
        </span>
      </span>
      {showSubtitle && (
        <span
          style={{
            fontSize: '10px',
            color: data.highlighted ? '#fde68a' : 'oklch(0.72 0.16 220)',
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
