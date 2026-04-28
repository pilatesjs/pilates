/**
 * Top-level entry: turn a tree of styled nodes into a tree of computed
 * layouts. The flow is:
 *
 *   1. Resolve the root's own size from its style + caller availability.
 *   2. Recursively lay out children in floating-point coordinates.
 *   3. Round the whole tree to integer cells.
 *   4. Mark every node clean.
 */

import type { Node } from '../node.js';
import { layoutChildren, resolveRootAxisSize } from './main-axis.js';
import { roundLayout } from './round.js';

export function calculateLayout(
  root: Node,
  availableWidth: number | undefined,
  availableHeight: number | undefined,
): void {
  root.layout.left = 0;
  root.layout.top = 0;
  root.layout.width = resolveRootAxisSize(root, 'row', availableWidth);
  root.layout.height = resolveRootAxisSize(root, 'column', availableHeight);

  layoutChildren(root);
  roundLayout(root);
  markClean(root);
}

function markClean(node: Node): void {
  node.clearDirty();
  for (let i = 0; i < node.getChildCount(); i++) markClean(node.getChild(i)!);
}
