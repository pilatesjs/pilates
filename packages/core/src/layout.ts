/**
 * Computed layout values stored on each Node. These are written by
 * `calculateLayout()` (M4 onwards) and read via `Node.getComputedLayout()`.
 *
 * All values are in integer terminal cells, relative to the parent node's
 * top-left corner.
 */
export interface ComputedLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function defaultLayout(): ComputedLayout {
  return { left: 0, top: 0, width: 0, height: 0 };
}
