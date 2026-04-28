/**
 * Axis helpers — translate between flex semantics ("main", "cross", "start",
 * "end") and concrete tuple/property accessors. Keeping this in one place lets
 * the layout pass be written once and work for both row and column directions
 * without endless if-else.
 *
 * Padding and margin tuples are stored as [top, right, bottom, left] in
 * `Style`. Position tuples use the same convention.
 *
 * Gap is split into row-gap and column-gap (per CSS spec):
 *   - In `flex-direction: row`, items are laid out horizontally; the gap
 *     between them along the main axis is `column-gap`.
 *   - In `flex-direction: column`, items are stacked vertically; the gap
 *     between them along the main axis is `row-gap`.
 */

import type { FlexDirection, Style } from '../style.js';

export type Axis = 'row' | 'column';

const TOP = 0;
const RIGHT = 1;
const BOTTOM = 2;
const LEFT = 3;

export function mainAxis(d: FlexDirection): Axis {
  return d === 'row' || d === 'row-reverse' ? 'row' : 'column';
}

export function crossAxis(d: FlexDirection): Axis {
  return mainAxis(d) === 'row' ? 'column' : 'row';
}

export function isReverse(d: FlexDirection): boolean {
  return d === 'row-reverse' || d === 'column-reverse';
}

/** Edge index for the start side of a given axis. */
export function startEdge(axis: Axis): number {
  return axis === 'row' ? LEFT : TOP;
}

/** Edge index for the end side of a given axis. */
export function endEdge(axis: Axis): number {
  return axis === 'row' ? RIGHT : BOTTOM;
}

/** Read the start side of a [top, right, bottom, left] tuple. */
export function readStart(box: readonly number[], axis: Axis): number {
  return box[startEdge(axis)] ?? 0;
}

/** Read the end side of a [top, right, bottom, left] tuple. */
export function readEnd(box: readonly number[], axis: Axis): number {
  return box[endEdge(axis)] ?? 0;
}

/**
 * The CSS gap that separates flex items along the given axis.
 *   - main axis is row → use column-gap
 *   - main axis is column → use row-gap
 */
export function gapAlong(style: Style, axis: Axis): number {
  return axis === 'row' ? style.gapColumn : style.gapRow;
}

/** The style's preferred size along an axis (`width` for row, `height` for column). */
export function preferredSize(style: Style, axis: Axis): number | 'auto' {
  return axis === 'row' ? style.width : style.height;
}

export function minSize(style: Style, axis: Axis): number {
  return axis === 'row' ? style.minWidth : style.minHeight;
}

export function maxSize(style: Style, axis: Axis): number | undefined {
  return axis === 'row' ? style.maxWidth : style.maxHeight;
}

/** Clamp a candidate size to the [minSize, maxSize] range for the given axis. */
export function clampSize(style: Style, axis: Axis, value: number): number {
  const min = minSize(style, axis);
  const max = maxSize(style, axis);
  let v = value < min ? min : value;
  if (max !== undefined && v > max) v = max;
  return v;
}
