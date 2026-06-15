'use client';

import type React from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { PAGE_NODE_DEFAULT_HEIGHT, PAGE_NODE_DEFAULT_WIDTH } from '@arch-viz/shared';

import { useModalStore } from '@/store/modal-store';
import { useDrillStore } from '@/store/drill-store';
import { useCanvasViewStore } from '@/store/canvas-view-store';
import type { Id } from '../../../../convex/_generated/dataModel';

// React Flow's `Node<Data>` constrains `Data extends Record<string, unknown>`.
// Extending the interface (rather than `& Record<>`) lets us list the keys we
// actually care about while still satisfying the index-signature constraint.
export interface PageNodeData extends Record<string, unknown> {
  projectId?: Id<'projects'>;
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
  semanticKind?: string;
  productArea?: string;
  mappingStatus?: string;
  mappingConfidence?: number;
  fileCount?: number;
  verifiedCount?: number;
  edgeCount?: number;
  collapsed?: boolean;
  childCount?: number;
  hiddenNodeCount?: number;
  hiddenFileCount?: number;
  hiddenEdgeCount?: number;
  relatedFlowCount?: number;
  memberNodeIds?: string[];
}

export type PageNodeType = Node<PageNodeData, 'page-node'>;

function formatLabel(value: string | undefined) {
  return (value ?? 'unknown').replace(/_/g, ' ');
}

function StatusBadge({
  status,
  confidence,
}: {
  status: string | undefined;
  confidence: number | undefined;
}) {
  const tone =
    status === 'verified'
      ? { bg: 'rgba(52, 211, 153, 0.14)', color: '#a7f3d0' }
      : status === 'auto_mapped'
        ? { bg: 'rgba(34, 211, 238, 0.14)', color: '#a5f3fc' }
        : status === 'suggested'
          ? { bg: 'rgba(250, 204, 21, 0.14)', color: '#fde68a' }
          : { bg: 'rgba(255,255,255,0.07)', color: '#a1a1aa' };
  const suffix = confidence !== undefined ? ` ${Math.round(confidence * 100)}%` : '';
  return (
    <span
      style={{
        maxWidth: '96px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        borderRadius: '999px',
        background: tone.bg,
        color: tone.color,
        padding: '2px 6px',
        fontSize: '10px',
        fontWeight: 600,
        lineHeight: 1.2,
      }}
    >
      {formatLabel(status)}
      {suffix}
    </span>
  );
}

function NodeStats({ files, edges }: { files: number | undefined; edges: number | undefined }) {
  return (
    <span style={{ color: '#a1a1aa', fontSize: '10px', lineHeight: 1.2 }}>
      {files ?? 0} files / {edges ?? 0} rel
    </span>
  );
}

function ProductAreaBadge({ value }: { value: string | undefined }) {
  if (!value || value === 'unknown') return null;
  return (
    <span
      style={{
        borderRadius: '999px',
        background: 'rgba(255,255,255,0.07)',
        color: '#d4d4d8',
        padding: '2px 6px',
        fontSize: '10px',
        fontWeight: 600,
        lineHeight: 1.2,
      }}
    >
      {formatLabel(value)}
    </span>
  );
}

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

  const toggleCollapsed = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!data.projectId) return;
    const nodeId = id as Id<'nodes'>;
    const store = useCanvasViewStore.getState();
    if (data.collapsed) store.expandNode(data.projectId, nodeId);
    else store.collapseNode(data.projectId, nodeId);
  };

  if (data.collapsed) {
    return (
      <div
        onDoubleClick={onDoubleClick}
        style={{
          width: PAGE_NODE_DEFAULT_WIDTH,
          minHeight: PAGE_NODE_DEFAULT_HEIGHT + 28,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '8px',
          padding: '12px',
          borderRadius: '10px',
          border: data.highlighted ? '1.5px solid #facc15' : '1.5px solid rgba(34,211,238,0.28)',
          background: data.highlighted
            ? 'linear-gradient(180deg, rgba(250,204,21,0.18), rgba(24,24,27,0.94))'
            : 'linear-gradient(180deg, rgba(34,211,238,0.08), rgba(24,24,27,0.94))',
          boxShadow: data.highlighted
            ? '0 0 0 1px rgba(250,204,21,0.18), 0 0 24px rgba(250,204,21,0.18)'
            : '0 14px 28px rgba(0,0,0,0.24)',
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
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <span
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 13,
              fontWeight: 650,
            }}
          >
            {data.name}
          </span>
          <StatusBadge status={data.mappingStatus} confidence={data.mappingConfidence} />
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
            color: '#a1a1aa',
            fontSize: 10,
          }}
        >
          <span>{data.hiddenNodeCount ?? 0} hidden nodes</span>
          <span>{data.hiddenFileCount ?? 0} files</span>
          <span>{data.edgeCount ?? 0} rel</span>
          <span>{data.relatedFlowCount ?? 0} flows</span>
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          style={{
            height: 24,
            borderRadius: 6,
            border: '1px solid rgba(34,211,238,0.35)',
            background: 'rgba(34,211,238,0.12)',
            color: '#a5f3fc',
            fontSize: 11,
            fontWeight: 650,
            cursor: 'pointer',
          }}
        >
          Expand cluster
        </button>
      </div>
    );
  }

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
            justifyContent: 'space-between',
            gap: '8px',
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
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {data.name}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ProductAreaBadge value={data.productArea} />
            <StatusBadge status={data.mappingStatus} confidence={data.mappingConfidence} />
            {!data.readOnly && (
              <button
                type="button"
                onClick={toggleCollapsed}
                style={{
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '6px',
                  background: 'rgba(0,0,0,0.18)',
                  color: '#d4d4d8',
                  padding: '2px 6px',
                  fontSize: 10,
                  fontWeight: 650,
                  cursor: 'pointer',
                }}
              >
                Collapse
              </button>
            )}
          </span>
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
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'center',
        gap: '8px',
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
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'center',
        }}
      >
        {data.name}
      </span>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          minWidth: 0,
        }}
      >
        <span
          style={{
            maxWidth: '86px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            borderRadius: '999px',
            background: 'rgba(34, 211, 238, 0.12)',
            color: '#a5f3fc',
            padding: '2px 6px',
            fontSize: '10px',
            fontWeight: 600,
            lineHeight: 1.2,
          }}
        >
          {formatLabel(data.semanticKind)}
        </span>
        <ProductAreaBadge value={data.productArea} />
        <StatusBadge status={data.mappingStatus} confidence={data.mappingConfidence} />
      </span>
      <NodeStats files={data.fileCount} edges={data.edgeCount} />
    </div>
  );
}
