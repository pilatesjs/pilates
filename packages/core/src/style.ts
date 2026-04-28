/**
 * Style types and defaults for the layout engine.
 *
 * The shape mirrors a subset of CSS Flexbox plus a few terminal-specific
 * choices (no aspect-ratio, no RTL direction, no baseline alignment in v1).
 *
 * String-literal unions are preferred over numeric enums so that user code
 * reads naturally: `node.setFlexDirection('row')`. Internally we still
 * compare against these strings — the cost is negligible relative to the
 * layout work.
 */

export type FlexDirection = 'row' | 'column' | 'row-reverse' | 'column-reverse';

export type FlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse';

export type Justify =
  | 'flex-start'
  | 'flex-end'
  | 'center'
  | 'space-between'
  | 'space-around'
  | 'space-evenly';

export type Align =
  | 'auto'
  | 'flex-start'
  | 'flex-end'
  | 'center'
  | 'stretch'
  | 'space-between'
  | 'space-around';

export type PositionType = 'relative' | 'absolute';

export type Display = 'flex' | 'none';

/** A length value in terminal cells, or 'auto' to size from content / flex. */
export type Length = number | 'auto';

/**
 * Internal style state. Each `Node` owns one of these and mutates it via
 * setters. Defaults match Yoga + CSS Flexbox where applicable.
 */
export interface Style {
  flexDirection: FlexDirection;
  flexWrap: FlexWrap;
  flexGrow: number;
  flexShrink: number;
  flexBasis: Length;

  width: Length;
  height: Length;
  minWidth: number;
  minHeight: number;
  /** undefined means "no upper bound". */
  maxWidth: number | undefined;
  maxHeight: number | undefined;

  /** [top, right, bottom, left]. */
  padding: [number, number, number, number];
  /** [top, right, bottom, left]. */
  margin: [number, number, number, number];
  gapRow: number;
  gapColumn: number;

  justifyContent: Justify;
  alignItems: Align;
  alignContent: Align;
  alignSelf: Align;

  positionType: PositionType;
  /** [top, right, bottom, left]; undefined means "edge unconstrained". */
  position: [number | undefined, number | undefined, number | undefined, number | undefined];

  display: Display;
}

export function defaultStyle(): Style {
  return {
    flexDirection: 'column',
    flexWrap: 'nowrap',
    flexGrow: 0,
    // Yoga / React Native default rather than CSS spec's 1 — avoids surprise
    // shrinking when a designer just declares a width.
    flexShrink: 0,
    flexBasis: 'auto',

    width: 'auto',
    height: 'auto',
    minWidth: 0,
    minHeight: 0,
    maxWidth: undefined,
    maxHeight: undefined,

    padding: [0, 0, 0, 0],
    margin: [0, 0, 0, 0],
    gapRow: 0,
    gapColumn: 0,

    justifyContent: 'flex-start',
    alignItems: 'stretch',
    alignContent: 'flex-start',
    alignSelf: 'auto',

    positionType: 'relative',
    position: [undefined, undefined, undefined, undefined],

    display: 'flex',
  };
}
