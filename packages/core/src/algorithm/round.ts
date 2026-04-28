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

  node.layout.left = roundedX - parentRoundedX;
  node.layout.top = roundedY - parentRoundedY;
  node.layout.width = Math.max(0, roundedR - roundedX);
  node.layout.height = Math.max(0, roundedB - roundedY);

  for (let i = 0; i < node.getChildCount(); i++) {
    applyRounding(node.getChild(i)!, abs, roundedX, roundedY);
  }
}
