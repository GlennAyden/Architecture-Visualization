import { HTMLContainer, Rectangle2d, ShapeUtil, T, type RecordProps } from 'tldraw';
import { FEATURE_NODE_DEFAULT_HEIGHT, FEATURE_NODE_DEFAULT_WIDTH } from '@arch-viz/shared';
import { useModalStore } from '@/store/modal-store';
import type { Id } from '../../../../convex/_generated/dataModel';

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    'feature-node': {
      name: string;
      parentName: string | null;
      w: number;
      h: number;
    };
  }
}

import type { TLShape } from 'tldraw';

type Shape = Extract<TLShape, { type: 'feature-node' }>;

export class FeatureNodeShapeUtil extends ShapeUtil<Shape> {
  static override type = 'feature-node' as const;

  static override props: RecordProps<Shape> = {
    name: T.string,
    parentName: T.nullable(T.string),
    w: T.number,
    h: T.number,
  };

  override getDefaultProps(): Shape['props'] {
    return {
      name: 'New feature',
      parentName: null,
      w: FEATURE_NODE_DEFAULT_WIDTH,
      h: FEATURE_NODE_DEFAULT_HEIGHT,
    };
  }

  override canEdit() {
    return false;
  }

  override canResize() {
    return false;
  }

  override getGeometry(shape: Shape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override onDoubleClick(shape: Shape) {
    const shapeId = shape.id;
    const prefix = 'shape:';
    if (!shapeId.startsWith(prefix)) return;
    const nodeId = shapeId.slice(prefix.length) as Id<'nodes'>;
    useModalStore.getState().open(nodeId);
  }

  override component(shape: Shape) {
    return <FeatureNodeShapeBody shape={shape} />;
  }

  override getIndicatorPath(shape: Shape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}

function FeatureNodeShapeBody({ shape }: { shape: Shape }) {
  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '2px',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid oklch(0.62 0.16 220 / 0.4)',
        background: 'oklch(0.62 0.16 220 / 0.06)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        fontFamily: 'var(--font-geist-sans, system-ui)',
        color: '#0f172a',
        pointerEvents: 'all',
        userSelect: 'none',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: '13px', fontWeight: 500, lineHeight: 1.2 }}>
        {shape.props.name}
      </span>
      {shape.props.parentName && (
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
            {shape.props.parentName}
          </span>
        </span>
      )}
    </HTMLContainer>
  );
}
