export const VERSION = '1.0.0-rc.2';

// Public render entry points.
export { render, renderToFrame } from './render.js';

// Frame and its building blocks. Exposed so downstream packages
// (e.g. @pilates/diff) can read cells and emit their own escape
// sequences.
export { Frame } from './frame.js';
export type { Cell, CellStyle, Rect } from './frame.js';

// SGR / ANSI escape primitives. Expose the same helpers Frame uses so
// consumers can build alternative renderers that match output byte-for-byte.
export { Attr, SGR_RESET, attrsSgr, bgSgr, fgSgr, packAttrs, sgr } from './ansi.js';

// Public type surface.
export type {
  Align,
  BorderProps,
  BorderStyle,
  Color,
  ContainerNode,
  Display,
  EdgeValue,
  FlexDirection,
  FlexWrap,
  Justify,
  LayoutProps,
  NamedColor,
  PositionType,
  RenderNode,
  RenderOptions,
  TextNode,
  TextStyle,
  Wrap,
} from './types.js';
