/**
 * The main-axis flex algorithm (Milestone 4).
 *
 * Implements the subset of CSS Flexbox / Yoga semantics needed for a working
 * single-line layout:
 *
 *   1. Resolve the container's inner main / cross size from style + the size
 *      its parent allocated.
 *   2. Compute each child's hypothetical main size (the flex basis), using
 *      `flexBasis` if set, falling back to the child's `width`/`height` style,
 *      then to its measure function, then to 0.
 *   3. Distribute leftover or missing main-axis space via `flexGrow` /
 *      `flexShrink` weights and clamp each result to the child's
 *      [`minWidth`, `maxWidth`] (or height) range.
 *   4. Position items along the main axis with `flex-start` justification
 *      (the M5 milestone covers `space-between` / `center` / etc.). Apply
 *      margin and gap. Reverse-direction containers are flipped at the end.
 *   5. Cross-axis sizing defaults to `stretch` (the CSS-Flexbox default,
 *      which is also the M4 default until M5 brings in `alignItems` /
 *      `alignSelf`). Children with an explicit cross-size style use that
 *      value (clamped). Cross-position is `padding-start + margin-start`.
 *   6. Recurse into each visible child (`display !== 'none'`).
 *
 * Position rounding lives in `round.ts` and runs once at the very end so
 * sibling boxes butt cleanly against integer cell boundaries.
 */

import { MeasureMode } from '../measure-func.js';
import type { Node } from '../node.js';
import {
  type Axis,
  clampSize,
  crossAxis,
  gapAlong,
  isReverse,
  mainAxis,
  maxSize,
  minSize,
  preferredSize,
  readEnd,
  readStart,
} from './axis.js';

/**
 * Lay out a node's children. The container's own `layout.width` and
 * `layout.height` must already be set when this is called. The function
 * mutates each visible child's `layout` and recurses into them.
 */
export function layoutChildren(node: Node): void {
  const visibleChildren = visibleChildrenOf(node);
  if (visibleChildren.length === 0) {
    measureLeafIfNeeded(node);
    return;
  }

  const main: Axis = mainAxis(node.style.flexDirection);
  const cross: Axis = crossAxis(node.style.flexDirection);

  const containerMain = sizeOnAxis(node, main);
  const containerCross = sizeOnAxis(node, cross);

  const padMainStart = readStart(node.style.padding, main);
  const padMainEnd = readEnd(node.style.padding, main);
  const padCrossStart = readStart(node.style.padding, cross);
  const padCrossEnd = readEnd(node.style.padding, cross);

  const innerMain = Math.max(0, containerMain - padMainStart - padMainEnd);
  const innerCross = Math.max(0, containerCross - padCrossStart - padCrossEnd);

  const gapMain = gapAlong(node.style, main);
  const totalGap = gapMain * (visibleChildren.length - 1);

  // Step 1: hypothetical main size + main-axis margin per child.
  const hypothetical: number[] = new Array(visibleChildren.length);
  const mainMarginStart: number[] = new Array(visibleChildren.length);
  const mainMarginEnd: number[] = new Array(visibleChildren.length);
  let consumedBase = 0;

  for (let i = 0; i < visibleChildren.length; i++) {
    const child = visibleChildren[i]!;
    const ms = readStart(child.style.margin, main);
    const me = readEnd(child.style.margin, main);
    mainMarginStart[i] = ms;
    mainMarginEnd[i] = me;

    const basis = resolveHypotheticalMainSize(child, main, innerMain, innerCross);
    const clamped = clampSize(child.style, main, basis);
    hypothetical[i] = clamped;
    consumedBase += clamped + ms + me;
  }

  // Step 2: distribute the slack with flexGrow or flexShrink.
  const remaining = innerMain - consumedBase - totalGap;
  const finalMain = hypothetical.slice();

  if (remaining > 0) {
    distributeGrow(visibleChildren, finalMain, remaining, main);
  } else if (remaining < 0) {
    distributeShrink(visibleChildren, finalMain, hypothetical, -remaining, main);
  }

  // Step 3: position children along the main axis (flex-start).
  let cursor = padMainStart;
  for (let i = 0; i < visibleChildren.length; i++) {
    const child = visibleChildren[i]!;
    cursor += mainMarginStart[i]!;
    writeMainPos(child, main, cursor);
    writeMainSize(child, main, finalMain[i]!);
    cursor += finalMain[i]! + mainMarginEnd[i]!;
    if (i < visibleChildren.length - 1) cursor += gapMain;
  }

  // Step 4: cross-axis sizing. M4 defaults to stretch (the CSS default and
  // the v1 baseline until alignItems / alignSelf land in M5). An explicit
  // cross-size style on the child overrides stretch; a measure function's
  // cross output is intentionally ignored here because under stretch the
  // cross size comes from the container, not the content.
  for (const child of visibleChildren) {
    const cms = readStart(child.style.margin, cross);
    const cme = readEnd(child.style.margin, cross);
    const explicit = preferredSize(child.style, cross);

    let crossSize: number;
    if (typeof explicit === 'number') {
      crossSize = clampSize(child.style, cross, explicit);
    } else {
      crossSize = Math.max(0, innerCross - cms - cme);
      crossSize = clampSize(child.style, cross, crossSize);
    }

    writeCrossPos(child, cross, padCrossStart + cms);
    writeCrossSize(child, cross, crossSize);
  }

  // Step 5: reverse main-axis order if requested.
  if (isReverse(node.style.flexDirection)) {
    flipMainAxis(visibleChildren, main, containerMain);
  }

  // Step 6: recurse.
  for (const child of visibleChildren) {
    layoutChildren(child);
  }
}

// ─────────────────────────────────────────────────────────────────────────

function visibleChildrenOf(node: Node): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < node.getChildCount(); i++) {
    const c = node.getChild(i)!;
    if (c.style.display === 'none') continue;
    if (c.style.positionType === 'absolute') continue; // M6 handles absolute
    out.push(c);
  }
  return out;
}

function measureLeafIfNeeded(node: Node): void {
  const fn = node.getMeasureFunc();
  if (fn === null) return;

  const ownWidth = node.layout.width;
  const ownHeight = node.layout.height;
  const padW = (node.style.padding[1] ?? 0) + (node.style.padding[3] ?? 0);
  const padH = (node.style.padding[0] ?? 0) + (node.style.padding[2] ?? 0);

  // If the parent already fixed both axes (typical when invoked from
  // layoutChildren's stretch step) the measure function's output is purely
  // informational; we leave the layout box as-is. We still call it so that
  // consumers that rely on the side-effect (e.g. cache priming) see it.
  fn(
    Math.max(0, ownWidth - padW),
    MeasureMode.AtMost,
    Math.max(0, ownHeight - padH),
    MeasureMode.AtMost,
  );
}

function sizeOnAxis(node: Node, axis: Axis): number {
  return axis === 'row' ? node.layout.width : node.layout.height;
}

function writeMainPos(node: Node, main: Axis, value: number): void {
  if (main === 'row') node.layout.left = value;
  else node.layout.top = value;
}

function writeMainSize(node: Node, main: Axis, value: number): void {
  if (main === 'row') node.layout.width = value;
  else node.layout.height = value;
}

function writeCrossPos(node: Node, cross: Axis, value: number): void {
  if (cross === 'row') node.layout.left = value;
  else node.layout.top = value;
}

function writeCrossSize(node: Node, cross: Axis, value: number): void {
  if (cross === 'row') node.layout.width = value;
  else node.layout.height = value;
}

/**
 * Hypothetical main size for a child:
 *   - explicit `flexBasis` number → that.
 *   - `flexBasis: 'auto'` and explicit main-axis size → that.
 *   - leaf with a measure function → ask it under "at most innerMain".
 *   - otherwise 0 (M4 does not yet do content-sized intrinsic sizing for
 *     non-leaf children; M5 / M6 may revisit).
 */
function resolveHypotheticalMainSize(
  child: Node,
  main: Axis,
  innerMain: number,
  innerCross: number,
): number {
  const basis = child.style.flexBasis;
  if (typeof basis === 'number') return basis;

  const styleMain = preferredSize(child.style, main);
  if (typeof styleMain === 'number') return styleMain;

  const measure = child.getMeasureFunc();
  if (measure !== null && child.getChildCount() === 0) {
    const cross = main === 'row' ? 'column' : 'row';
    const cs = preferredSize(child.style, cross);
    const crossHint = typeof cs === 'number' ? cs : innerCross;
    const result = measure(
      main === 'row' ? innerMain : crossHint,
      main === 'row' ? MeasureMode.AtMost : MeasureMode.Undefined,
      main === 'column' ? innerMain : crossHint,
      main === 'column' ? MeasureMode.AtMost : MeasureMode.Undefined,
    );
    return main === 'row' ? result.width : result.height;
  }

  return 0;
}

/**
 * Distribute positive slack via flex-grow with the CSS "freeze" loop:
 * proportional share, then clamp to [min, max] — any item that clamps is
 * frozen and the remaining slack is re-distributed among the unfrozen items.
 *
 * Iterates at most `children.length` times; each iteration freezes at least
 * one item (otherwise it terminates).
 */
function distributeGrow(children: Node[], finalMain: number[], slack: number, main: Axis): void {
  const n = children.length;
  const frozen: boolean[] = new Array(n).fill(false);
  const hypothetical = finalMain.slice();

  for (let i = 0; i < n; i++) {
    if (children[i]!.style.flexGrow <= 0) frozen[i] = true;
  }

  for (let iter = 0; iter < n + 1; iter++) {
    let totalGrow = 0;
    let frozenContribution = 0;
    for (let i = 0; i < n; i++) {
      if (frozen[i]) frozenContribution += finalMain[i]! - hypothetical[i]!;
      else totalGrow += children[i]!.style.flexGrow;
    }
    if (totalGrow <= 0) return;

    const remaining = slack - frozenContribution;
    if (remaining <= 0) return;

    let frozeAny = false;
    for (let i = 0; i < n; i++) {
      if (frozen[i]) continue;
      const grow = children[i]!.style.flexGrow;
      const target = hypothetical[i]! + (remaining * grow) / totalGrow;
      const clamped = clampSize(children[i]!.style, main, target);
      finalMain[i] = clamped;
      if (clamped !== target) {
        frozen[i] = true;
        frozeAny = true;
      }
    }
    if (!frozeAny) return;
  }
}

/**
 * Distribute negative slack (overflow) via the CSS "scaled flex shrink
 * factor" = flexShrink × flexBaseSize, with the same freeze loop as grow.
 */
function distributeShrink(
  children: Node[],
  finalMain: number[],
  hypothetical: number[],
  overflow: number,
  main: Axis,
): void {
  const n = children.length;
  const frozen: boolean[] = new Array(n).fill(false);

  for (let i = 0; i < n; i++) {
    if (children[i]!.style.flexShrink <= 0) frozen[i] = true;
  }

  for (let iter = 0; iter < n + 1; iter++) {
    let totalScaled = 0;
    let frozenContribution = 0;
    for (let i = 0; i < n; i++) {
      if (frozen[i]) frozenContribution += hypothetical[i]! - finalMain[i]!;
      else totalScaled += children[i]!.style.flexShrink * hypothetical[i]!;
    }
    if (totalScaled <= 0) return;

    const remaining = overflow - frozenContribution;
    if (remaining <= 0) return;

    let frozeAny = false;
    for (let i = 0; i < n; i++) {
      if (frozen[i]) continue;
      const scaled = children[i]!.style.flexShrink * hypothetical[i]!;
      if (scaled <= 0) {
        frozen[i] = true;
        continue;
      }
      const reduction = (remaining * scaled) / totalScaled;
      const target = hypothetical[i]! - reduction;
      const clamped = clampSize(children[i]!.style, main, target);
      finalMain[i] = clamped;
      if (clamped !== target) {
        frozen[i] = true;
        frozeAny = true;
      }
    }
    if (!frozeAny) return;
  }
}

function flipMainAxis(children: Node[], main: Axis, containerMain: number): void {
  for (const child of children) {
    const childMain = main === 'row' ? child.layout.width : child.layout.height;
    const childPos = main === 'row' ? child.layout.left : child.layout.top;
    const newPos = containerMain - childPos - childMain;
    if (main === 'row') child.layout.left = newPos;
    else child.layout.top = newPos;
  }
}

/**
 * Resolve the root node's own size from style + caller-supplied availability.
 *
 *   - explicit number → use it (clamped to min/max).
 *   - 'auto' + a measure function → ask the measure function.
 *   - 'auto' + an `available` value → use available, clamped.
 *   - 'auto' with neither → 0.
 */
export function resolveRootAxisSize(node: Node, axis: Axis, available: number | undefined): number {
  const style = preferredSize(node.style, axis);
  if (typeof style === 'number') {
    return clampSize(node.style, axis, style);
  }
  if (available !== undefined) {
    let v = available;
    const mn = minSize(node.style, axis);
    const mx = maxSize(node.style, axis);
    if (v < mn) v = mn;
    if (mx !== undefined && v > mx) v = mx;
    return v;
  }
  return 0;
}
