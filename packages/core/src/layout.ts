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
  /**
   * Natural content width. For nodes with `overflow !== 'visible'`, this
   * is the bounding box of children unbounded by the parent's content
   * width. For non-overflow nodes, equals the node's own `width`.
   */
  scrollWidth: number;
  /** See {@link scrollWidth}. */
  scrollHeight: number;
}

export function defaultLayout(): ComputedLayout {
  return { left: 0, top: 0, width: 0, height: 0, scrollWidth: 0, scrollHeight: 0 };
}
