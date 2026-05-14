/**
 * Flexbox layout expressed as an attribute grammar.
 *
 * Current slice (v5) covers:
 *
 *   - flex-direction: `row` and `column` (parent's direction governs how
 *     its children stack along the main axis)
 *   - Explicit `width` and `height` on every node (the cross-axis reads
 *     directly; the main-axis side is the basis input when no
 *     `flexBasis` is set)
 *   - flex-grow / flex-shrink / flex-basis as in v4
 *   - padding on the container (shifts children inward, shrinks the
 *     flex-distribution budget)
 *   - margin per child (shifts the child's own position, contributes
 *     to the flex-distribution hypothetical sum, never resizes)
 *   - gap between flex items (`gapColumn` between row-stacked items,
 *     `gapRow` between column-stacked items) — same role as margins
 *     in the hypothetical sum
 *   - No flex-wrap, no alignment (cross-axis offset is
 *     `padCrossStart + marginCrossStart` only)
 *   - No absolute positioning
 *   - `row-reverse` and `column-reverse` rejected at build time
 *
 * Subsequent PRs expand the feature set (alignment, wrap, abs
 * positioning, reverse directions, min/max clamping with the
 * multi-iteration freeze loop) one chunk at a time, each gated by a
 * differential test that asserts the grammar produces byte-identical
 * output to the imperative algorithm.
 *
 * Fields emitted per node:
 *
 *   - `width`  — main-axis size when parent is `row`, cross-axis size
 *                when parent is `column`. Cross axis reads
 *                `style.width` verbatim. Main axis is the result of
 *                flex distribution when the parent has any child with
 *                grow > 0, shrink > 0, or numeric `flexBasis`;
 *                otherwise it equals the basis.
 *   - `height` — symmetric to `width`.
 *   - `left`   — position relative to parent. For row-parent children
 *                this is the main-axis cursor: `padLeft + myMarginLeft
 *                + sum_priors(marginLeft + width + marginRight) +
 *                i*gapColumn`. For column-parent children it's the
 *                cross-axis position: `padLeft + myMarginLeft`. Root
 *                is at 0.
 *   - `top`    — symmetric to `left`.
 *
 * @internal
 */

import type { Node } from '../../node.js';
import { type Field, type FieldRule, type Grammar, field } from './grammar.js';

/**
 * Roots used by `buildFlexGrammar` to identify which (Node, name) pair
 * is the canonical entry point. The Spineless runtime / interpreter
 * starts evaluation from this set of fields and walks deps.
 *
 * @internal
 */
export interface FlexGrammarOutput {
  grammar: Grammar;
  /** Fields the caller typically wants computed on the root. */
  rootFields: {
    width: Field<number>;
    height: Field<number>;
    left: Field<number>;
    top: Field<number>;
  };
  /** All emitted fields, in pre-order. Useful for differential tests. */
  allFields: Array<{
    node: Node;
    width: Field<number>;
    height: Field<number>;
    left: Field<number>;
    top: Field<number>;
  }>;
}

/**
 * Walk the tree rooted at `root` and emit a `Grammar` that computes
 * each node's `{width, height, left, top}` per the rules above.
 *
 * Requires every node to have `style.width` and `style.height` set to
 * numeric values (the cross-axis side is always used directly; the
 * main-axis side serves as the basis when no `flexBasis` is provided).
 * Throws if either is `'auto'` or `undefined`.
 *
 * @internal
 */
export function buildFlexGrammar(root: Node): FlexGrammarOutput {
  const grammar: Grammar = new Map();
  const allFields: FlexGrammarOutput['allFields'] = [];

  function visit(
    node: Node,
    parent: Node | null,
    indexInParent: number,
    priorSiblings: Node[],
  ): void {
    const width = field<number>(node, 'width');
    const height = field<number>(node, 'height');
    const left = field<number>(node, 'left');
    const top = field<number>(node, 'top');

    // Validate preconditions: every node has an explicit numeric basis
    // on both axes, and the direction is one we support.
    const styleW = node.style.width;
    const styleH = node.style.height;
    if (typeof styleW !== 'number') {
      throw new Error(
        `[flex-grammar] node requires explicit numeric width; got ${JSON.stringify(styleW)}`,
      );
    }
    if (typeof styleH !== 'number') {
      throw new Error(
        `[flex-grammar] node requires explicit numeric height; got ${JSON.stringify(styleH)}`,
      );
    }
    const direction = node.style.flexDirection;
    if (direction !== 'row' && direction !== 'column') {
      throw new Error(
        `[flex-grammar] flex-direction '${direction}' is not yet supported; only 'row' and 'column' are implemented in this slice`,
      );
    }

    // The parent's direction decides which of {width, height} is the
    // main-axis size for THIS child (and which of {left, top} is the
    // main-axis position). Root is parent-less and treats both axes as
    // cross — sizes from style, positions at 0. The cast is safe: the
    // parent was visited before this child, and visit's direction
    // check throws on row-reverse / column-reverse — so a non-null
    // `parentDirection` is provably `'row' | 'column'` here.
    const parentDirection =
      parent === null ? null : (parent.style.flexDirection as 'row' | 'column');
    const mainSizeField =
      parentDirection === 'column' ? (height as Field<unknown>) : (width as Field<unknown>);
    const crossSizeField =
      parentDirection === 'column' ? (width as Field<unknown>) : (height as Field<unknown>);
    const mainPosField =
      parentDirection === 'column' ? (top as Field<unknown>) : (left as Field<unknown>);
    const crossPosField =
      parentDirection === 'column' ? (left as Field<unknown>) : (top as Field<unknown>);
    const crossSizeStyle = parentDirection === 'column' ? styleW : styleH;
    const mainSizeName: 'width' | 'height' = parentDirection === 'column' ? 'height' : 'width';

    // Parent's spacing for this child: padding along both axes, gap
    // along the main axis, plus this child's own margins. Margins,
    // padding, and gap default to 0 and so reduce v5 to v1-v4 when no
    // spacing is set anywhere.
    const padMainStart = parent === null ? 0 : readPaddingStart(parent, parentDirection!);
    const padMainEnd = parent === null ? 0 : readPaddingEnd(parent, parentDirection!);
    const padCrossStart = parent === null ? 0 : readCrossPaddingStart(parent, parentDirection!);
    const gapMain = parent === null ? 0 : readMainGap(parent, parentDirection!);
    const myMarginMainStart = parent === null ? 0 : readMarginMainStart(node, parentDirection!);
    const myMarginCrossStart = parent === null ? 0 : readMarginCrossStart(node, parentDirection!);

    // This node's own resolved basis: flexBasis if numeric, otherwise
    // style.{width|height}. Both the no-flex-distribution path (basis
    // == final size) and the flex-distribution path use this value.
    const myBasis = resolveBasis(node, mainSizeName);

    // Cross-axis size: always reads style in this slice (no stretch).
    grammar.set(crossSizeField, {
      deps: [],
      compute: () => crossSizeStyle,
    } satisfies FieldRule<number>);

    // Main-axis size: depends on whether the parent flex-distributes
    // its children. A parent flex-distributes when ANY of its children
    // has grow > 0, shrink > 0, or a numeric flexBasis — i.e. anywhere
    // a child's main size could legitimately differ from its raw
    // style.{width|height}. Outside this case the main size is just
    // the resolved basis.
    if (parent === null || !parentNeedsFlexDistribution(parent)) {
      grammar.set(mainSizeField, {
        deps: [],
        compute: () => myBasis,
      } satisfies FieldRule<number>);
    } else {
      // Flex distribution. Capture every sibling's resolved basis,
      // grow weight, shrink weight, and main-axis margins inline, look
      // up our own index, and compute the post-distribution size from
      // the parent's main-axis size minus padding (the inner main).
      const siblings: {
        basis: number;
        grow: number;
        shrink: number;
        marginStart: number;
        marginEnd: number;
      }[] = [];
      let myIndex = -1;
      for (let i = 0; i < parent.getChildCount(); i++) {
        const sib = parent.getChild(i)!;
        if (sib === node) myIndex = siblings.length;
        const sibBasis = resolveBasis(sib, mainSizeName);
        siblings.push({
          basis: sibBasis,
          grow: sib.style.flexGrow,
          shrink: sib.style.flexShrink,
          marginStart: readMarginMainStart(sib, parentDirection!),
          marginEnd: readMarginMainEnd(sib, parentDirection!),
        });
      }
      const parentMainField = field<number>(parent, mainSizeName);
      grammar.set(mainSizeField, {
        deps: [parentMainField as Field<unknown>],
        compute: (read) => {
          const containerMain = read(parentMainField);
          const innerMain = Math.max(0, containerMain - padMainStart - padMainEnd);
          return distributeMainAxis(siblings, innerMain, gapMain)[myIndex]!;
        },
      } satisfies FieldRule<number>);
    }

    // Main-axis position: cursor walks padMainStart → (for each prior
    // sibling: marginStart + size + marginEnd + gap) → myMarginStart.
    // Same sparse-and-explicit DAG as v1/v2; gaps and margins are
    // constants folded into the offset; only prior sibling MAIN SIZES
    // are dependencies that may change incrementally.
    if (parent === null || indexInParent === 0) {
      grammar.set(mainPosField, {
        deps: [],
        compute: () => padMainStart + myMarginMainStart,
      } satisfies FieldRule<number>);
    } else {
      const priorMainSizes = priorSiblings.map((s) => field<number>(s, mainSizeName));
      let constantOffset = padMainStart + myMarginMainStart + indexInParent * gapMain;
      for (const p of priorSiblings) {
        constantOffset += readMarginMainStart(p, parentDirection!);
        constantOffset += readMarginMainEnd(p, parentDirection!);
      }
      grammar.set(mainPosField, {
        deps: priorMainSizes as Field<unknown>[],
        compute: (read) => {
          let sum = constantOffset;
          for (const m of priorMainSizes) sum += read(m);
          return sum;
        },
      } satisfies FieldRule<number>);
    }

    // Cross-axis position: parent's leading cross-axis padding plus
    // this child's leading cross-axis margin (no alignment in v5, so
    // no leftover-redistribution along the cross axis).
    const crossOffset = padCrossStart + myMarginCrossStart;
    grammar.set(crossPosField, {
      deps: [],
      compute: () => crossOffset,
    } satisfies FieldRule<number>);

    allFields.push({ node, width, height, left, top });

    // Recurse into children.
    const childCount = node.getChildCount();
    const childSiblings: Node[] = [];
    for (let i = 0; i < childCount; i++) {
      const child = node.getChild(i)!;
      visit(child, node, i, [...childSiblings]);
      childSiblings.push(child);
    }
  }

  visit(root, null, 0, []);

  const rootW = field<number>(root, 'width');
  const rootH = field<number>(root, 'height');
  const rootL = field<number>(root, 'left');
  const rootT = field<number>(root, 'top');

  return {
    grammar,
    rootFields: { width: rootW, height: rootH, left: rootL, top: rootT },
    allFields,
  };
}

/**
 * Resolve a node's main-axis basis: numeric `flexBasis` wins over
 * `style.{width|height}`. Mirrors the imperative
 * `resolveHypotheticalMainSize`. Throws if neither yields a number;
 * the caller is either iterating siblings (where outer-visit
 * validation may not have run on every sibling yet) or visiting this
 * node directly (in which case the outer check would have caught the
 * cross-axis side already).
 */
function resolveBasis(node: Node, mainSizeName: 'width' | 'height'): number {
  const basis = node.style.flexBasis;
  if (typeof basis === 'number') return basis;
  const styleSize = mainSizeName === 'width' ? node.style.width : node.style.height;
  if (typeof styleSize !== 'number') {
    throw new Error(
      `[flex-grammar] flex sibling requires explicit numeric ${mainSizeName} or flexBasis; got width=${JSON.stringify(
        node.style.width,
      )}, height=${JSON.stringify(node.style.height)}, flexBasis=${JSON.stringify(basis)}`,
    );
  }
  return styleSize;
}

/**
 * True iff a parent's children carry any flex property that lets a
 * child's main size differ from its raw `style.{width|height}`: a
 * positive grow weight, a positive shrink weight, or a numeric
 * `flexBasis`.
 */
function parentNeedsFlexDistribution(parent: Node): boolean {
  const count = parent.getChildCount();
  for (let i = 0; i < count; i++) {
    const s = parent.getChild(i)!.style;
    if (s.flexGrow > 0) return true;
    if (s.flexShrink > 0) return true;
    if (typeof s.flexBasis === 'number') return true;
  }
  return false;
}

/**
 * Distribute `budget` across siblings using CSS flex semantics
 * (without min/max clamping). Returns each sibling's final main-axis
 * size in input order.
 *
 * `budget` is the parent's inner main size (containerMain minus
 * leading + trailing padding). Margins and gaps are accounted for via
 * the hypothetical sum: only the basis part of each sibling expands
 * (grow) or contracts (shrink); margins and gaps are fixed-width
 * spacers that consume budget but never resize.
 *
 * Mirrors the imperative `distributeGrow` / `distributeShrink` in
 * `main-axis.ts`. Without clamping the CSS freeze loop terminates in
 * one iteration for either branch, so we fold it down to a single
 * pass:
 *
 *   - leftover > 0 and any grow weight > 0 → each grow-positive
 *     sibling receives `(leftover * grow) / totalGrow`.
 *   - leftover < 0 and any shrink weight > 0 → each shrink-positive
 *     sibling loses `(overflow * shrink * basis) / sum(shrink * basis)`.
 *   - otherwise → every sibling stays at its basis.
 *
 * @internal
 */
function distributeMainAxis(
  siblings: readonly {
    basis: number;
    grow: number;
    shrink: number;
    marginStart: number;
    marginEnd: number;
  }[],
  budget: number,
  gap: number,
): number[] {
  let hypothetical = 0;
  let totalGrow = 0;
  let totalShrinkScaled = 0;
  for (const s of siblings) {
    hypothetical += s.basis + s.marginStart + s.marginEnd;
    if (s.grow > 0) totalGrow += s.grow;
    if (s.shrink > 0) totalShrinkScaled += s.shrink * s.basis;
  }
  if (siblings.length > 1) hypothetical += (siblings.length - 1) * gap;
  const leftover = budget - hypothetical;
  if (leftover > 0 && totalGrow > 0) {
    return siblings.map((s) => (s.grow > 0 ? s.basis + (leftover * s.grow) / totalGrow : s.basis));
  }
  if (leftover < 0 && totalShrinkScaled > 0) {
    const overflow = -leftover;
    return siblings.map((s) => {
      if (s.shrink <= 0) return s.basis;
      const scaled = s.shrink * s.basis;
      const reduction = (overflow * scaled) / totalShrinkScaled;
      return s.basis - reduction;
    });
  }
  return siblings.map((s) => s.basis);
}

// ─── axis-aware spacing readers ─────────────────────────────────────────
// Edge order in style boxes is [top, right, bottom, left]. Gap layout
// is keyed on the OUTPUT axis (the one items stack along), not the
// flex-direction name — `gapColumn` separates row-stacked items
// (column between columns), `gapRow` separates column-stacked items.

const TOP = 0;
const RIGHT = 1;
const BOTTOM = 2;
const LEFT = 3;

function mainStartEdge(direction: 'row' | 'column'): number {
  return direction === 'column' ? TOP : LEFT;
}

function mainEndEdge(direction: 'row' | 'column'): number {
  return direction === 'column' ? BOTTOM : RIGHT;
}

function crossStartEdge(direction: 'row' | 'column'): number {
  return direction === 'column' ? LEFT : TOP;
}

function readPaddingStart(parent: Node, direction: 'row' | 'column'): number {
  return parent.style.padding[mainStartEdge(direction)] ?? 0;
}

function readPaddingEnd(parent: Node, direction: 'row' | 'column'): number {
  return parent.style.padding[mainEndEdge(direction)] ?? 0;
}

function readCrossPaddingStart(parent: Node, direction: 'row' | 'column'): number {
  return parent.style.padding[crossStartEdge(direction)] ?? 0;
}

function readMainGap(parent: Node, direction: 'row' | 'column'): number {
  return direction === 'column' ? parent.style.gapRow : parent.style.gapColumn;
}

function readMarginMainStart(child: Node, direction: 'row' | 'column'): number {
  return child.style.margin[mainStartEdge(direction)] ?? 0;
}

function readMarginMainEnd(child: Node, direction: 'row' | 'column'): number {
  return child.style.margin[mainEndEdge(direction)] ?? 0;
}

function readMarginCrossStart(child: Node, direction: 'row' | 'column'): number {
  return child.style.margin[crossStartEdge(direction)] ?? 0;
}
