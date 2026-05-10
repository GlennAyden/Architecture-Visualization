import { HTMLContainer, Rectangle2d, ShapeUtil, T, type RecordProps } from 'tldraw';
import { PAGE_NODE_DEFAULT_HEIGHT, PAGE_NODE_DEFAULT_WIDTH } from '@arch-viz/shared';

// Register the custom shape type with tldraw via module augmentation so that
// `TLShape` includes 'page-node' and `ShapeUtil<PageNodeShape>` typechecks.
declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    'page-node': {
      name: string;
      w: number;
      h: number;
    };
  }
}

export type PageNodeShape = {
  type: 'page-node';
  props: {
    name: string;
    w: number;
    h: number;
  };
} & {
  // Inherit the standard tldraw base-shape fields (id, x, y, etc.) at runtime
  // via TLBaseShape; here we just describe the parts we touch.
  id: string;
  x: number;
  y: number;
};

// We rely on the augmented TLGlobalShapePropsMap so the typed Shape parameter
// matches what tldraw constructs internally. Use the TLShape variant tldraw
// derives via `Extract<TLShape, { type: 'page-node' }>` — easier in practice
// to type the methods loosely and let tldraw's `getDefaultProps` / `props`
// carry the contract.
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

  override component(shape: Shape) {
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
        }}
      >
        {shape.props.name}
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: Shape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}
