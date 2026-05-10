import { HTMLContainer, Rectangle2d, ShapeUtil, T, type RecordProps } from 'tldraw';
import { PAGE_NODE_DEFAULT_HEIGHT, PAGE_NODE_DEFAULT_WIDTH } from '@arch-viz/shared';
import { useModalStore } from '@/store/modal-store';
import type { Id } from '../../../../convex/_generated/dataModel';

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    'page-node': {
      name: string;
      w: number;
      h: number;
    };
  }
}

import type { TLShape } from 'tldraw';

type Shape = Extract<TLShape, { type: 'page-node' }>;

export class PageNodeShapeUtil extends ShapeUtil<Shape> {
  static override type = 'page-node' as const;

  static override props: RecordProps<Shape> = {
    name: T.string,
    w: T.number,
    h: T.number,
  };

  override getDefaultProps(): Shape['props'] {
    return {
      name: 'New page',
      w: PAGE_NODE_DEFAULT_WIDTH,
      h: PAGE_NODE_DEFAULT_HEIGHT,
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
    // Tldraw intercepts double-click before any DOM handler we put on the
    // shape body. Hook into the shape-util lifecycle instead and dispatch
    // via the Zustand store's vanilla API (no React context required).
    const shapeId = shape.id;
    const prefix = 'shape:';
    if (!shapeId.startsWith(prefix)) return;
    const nodeId = shapeId.slice(prefix.length) as Id<'nodes'>;
    useModalStore.getState().open(nodeId);
  }

  override component(shape: Shape) {
    return <PageNodeShapeBody shape={shape} />;
  }

  override getIndicatorPath(shape: Shape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}

function PageNodeShapeBody({ shape }: { shape: Shape }) {
  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
        borderRadius: '8px',
        border: '1px solid hsl(var(--border, 214 32% 91%))',
        background: 'white',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        fontFamily: 'var(--font-geist-sans, system-ui)',
        fontSize: '14px',
        fontWeight: 500,
        color: '#0f172a',
        pointerEvents: 'all',
        userSelect: 'none',
        cursor: 'pointer',
      }}
    >
      {shape.props.name}
    </HTMLContainer>
  );
}
