export const VERSION = '1.0.1';

// Tree
export { Node } from './node.js';

// Style values
export { Edge } from './edge.js';
export type {
  Align,
  Display,
  FlexDirection,
  FlexWrap,
  Justify,
  Length,
  Overflow,
  PositionType,
  Style,
} from './style.js';

// Measure callback
export { MeasureMode } from './measure-func.js';
export type { MeasureFunc, MeasureSize } from './measure-func.js';

// Layout output
export type { ComputedLayout } from './layout.js';

// Layout profiling — observe what the incremental engine did per
// `calculateLayout` call (phase 9).
export { setLayoutProfiler, type LayoutProfiler, type LayoutTrace } from './algorithm/index.js';

// Text measurement (re-exported from the measure module so consumers can
// build measure functions on top of our width tables).
export { cellWidth, graphemes, stringWidth, stripAnsi, type Grapheme } from './measure/index.js';
