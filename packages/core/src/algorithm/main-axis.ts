/**
 * The flex layout algorithm — Milestones 4 + 5.
 *
 * Pipeline (one container at a time):
 *
 *   1. Build per-child `FlexItem` records: hypothetical main size (basis or
 *      style or measure-func or 0), main and cross margins, "natural" cross
 *      size (used when alignment is not stretch).
 *   2. Pack items into `FlexLine`s. With `flex-wrap: nowrap` everything goes
 *      on one line; with `wrap` items spill onto a new line whenever the
 *      next addition would exceed the container's inner main size.
 *   3. For each line, distribute slack via flex-grow / flex-shrink with the
 *      CSS freeze loop (items hitting min/max are frozen, their slack is
 *      redistributed among unfrozen siblings). M4 work, unchanged.
 *   4. Compute each line's cross size: max of items' (natural cross +
 *      cross-margins). Single-line containers just use the inner cross.
 *   5. Stack lines along the cross axis with `align-content`. Multi-line
 *      stacks distribute leftover space; single-line stacks just place the
 *      one line at the start.
 *   6. Inside each line, position items along the main axis with
 *      `justify-content`. Leftover space is distributed via flex-start /
 *      flex-end / center / space-between / space-around / space-evenly.
 *   7. Inside each line, cross-align each item: alignSelf takes precedence,
 *      falling back to the container's alignItems for items with
 *      alignSelf: 'auto'. Stretch fills the line cross size.
 *   8. Reverse-direction containers flip main positions; wrap-reverse
 *      reverses the line stack on the cross axis.
 *   9. Recurse into each visible child.
 *
 * Position rounding lives in `round.ts` and runs once at the very end so
 * sibling boxes butt cleanly on integer cell boundaries.
 */

import { MeasureMode } from '../measure-func.js';
import type { Node } from '../node.js';
import type { Align, Justify, Style } from '../style.js';
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

interface FlexItem {
  node: Node;
  /** Hypothetical main size after clamp. */
  hypothetical: number;
  /** Final main size after flex distribution (set by `distributeFlex`). */
  finalMain: number;
  /** "Natural" cross size used when alignment is not stretch. */
  naturalCross: number;
  /** Final cross size after alignment (set in step 7). */
  finalCross: number;
  /** Position within line on the main axis (set in step 6). */
  mainPos: number;
  /** Position within line on the cross axis, relative to line cross start. */
  crossPos: number;
  marginMainStart: number;
  marginMainEnd: number;
  marginCrossStart: number;
  marginCrossEnd: number;
}

interface FlexLine {
  items: FlexItem[];
  /** Sum of (hypothetical + main margins) + (n-1)*gap, before flex distribution. */
  hypotheticalMain: number;
  /** Cross size of the line (max of items' (cross + margins)). */
  crossSize: number;
  /** Position of line start on cross axis, relative to inner padding start. */
  crossPos: number;
}

/**
 * Lay out a node's children. The container's own `layout.width` and
 * `layout.height` must already be set when this is called.
 *
 * Two child populations are handled here:
 *   - In-flow flex children (positionType !== 'absolute', display !== 'none'):
 *     run through the 8-step flex pipeline.
 *   - Out-of-flow absolute children (positionType === 'absolute',
 *     display !== 'none'): positioned independently against the parent's
 *     content box. They do not contribute to the flex pipeline.
 *
 * After both populations are positioned, the function recurses into every
 * non-hidden child so their own descendants are laid out within the box
 * we just assigned them.
 */
export function layoutChildren(node: Node): void {
  const flowChildren = visibleChildrenOf(node);
  const absoluteList = absoluteChildrenOf(node);

  if (flowChildren.length === 0 && absoluteList.length === 0) {
    measureLeafIfNeeded(node);
    return;
  }

  if (flowChildren.length > 0) {
    layoutFlexFlow(node, flowChildren);
  }

  if (absoluteList.length > 0) {
    layoutAbsoluteChildren(node, absoluteList);
  }

  // Recurse into every non-hidden child so descendants are laid out within
  // the box we just assigned them. (Absolute children may have their own
  // flex subtrees.)
  for (let i = 0; i < node.getChildCount(); i++) {
    const c = node.getChild(i)!;
    if (c.style.display === 'none') continue;
    layoutChildren(c);
  }
}

/** The 8-step flex pipeline for in-flow children. */
function layoutFlexFlow(node: Node, visible: readonly Node[]): void {
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
  const gapCross = gapAlong(node.style, cross);

  // Step 1: build per-child FlexItem records.
  const items: FlexItem[] = visible.map((child) =>
    buildItem(child, main, cross, innerMain, innerCross),
  );

  // Step 2: pack into lines.
  const lines = packIntoLines(items, innerMain, gapMain, node.style.flexWrap);

  // Step 3: distribute slack within each line.
  for (const line of lines) {
    distributeFlexInLine(line, innerMain, main);
  }

  // Step 4: each line's cross size.
  computeLineCrossSizes(lines, innerCross, lines.length === 1);

  // Step 5: stack lines on the cross axis with align-content.
  positionLinesOnCross(lines, node.style.alignContent, innerCross, gapCross);
  if (node.style.flexWrap === 'wrap-reverse') {
    reverseLineStack(lines, innerCross);
  }

  // Step 6 & 7: per-line item positioning and cross-alignment.
  for (const line of lines) {
    positionItemsInLine(line, node.style.justifyContent, innerMain, gapMain);
    crossAlignItemsInLine(line, node.style.alignItems);
  }

  // Step 8: write to layout boxes (translating line + item to absolute).
  for (const line of lines) {
    for (const item of line.items) {
      const mainAbs = padMainStart + item.mainPos;
      const crossAbs = padCrossStart + line.crossPos + item.crossPos;
      writeMainPos(item.node, main, mainAbs);
      writeMainSize(item.node, main, item.finalMain);
      writeCrossPos(item.node, cross, crossAbs);
      writeCrossSize(item.node, cross, item.finalCross);
    }
  }

  // Reverse main-axis positions for *-reverse directions.
  if (isReverse(node.style.flexDirection)) {
    flipMainAxis(visible, main, padMainStart, innerMain);
  }
}

/**
 * Lay out absolutely-positioned children against the parent's outer box.
 *
 * Position offsets are measured from the parent's outer edges, NOT its
 * content (post-padding) edges. This matches Yoga / React Native semantics,
 * which differs from CSS — under CSS, absolute children are positioned
 * against the padding edge. We keep Yoga's choice so consumers porting from
 * Yoga / Ink see consistent results.
 *
 * Sizing rules per axis:
 *   - explicit `width`/`height` style → use it (clamped).
 *   - both opposite edges set, no explicit size → derive from edges.
 *   - measure function on a leaf → ask it.
 *   - otherwise → 0.
 *
 * Position rules per axis:
 *   - start edge set → anchor `start_offset + margin_start` from parent's outer edge.
 *   - else end edge set → anchor relative to parent's opposite outer edge.
 *   - else → 0 from parent's outer edge (no anchor; v1 simplification —
 *     Yoga falls back to justify/align here, which we may revisit).
 */
function layoutAbsoluteChildren(parent: Node, absolutes: readonly Node[]): void {
  const outerW = parent.layout.width;
  const outerH = parent.layout.height;
  for (const child of absolutes) {
    layoutAbsoluteChild(child, outerW, outerH);
  }
}

const POS_TOP = 0;
const POS_RIGHT = 1;
const POS_BOTTOM = 2;
const POS_LEFT = 3;

function layoutAbsoluteChild(child: Node, parentOuterW: number, parentOuterH: number): void {
  const pos = child.style.position;
  const margin = child.style.margin;

  // Resolve width.
  let width: number;
  const wStyle = child.style.width;
  if (typeof wStyle === 'number') {
    width = clampSize(child.style, 'row', wStyle);
  } else if (pos[POS_LEFT] !== undefined && pos[POS_RIGHT] !== undefined) {
    const candidate =
      parentOuterW - pos[POS_LEFT] - pos[POS_RIGHT] - margin[POS_LEFT] - margin[POS_RIGHT];
    width = clampSize(child.style, 'row', Math.max(0, candidate));
  } else if (child.getMeasureFunc() !== null && child.getChildCount() === 0) {
    const result = child.getMeasureFunc()!(
      parentOuterW,
      MeasureMode.AtMost,
      parentOuterH,
      MeasureMode.AtMost,
    );
    width = clampSize(child.style, 'row', result.width);
  } else {
    width = clampSize(child.style, 'row', 0);
  }

  // Resolve height.
  let height: number;
  const hStyle = child.style.height;
  if (typeof hStyle === 'number') {
    height = clampSize(child.style, 'column', hStyle);
  } else if (pos[POS_TOP] !== undefined && pos[POS_BOTTOM] !== undefined) {
    const candidate =
      parentOuterH - pos[POS_TOP] - pos[POS_BOTTOM] - margin[POS_TOP] - margin[POS_BOTTOM];
    height = clampSize(child.style, 'column', Math.max(0, candidate));
  } else if (child.getMeasureFunc() !== null && child.getChildCount() === 0) {
    const result = child.getMeasureFunc()!(
      width,
      MeasureMode.Exactly,
      parentOuterH,
      MeasureMode.AtMost,
    );
    height = clampSize(child.style, 'column', result.height);
  } else {
    height = clampSize(child.style, 'column', 0);
  }

  // Resolve left.
  let left: number;
  if (pos[POS_LEFT] !== undefined) {
    left = pos[POS_LEFT] + margin[POS_LEFT];
  } else if (pos[POS_RIGHT] !== undefined) {
    left = parentOuterW - width - pos[POS_RIGHT] - margin[POS_RIGHT];
  } else {
    left = margin[POS_LEFT];
  }

  // Resolve top.
  let top: number;
  if (pos[POS_TOP] !== undefined) {
    top = pos[POS_TOP] + margin[POS_TOP];
  } else if (pos[POS_BOTTOM] !== undefined) {
    top = parentOuterH - height - pos[POS_BOTTOM] - margin[POS_BOTTOM];
  } else {
    top = margin[POS_TOP];
  }

  child._layout.left = left;
  child._layout.top = top;
  child._layout.width = width;
  child._layout.height = height;
}

// A frozen empty tuple lets the no-children case avoid allocating a
// fresh array per layoutChildren call. Most subtrees in a real UI have
// no absolute descendants, and this runs on every re-layout.
const NO_CHILDREN: readonly Node[] = Object.freeze([]);

function absoluteChildrenOf(node: Node): readonly Node[] {
  const count = node.getChildCount();
  if (count === 0) return NO_CHILDREN;
  let out: Node[] | null = null;
  for (let i = 0; i < count; i++) {
    const c = node.getChild(i)!;
    if (c.style.display === 'none') continue;
    if (c.style.positionType === 'absolute') {
      if (out === null) out = [];
      out.push(c);
    }
  }
  return out ?? NO_CHILDREN;
}

// ─── step 1: build items ────────────────────────────────────────────────

function buildItem(
  node: Node,
  main: Axis,
  cross: Axis,
  innerMain: number,
  innerCross: number,
): FlexItem {
  const hypothetical = clampSize(
    node.style,
    main,
    resolveHypotheticalMainSize(node, main, innerMain, innerCross),
  );
  const naturalCross = naturalCrossSize(node, cross, innerCross);
  return {
    node,
    hypothetical,
    finalMain: hypothetical,
    naturalCross,
    finalCross: naturalCross,
    mainPos: 0,
    crossPos: 0,
    marginMainStart: readStart(node.style.margin, main),
    marginMainEnd: readEnd(node.style.margin, main),
    marginCrossStart: readStart(node.style.margin, cross),
    marginCrossEnd: readEnd(node.style.margin, cross),
  };
}

// ─── step 2: pack items into lines ──────────────────────────────────────

function packIntoLines(
  items: FlexItem[],
  innerMain: number,
  gapMain: number,
  wrap: Style['flexWrap'],
): FlexLine[] {
  if (wrap === 'nowrap' || items.length <= 1) {
    return [singleLine(items, gapMain)];
  }

  const lines: FlexLine[] = [];
  let current: FlexItem[] = [];
  let currentMain = 0;

  for (const item of items) {
    const itemMain = item.hypothetical + item.marginMainStart + item.marginMainEnd;
    const wouldUse = currentMain + (current.length > 0 ? gapMain : 0) + itemMain;
    if (current.length > 0 && wouldUse > innerMain) {
      lines.push(makeLine(current, currentMain));
      current = [item];
      currentMain = itemMain;
    } else {
      if (current.length > 0) currentMain += gapMain;
      current.push(item);
      currentMain += itemMain;
    }
  }
  if (current.length > 0) lines.push(makeLine(current, currentMain));
  return lines;
}

function singleLine(items: FlexItem[], gapMain: number): FlexLine {
  let hypotheticalMain = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    hypotheticalMain += it.hypothetical + it.marginMainStart + it.marginMainEnd;
    if (i < items.length - 1) hypotheticalMain += gapMain;
  }
  return { items, hypotheticalMain, crossSize: 0, crossPos: 0 };
}

function makeLine(items: FlexItem[], hypotheticalMain: number): FlexLine {
  return { items, hypotheticalMain, crossSize: 0, crossPos: 0 };
}

// ─── step 3: distribute flex-grow / flex-shrink within a line ───────────

function distributeFlexInLine(line: FlexLine, innerMain: number, main: Axis): void {
  // `line.hypotheticalMain` already includes the gap budget — both
  // singleLine() and packIntoLines() accumulate gaps into it as they
  // build the line — so the slack is just inner - hypothetical.
  const remaining = innerMain - line.hypotheticalMain;
  if (remaining > 0) {
    distributeGrow(line.items, remaining, main);
  } else if (remaining < 0) {
    distributeShrink(line.items, -remaining, main);
  }
}

function distributeGrow(items: FlexItem[], slack: number, main: Axis): void {
  const n = items.length;
  const frozen: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (items[i]!.node.style.flexGrow <= 0) frozen[i] = true;
  }

  for (let iter = 0; iter < n + 1; iter++) {
    let totalGrow = 0;
    let frozenContribution = 0;
    for (let i = 0; i < n; i++) {
      if (frozen[i]) frozenContribution += items[i]!.finalMain - items[i]!.hypothetical;
      else totalGrow += items[i]!.node.style.flexGrow;
    }
    if (totalGrow <= 0) return;
    const remaining = slack - frozenContribution;
    if (remaining <= 0) return;

    let frozeAny = false;
    for (let i = 0; i < n; i++) {
      if (frozen[i]) continue;
      const item = items[i]!;
      const grow = item.node.style.flexGrow;
      const target = item.hypothetical + (remaining * grow) / totalGrow;
      const clamped = clampSize(item.node.style, main, target);
      item.finalMain = clamped;
      if (clamped !== target) {
        frozen[i] = true;
        frozeAny = true;
      }
    }
    if (!frozeAny) return;
  }
}

function distributeShrink(items: FlexItem[], overflow: number, main: Axis): void {
  const n = items.length;
  const frozen: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (items[i]!.node.style.flexShrink <= 0) frozen[i] = true;
  }

  for (let iter = 0; iter < n + 1; iter++) {
    let totalScaled = 0;
    let frozenContribution = 0;
    for (let i = 0; i < n; i++) {
      if (frozen[i]) frozenContribution += items[i]!.hypothetical - items[i]!.finalMain;
      else totalScaled += items[i]!.node.style.flexShrink * items[i]!.hypothetical;
    }
    if (totalScaled <= 0) return;
    const remaining = overflow - frozenContribution;
    if (remaining <= 0) return;

    let frozeAny = false;
    for (let i = 0; i < n; i++) {
      if (frozen[i]) continue;
      const item = items[i]!;
      const scaled = item.node.style.flexShrink * item.hypothetical;
      if (scaled <= 0) {
        frozen[i] = true;
        continue;
      }
      const reduction = (remaining * scaled) / totalScaled;
      const target = item.hypothetical - reduction;
      const clamped = clampSize(item.node.style, main, target);
      item.finalMain = clamped;
      if (clamped !== target) {
        frozen[i] = true;
        frozeAny = true;
      }
    }
    if (!frozeAny) return;
  }
}

// ─── step 4: per-line cross size ────────────────────────────────────────

function computeLineCrossSizes(
  lines: FlexLine[],
  innerCross: number,
  singleLineMode: boolean,
): void {
  if (singleLineMode) {
    // CSS: a single-line flex container's only line takes the container's
    // inner cross size.
    if (lines.length > 0) lines[0]!.crossSize = innerCross;
    return;
  }
  for (const line of lines) {
    let max = 0;
    for (const it of line.items) {
      const candidate = it.naturalCross + it.marginCrossStart + it.marginCrossEnd;
      if (candidate > max) max = candidate;
    }
    line.crossSize = max;
  }
}

// ─── step 5: position lines on the cross axis (align-content) ───────────

function positionLinesOnCross(
  lines: FlexLine[],
  alignContent: Align,
  innerCross: number,
  gapCross: number,
): void {
  if (lines.length === 1) {
    lines[0]!.crossPos = 0;
    return;
  }

  let used = 0;
  for (const line of lines) used += line.crossSize;
  used += (lines.length - 1) * gapCross;
  const leftover = innerCross - used;

  // 'auto' on align-content means stretch. We treat any value not in the
  // distribution set as flex-start.
  let cursor = 0;
  let extraGap = 0;
  let lineSizeBoost = 0;

  switch (alignContent) {
    case 'flex-end':
      cursor = leftover;
      break;
    case 'center':
      cursor = leftover / 2;
      break;
    case 'space-between':
      if (lines.length > 1 && leftover > 0) extraGap = leftover / (lines.length - 1);
      break;
    case 'space-around':
      if (leftover > 0) {
        const slot = leftover / lines.length;
        cursor = slot / 2;
        extraGap = slot;
      }
      break;
    case 'stretch':
    case 'auto':
      if (leftover > 0) lineSizeBoost = leftover / lines.length;
      break;
    default:
      // flex-start: cursor = 0, no extra.
      break;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (lineSizeBoost > 0) line.crossSize += lineSizeBoost;
    line.crossPos = cursor;
    cursor += line.crossSize + gapCross + extraGap;
  }
}

function reverseLineStack(lines: FlexLine[], innerCross: number): void {
  for (const line of lines) {
    line.crossPos = innerCross - line.crossPos - line.crossSize;
  }
}

// ─── step 6: justify-content per line ───────────────────────────────────

function positionItemsInLine(
  line: FlexLine,
  justify: Justify,
  innerMain: number,
  gapMain: number,
): void {
  const items = line.items;
  const n = items.length;
  if (n === 0) return;

  let usedMain = 0;
  for (let i = 0; i < n; i++) {
    const it = items[i]!;
    usedMain += it.finalMain + it.marginMainStart + it.marginMainEnd;
    if (i < n - 1) usedMain += gapMain;
  }
  const leftover = Math.max(0, innerMain - usedMain);

  let cursor = 0;
  let extraGap = 0;

  switch (justify) {
    case 'flex-end':
      cursor = leftover;
      break;
    case 'center':
      cursor = leftover / 2;
      break;
    case 'space-between':
      if (n > 1) extraGap = leftover / (n - 1);
      break;
    case 'space-around': {
      const slot = leftover / n;
      cursor = slot / 2;
      extraGap = slot;
      break;
    }
    case 'space-evenly': {
      const slot = leftover / (n + 1);
      cursor = slot;
      extraGap = slot;
      break;
    }
    default:
      // flex-start: cursor = 0, extra = 0.
      break;
  }

  for (let i = 0; i < n; i++) {
    const it = items[i]!;
    cursor += it.marginMainStart;
    it.mainPos = cursor;
    cursor += it.finalMain + it.marginMainEnd;
    if (i < n - 1) cursor += gapMain + extraGap;
  }
}

// ─── step 7: align-items / align-self per item ──────────────────────────

function crossAlignItemsInLine(line: FlexLine, alignItems: Align): void {
  for (const item of line.items) {
    const align = effectiveAlign(item.node.style.alignSelf, alignItems);
    const innerLine = line.crossSize - item.marginCrossStart - item.marginCrossEnd;
    const cross = inferCrossAxisFromContext(item, line);

    if (align === 'stretch') {
      const explicit = preferredSize(item.node.style, cross);
      if (typeof explicit === 'number') {
        item.finalCross = clampSize(item.node.style, cross, explicit);
      } else {
        item.finalCross = clampSize(item.node.style, cross, Math.max(0, innerLine));
      }
      item.crossPos = item.marginCrossStart;
      continue;
    }

    // Non-stretch: use the natural cross size, clamped.
    const naturalClamped = clampSize(item.node.style, cross, item.naturalCross);
    item.finalCross = naturalClamped;

    switch (align) {
      case 'flex-end':
        item.crossPos = line.crossSize - naturalClamped - item.marginCrossEnd;
        break;
      case 'center':
        item.crossPos = item.marginCrossStart + Math.max(0, (innerLine - naturalClamped) / 2);
        break;
      default:
        // flex-start, baseline (treated as flex-start in v1), space-* on
        // an item (degenerate — treat as flex-start).
        item.crossPos = item.marginCrossStart;
        break;
    }
  }
}

function effectiveAlign(self: Align, items: Align): Align {
  return self === 'auto' ? items : self;
}

/**
 * The cross axis we're working on within `crossAlignItemsInLine`. We look at
 * the item's parent direction via the FlexItem context; since cross/main are
 * fixed per layoutChildren call, we infer from the item's own layout-time
 * cross axis. Helper kept private so the hot path doesn't recompute it.
 */
function inferCrossAxisFromContext(item: FlexItem, _line: FlexLine): Axis {
  // Cross axis is the perpendicular of the parent's flex direction. The
  // parent is the only place flexDirection lives, so we look it up via the
  // node's parent.
  const parent = item.node.getParent();
  if (parent === null) return 'column';
  return crossAxis(parent.style.flexDirection);
}

// ─── helpers ────────────────────────────────────────────────────────────

function visibleChildrenOf(node: Node): readonly Node[] {
  const count = node.getChildCount();
  if (count === 0) return NO_CHILDREN;
  let out: Node[] | null = null;
  for (let i = 0; i < count; i++) {
    const c = node.getChild(i)!;
    if (c.style.display === 'none') continue;
    if (c.style.positionType === 'absolute') continue; // M6 handles absolute
    if (out === null) out = [];
    out.push(c);
  }
  return out ?? NO_CHILDREN;
}

function measureLeafIfNeeded(node: Node): void {
  const fn = node.getMeasureFunc();
  if (fn === null) return;
  const padW = (node.style.padding[1] ?? 0) + (node.style.padding[3] ?? 0);
  const padH = (node.style.padding[0] ?? 0) + (node.style.padding[2] ?? 0);
  fn(
    Math.max(0, node.layout.width - padW),
    MeasureMode.AtMost,
    Math.max(0, node.layout.height - padH),
    MeasureMode.AtMost,
  );
}

function sizeOnAxis(node: Node, axis: Axis): number {
  return axis === 'row' ? node.layout.width : node.layout.height;
}

function writeMainPos(node: Node, main: Axis, value: number): void {
  if (main === 'row') node._layout.left = value;
  else node._layout.top = value;
}
function writeMainSize(node: Node, main: Axis, value: number): void {
  if (main === 'row') node._layout.width = value;
  else node._layout.height = value;
}
function writeCrossPos(node: Node, cross: Axis, value: number): void {
  if (cross === 'row') node._layout.left = value;
  else node._layout.top = value;
}
function writeCrossSize(node: Node, cross: Axis, value: number): void {
  if (cross === 'row') node._layout.width = value;
  else node._layout.height = value;
}

function resolveHypotheticalMainSize(
  child: Node,
  main: Axis,
  _innerMain: number,
  innerCross: number,
): number {
  const basis = child.style.flexBasis;
  if (typeof basis === 'number') return basis;

  const styleMain = preferredSize(child.style, main);
  if (typeof styleMain === 'number') return styleMain;

  const measure = child.getMeasureFunc();
  if (measure !== null && child.getChildCount() === 0) {
    // Ask the leaf for its natural main-axis size: cross axis is
    // constrained (AtMost the available cross), main axis is free
    // (Undefined). The measure function reports `{ width, height }` as
    // dimensions of the node, so we map main/cross to width/height before
    // calling.
    const cross: Axis = main === 'row' ? 'column' : 'row';
    const cs = preferredSize(child.style, cross);
    const crossConstraint = typeof cs === 'number' ? cs : innerCross;

    let widthArg: number;
    let heightArg: number;
    let widthMode: MeasureMode;
    let heightMode: MeasureMode;
    if (main === 'row') {
      // main = width (free), cross = height (constrained)
      widthArg = 0;
      widthMode = MeasureMode.Undefined;
      heightArg = crossConstraint;
      heightMode = MeasureMode.AtMost;
    } else {
      // main = height (free), cross = width (constrained)
      widthArg = crossConstraint;
      widthMode = MeasureMode.AtMost;
      heightArg = 0;
      heightMode = MeasureMode.Undefined;
    }

    const result = measure(widthArg, widthMode, heightArg, heightMode);
    return main === 'row' ? result.width : result.height;
  }

  return 0;
}

function naturalCrossSize(child: Node, cross: Axis, innerCross: number): number {
  const explicit = preferredSize(child.style, cross);
  if (typeof explicit === 'number') return explicit;

  const measure = child.getMeasureFunc();
  if (measure !== null && child.getChildCount() === 0) {
    const main = cross === 'row' ? 'column' : 'row';
    const ms = preferredSize(child.style, main);
    const mainHint = typeof ms === 'number' ? ms : innerCross;
    const result = measure(
      cross === 'row' ? innerCross : mainHint,
      cross === 'row' ? MeasureMode.AtMost : MeasureMode.Undefined,
      cross === 'column' ? innerCross : mainHint,
      cross === 'column' ? MeasureMode.AtMost : MeasureMode.Undefined,
    );
    return cross === 'row' ? result.width : result.height;
  }

  return 0;
}

// Flip child positions about the inner content box (the area between
// padMainStart and padMainStart + innerMain). The child positions written in
// step 8 are absolute (`padMainStart + innerPos`), so we must subtract
// padMainStart to recover the inner-relative pos before mirroring, then add
// padMainStart back. Mirroring against the OUTER container would be wrong
// whenever padding is asymmetric.
function flipMainAxis(
  children: readonly Node[],
  main: Axis,
  padMainStart: number,
  innerMain: number,
): void {
  for (const child of children) {
    const childMain = main === 'row' ? child.layout.width : child.layout.height;
    const childPos = main === 'row' ? child.layout.left : child.layout.top;
    const innerPos = childPos - padMainStart;
    const newPos = padMainStart + innerMain - innerPos - childMain;
    if (main === 'row') child._layout.left = newPos;
    else child._layout.top = newPos;
  }
}

/**
 * Resolve the root node's own size from style + caller-supplied availability.
 *
 *   - explicit number → use it (clamped to min/max).
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
