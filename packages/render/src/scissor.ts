/**
 * A clipping rectangle in `Frame` coordinates. Used by `Frame`'s scissor
 * stack (see `Frame.pushScissor`) to filter cell writes — writes outside
 * the current scissor are dropped.
 *
 * `width` / `height` of 0 means "fully clipped" — no writes pass through.
 */
export interface ClipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Geometric intersection of two `ClipRect`s. Returns a rect with width or
 * height of 0 when the inputs do not overlap. Used by `Frame.pushScissor`
 * to nest scissors: child scissor is intersected with parent so cells
 * outside the outer scope cannot be reached even if the inner scope says
 * otherwise.
 */
export function intersect(a: ClipRect, b: ClipRect): ClipRect {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * True when `(x, y)` falls inside the rect (half-open: x in [left, left+width)).
 * `width === 0` or `height === 0` always returns false.
 */
export function contains(rect: ClipRect, x: number, y: number): boolean {
  return (
    x >= rect.left && x < rect.left + rect.width && y >= rect.top && y < rect.top + rect.height
  );
}
