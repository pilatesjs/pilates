/**
 * Integer-cell rounding pass.
 *
 * The flex algorithm computes layouts in floating-point space (a child with
 * `flex: 1` in a row of three may end up at width 33.333…). Terminals can't
 * render half a cell, so we round once at the end with two invariants:
 *
 *   1. Sibling boxes should butt cleanly. If A is at left 0 with width 33.33
 *      and B is at left 33.33 with width 33.33, naive rounding gives A.width
 *      33 and B.left 33, but B's right edge ends up at 66 instead of 67.
 *      We instead round each box's *absolute* edges, then derive its width
 *      and height from the difference.
 *   2. Children's relative positions are recomputed against the parent's
 *      newly-rounded absolute corner, so nested layouts stay consistent.
 *
 * This mirrors Yoga's "round to pixel grid" pass.
 */

import type { Node } from '../node.js';

interface AbsCorner {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function roundLayout(root: Node): void {
  const absolutes = new Map<Node, AbsCorner>();
  collectAbsolutes(root, 0, 0, absolutes);
  applyRounding(root, absolutes, 0, 0);
}

/**
 * Round the layout of a subtree that sits at a known absolute position.
 *
 * Used by the Phase 3 relayout-boundary path: when a boundary node is
 * re-laid out under a cache-hit root, its children's positions are in
 * floating-point space. We round them in isolation using the boundary
 * node's already-rounded absolute position as the origin.
 *
 * The boundary node's own `width`/`height` are explicit integers (that is
 * the boundary invariant) and its `left`/`top` were restored from the
 * parent's rounded cache, so they are already integers. We therefore do
 * NOT re-round the boundary node itself — only its children. The parent
 * absolute corner is `(parentAbsX + node.left, parentAbsY + node.top)`.
 *
 * @internal
 */
export function roundLayoutSubtree(node: Node, parentAbsX: number, parentAbsY: number): void {
  const nodeAbsX = parentAbsX + node._layout.left;
  const nodeAbsY = parentAbsY + node._layout.top;
  const absolutes = new Map<Node, AbsCorner>();
  // Collect children relative to the node's absolute corner.
  for (let i = 0; i < node.getChildCount(); i++) {
    collectAbsolutes(node.getChild(i)!, nodeAbsX, nodeAbsY, absolutes);
  }
  // Round children (their positions are relative to `node`, so
  // parentRoundedX/Y for each child is node's absolute corner rounded).
  const roundedNodeX = Math.round(nodeAbsX);
  const roundedNodeY = Math.round(nodeAbsY);
  for (let i = 0; i < node.getChildCount(); i++) {
    applyRounding(node.getChild(i)!, absolutes, roundedNodeX, roundedNodeY);
  }
}

function collectAbsolutes(
  node: Node,
  parentX: number,
  parentY: number,
  out: Map<Node, AbsCorner>,
): void {
  const x = parentX + node.layout.left;
  const y = parentY + node.layout.top;
  out.set(node, { x, y, w: node.layout.width, h: node.layout.height });
  for (let i = 0; i < node.getChildCount(); i++) {
    collectAbsolutes(node.getChild(i)!, x, y, out);
  }
}

function applyRounding(
  node: Node,
  abs: Map<Node, AbsCorner>,
  parentRoundedX: number,
  parentRoundedY: number,
): void {
  const my = abs.get(node)!;
  const roundedX = Math.round(my.x);
  const roundedY = Math.round(my.y);
  const roundedR = Math.round(my.x + my.w);
  const roundedB = Math.round(my.y + my.h);

  node._layout.left = roundedX - parentRoundedX;
  node._layout.top = roundedY - parentRoundedY;
  node._layout.width = Math.max(0, roundedR - roundedX);
  node._layout.height = Math.max(0, roundedB - roundedY);

  for (let i = 0; i < node.getChildCount(); i++) {
    applyRounding(node.getChild(i)!, abs, roundedX, roundedY);
  }
}
