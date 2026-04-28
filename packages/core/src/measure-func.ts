/**
 * Custom-measurement callback for leaf nodes whose intrinsic size depends on
 * their content (e.g. a text run whose width depends on wrapping).
 *
 * The layout algorithm calls this with the available space along each axis
 * and a mode describing how to interpret that constraint:
 *   - 'undefined' — no constraint, return your natural size.
 *   - 'exactly'   — the constraint is exact, return that size.
 *   - 'at-most'   — fit within the constraint but you may report less.
 *
 * The returned size is in terminal cells.
 */

export const MeasureMode = {
  Undefined: 'undefined',
  Exactly: 'exactly',
  AtMost: 'at-most',
} as const;

export type MeasureMode = (typeof MeasureMode)[keyof typeof MeasureMode];

export interface MeasureSize {
  width: number;
  height: number;
}

export type MeasureFunc = (
  width: number,
  widthMode: MeasureMode,
  height: number,
  heightMode: MeasureMode,
) => MeasureSize;
