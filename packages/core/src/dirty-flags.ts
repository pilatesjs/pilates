/**
 * Per-property dirty bits. Each mutation on a `Node` marks specific
 * flags rather than a generic boolean. Cache layers and incremental
 * engines consume these to skip invalidation when their inputs
 * didn't actually change.
 *
 * The flag set is intentionally small (one word fits in V8's SMI
 * representation); broad enough to cover every public Node setter
 * but no broader.
 *
 * Used by `Node._dirtyFlags`, `Node.markDirtyFlag()`, and the cache
 * + incremental layers consuming these flags in subsequent phases.
 *
 * @internal
 */

/** Layout-shape mutations (flexDirection, wrap, justify, align, display, ...). */
export const DIRTY_STYLE_SIG = 1 << 0;

/** Explicit-dimension values (width, height, margin, padding, border, position). */
export const DIRTY_STYLE_VALUE = 1 << 1;

/** Flex-distribution parameters (flexGrow, flexShrink, flexBasis). */
export const DIRTY_FLEX_DISTRIBUTION = 1 << 2;

/** Measure function attached or detached. */
export const DIRTY_MEASURE = 1 << 3;

/** Manual measure-cache invalidation (consumer-driven). */
export const DIRTY_MEASURE_CONTENT = 1 << 4;

/** Children list mutation (insert / remove / reorder). */
export const DIRTY_CHILDREN = 1 << 5;

/** All flags ORed together. Used by back-compat `markDirty()`. */
export const DIRTY_ANY =
  DIRTY_STYLE_SIG |
  DIRTY_STYLE_VALUE |
  DIRTY_FLEX_DISTRIBUTION |
  DIRTY_MEASURE |
  DIRTY_MEASURE_CONTENT |
  DIRTY_CHILDREN;
