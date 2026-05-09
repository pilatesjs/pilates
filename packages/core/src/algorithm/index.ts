/**
 * Top-level entry: turn a tree of styled nodes into a tree of computed
 * layouts. The flow is:
 *
 *   1. Resolve the root's own size from its style + caller availability.
 *   2. Recursively lay out children in floating-point coordinates.
 *   3. Round the whole tree to integer cells.
 *   4. Mark every node clean.
 *
 * When `PILATES_DIFFERENTIAL_LAYOUT=1` is set in the environment, the
 * exported `calculateLayout` runs the algorithm twice — once normally
 * (with caches active), then again with all caches cleared and every
 * node forcibly re-dirtied — and asserts the two snapshots are byte
 * identical. Used by the test suite (`pnpm test:differential`) to
 * catch any cache-correctness regression as soon as it lands.
 */

import type { Node } from '../node.js';
import {
  LayoutCache,
  clearAllCaches,
  diffLayouts,
  markDirtyDeep,
  restoreFromCache,
  snapshotForCache,
  snapshotTreeLayouts,
} from './cache.js';
import { layoutChildren, resolveRootAxisSize } from './main-axis.js';
import { roundLayout } from './round.js';

const DIFFERENTIAL = process.env.PILATES_DIFFERENTIAL_LAYOUT === '1';

export function calculateLayout(
  root: Node,
  availableWidth: number | undefined,
  availableHeight: number | undefined,
): void {
  if (!DIFFERENTIAL) {
    calculateLayoutImpl(root, availableWidth, availableHeight);
    return;
  }

  // First pass: cached path (normal).
  calculateLayoutImpl(root, availableWidth, availableHeight);
  const cachedSnapshot = snapshotTreeLayouts(root);

  // Second pass: clear caches, re-dirty, recompute cold.
  clearAllCaches(root);
  markDirtyDeep(root);
  calculateLayoutImpl(root, availableWidth, availableHeight);
  const coldSnapshot = snapshotTreeLayouts(root);

  const diff = diffLayouts(cachedSnapshot, coldSnapshot);
  if (diff !== '') {
    throw new Error(
      `[pilates differential layout] cache produced different result than fresh recompute:\n  ${diff}`,
    );
  }
}

function calculateLayoutImpl(
  root: Node,
  availableWidth: number | undefined,
  availableHeight: number | undefined,
): void {
  const widthMode = availableWidth === undefined ? ('undefined' as const) : ('exactly' as const);
  const heightMode = availableHeight === undefined ? ('undefined' as const) : ('exactly' as const);
  const aw = availableWidth ?? Number.POSITIVE_INFINITY;
  const ah = availableHeight ?? Number.POSITIVE_INFINITY;
  const key = {
    availableWidth: aw,
    widthMode,
    availableHeight: ah,
    heightMode,
  };

  // Cache hit at root: clean tree + matching inputs.
  if (!root.isDirty() && root._layoutCache !== undefined) {
    const hit = root._layoutCache.lookup(key);
    if (hit !== undefined) {
      root._layout.left = 0;
      root._layout.top = 0;
      restoreFromCache(root, hit);
      // Children may have their own caches; recurse to either hit those
      // or fall back to recompute on miss. Pass useCache=true so inner nodes
      // can also use their caches. This is safe because the root cache-hit
      // path skips roundLayout — cached values were already rounded at their
      // original absolute positions, which are unchanged when the root hits.
      //
      // Phase 3 optimisation: a child can be skipped entirely when BOTH
      //   (a) the child itself is not dirty, AND
      //   (b) no descendant of the child is dirty.
      // Condition (b) is tracked by `_hasDirtyDescendant`. A boundary that
      // stops dirty propagation still sets `_hasDirtyDescendant = true` on
      // its ancestors (without marking them dirty), so a clean direct child
      // of root with `_hasDirtyDescendant = true` is the signal that a
      // boundary somewhere below needs to be re-laid out.
      // When both flags are false, the subtree is fully clean: layout values
      // are unchanged from the last pass and no recursion is needed.
      for (let i = 0; i < root.getChildCount(); i++) {
        const c = root.getChild(i)!;
        if (c.style.display === 'none') continue;
        if (!c.isDirty() && !c._hasDirtyDescendant) continue;
        // c._layout.{width,height} were populated by restoreFromCache(root, ...)
        // above. layoutChildren will use them as the EXACTLY-sized container
        // and either hit c's own cache or recompute.
        layoutChildren(c, true);
      }
      markClean(root);
      return;
    }
  }

  // Cold path
  root._layout.left = 0;
  root._layout.top = 0;
  root._layout.width = resolveRootAxisSize(root, 'row', availableWidth);
  root._layout.height = resolveRootAxisSize(root, 'column', availableHeight);

  layoutChildren(root);
  roundLayout(root);
  computeScrollSizes(root);
  markClean(root);

  // Store the root's result (computeScrollSizes already cached inner nodes).
  if (root._layoutCache === undefined) root._layoutCache = new LayoutCache();
  root._layoutCache.store(key, snapshotForCache(root));
}

function markClean(node: Node): void {
  node.clearDirty();
  for (let i = 0; i < node.getChildCount(); i++) markClean(node.getChild(i)!);
}

/**
 * Walk the tree post-rounding and record each node's content bounding box on
 * `_layout.scrollWidth` / `_layout.scrollHeight`. We compute this for every
 * node — not just `overflow !== 'visible'` ones — so consumers see a stable
 * shape: for non-overflow parents the values collapse to the node's own
 * width/height (children never exceed the box at layout time anyway), while
 * for overflow parents the values reflect the natural child extent that
 * would otherwise be invisible behind the scroll viewport.
 *
 * Runs after `roundLayout` so the recorded extent is in integer cells and
 * matches what the renderer paints.
 */
function computeScrollSizes(node: Node): void {
  for (let i = 0; i < node.getChildCount(); i++) computeScrollSizes(node.getChild(i)!);

  let contentRight = 0;
  let contentBottom = 0;
  for (let i = 0; i < node.getChildCount(); i++) {
    const c = node.getChild(i)!;
    const cl = c._layout;
    contentRight = Math.max(contentRight, cl.left + cl.width);
    contentBottom = Math.max(contentBottom, cl.top + cl.height);
  }
  node._layout.scrollWidth = Math.max(node._layout.width, contentRight);
  node._layout.scrollHeight = Math.max(node._layout.height, contentBottom);

  // Cache the node's layout for next pass. Skip root (cached separately
  // by calculateLayoutImpl with the original root key).
  if (node.getParent() !== null) {
    const innerKey = {
      availableWidth: node.layout.width,
      widthMode: 'exactly' as const,
      availableHeight: node.layout.height,
      heightMode: 'exactly' as const,
    };
    if (node._layoutCache === undefined) node._layoutCache = new LayoutCache();
    node._layoutCache.store(innerKey, snapshotForCache(node));
  }
}
