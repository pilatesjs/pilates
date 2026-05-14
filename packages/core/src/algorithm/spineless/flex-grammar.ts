/**
 * Flexbox layout expressed as an attribute grammar.
 *
 * Current slice (v4) covers:
 *
 *   - flex-direction: `row` and `column` (parent's direction governs how
 *     its children stack along the main axis)
 *   - Explicit `width` and `height` on every node (the cross-axis reads
 *     directly; the main-axis side is the basis input when no
 *     `flexBasis` is set)
 *   - flex-grow: positive values redistribute leftover main-axis space
 *     proportionally to grow weights
 *   - flex-shrink: positive values absorb main-axis overflow
 *     proportionally to `shrink * basis` weights (CSS rule)
 *   - flex-basis (the separate property): a numeric `flexBasis`
 *     overrides `style.{width|height}` as the basis used by the
 *     distribution. Without min/max clamping the CSS freeze loop
 *     collapses to a single pass for both grow and shrink.
 *   - No margin, no padding, no gap
 *   - No flex-wrap, no alignment (cross-axis offset is always 0)
 *   - No absolute positioning
 *   - `row-reverse` and `column-reverse` rejected at build time — they
 *     require the main-axis accumulator to walk in the opposite
 *     direction, which is a separate slice.
 *
 * Subsequent PRs expand the feature set (margin/padding/gap,
 * alignment, wrap, abs positioning, reverse directions, min/max
 * clamping with the multi-iteration freeze loop) one chunk at a time,
 * each gated by a differential test that asserts the grammar produces
 * byte-identical output to the imperative algorithm.
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
 *   - `left`   — position relative to parent. 0 for root, for first
 *                child, and for any child whose parent is `column`
 *                (cross-axis). For row-parent children: sum of prior
 *                siblings' (computed) widths.
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
    // cross — sizes from style, positions at 0.
    const parentDirection = parent === null ? null : parent.style.flexDirection;
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
      // grow weight, and shrink weight inline (they're constants from
      // style state), look up our own index, and compute the
      // post-distribution size from the parent's main-axis size.
      const siblings: { basis: number; grow: number; shrink: number }[] = [];
      let myIndex = -1;
      for (let i = 0; i < parent.getChildCount(); i++) {
        const sib = parent.getChild(i)!;
        if (sib === node) myIndex = siblings.length;
        const sibBasis = resolveBasis(sib, mainSizeName);
        siblings.push({
          basis: sibBasis,
          grow: sib.style.flexGrow,
          shrink: sib.style.flexShrink,
        });
      }
      const parentMainField = field<number>(parent, mainSizeName);
      grammar.set(mainSizeField, {
        deps: [parentMainField as Field<unknown>],
        compute: (read) => {
          const budget = read(parentMainField);
          return distributeMainAxis(siblings, budget)[myIndex]!;
        },
      } satisfies FieldRule<number>);
    }

    // Main-axis position: sum of prior siblings' main-axis sizes.
    // (Sparse-and-explicit DAG, optimal for Spineless: equivalent to
    // "last sibling's main pos + last sibling's main size" but reasons
    // more cleanly under incremental updates.)
    if (parent === null || indexInParent === 0) {
      grammar.set(mainPosField, {
        deps: [],
        compute: () => 0,
      } satisfies FieldRule<number>);
    } else {
      const priorMainSizes = priorSiblings.map((s) => field<number>(s, mainSizeName));
      grammar.set(mainPosField, {
        deps: priorMainSizes as Field<unknown>[],
        compute: (read) => {
          let sum = 0;
          for (const m of priorMainSizes) sum += read(m);
          return sum;
        },
      } satisfies FieldRule<number>);
    }

    // Cross-axis position: 0 in this slice (no alignment, no wrap).
    grammar.set(crossPosField, {
      deps: [],
      compute: () => 0,
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
  siblings: readonly { basis: number; grow: number; shrink: number }[],
  budget: number,
): number[] {
  let totalBasis = 0;
  let totalGrow = 0;
  let totalShrinkScaled = 0;
  for (const s of siblings) {
    totalBasis += s.basis;
    if (s.grow > 0) totalGrow += s.grow;
    if (s.shrink > 0) totalShrinkScaled += s.shrink * s.basis;
  }
  const leftover = budget - totalBasis;
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
