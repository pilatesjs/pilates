/**
 * Flexbox layout expressed as an attribute grammar.
 *
 * Current slice (v3) covers:
 *
 *   - flex-direction: `row` and `column` (parent's direction governs how
 *     its children stack along the main axis)
 *   - Explicit `width` and `height` on every node (the basis values)
 *   - flex-grow: positive values redistribute leftover main-axis space
 *     proportionally to grow weights. No clamping is performed, so the
 *     freeze loop reduces to a single pass.
 *   - flex-shrink and flex-basis (the separate property): not yet
 *     supported. With Pilates's default `flexShrink: 0`, overflowing
 *     containers leave child sizes alone, matching the imperative
 *     algorithm exactly when no child sets shrink > 0.
 *   - No margin, no padding, no gap
 *   - No flex-wrap, no alignment (cross-axis offset is always 0)
 *   - No absolute positioning
 *   - `row-reverse` and `column-reverse` rejected at build time — they
 *     require the main-axis accumulator to walk in the opposite
 *     direction, which is a separate slice.
 *
 * Subsequent PRs expand the feature set (flex-shrink, flex-basis,
 * margin/padding/gap, alignment, wrap, abs positioning, reverse
 * directions) one chunk at a time, each gated by a differential test
 * that asserts the grammar produces byte-identical output to the
 * imperative algorithm.
 *
 * Fields emitted per node:
 *
 *   - `width`  — main-axis size when parent is `row`, cross-axis size
 *                when parent is `column`. Cross axis reads
 *                `style.width` verbatim. Main axis is the flex-grow
 *                redistribution when any sibling has grow > 0,
 *                otherwise `style.width`.
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
 * numeric values. Throws if any node has them as `'auto'` or `undefined`
 * — those cases need flex-basis / measure-func semantics which this
 * slice does not yet support.
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
    const mainSizeStyle = parentDirection === 'column' ? styleH : styleW;
    const crossSizeStyle = parentDirection === 'column' ? styleW : styleH;
    const mainSizeName: 'width' | 'height' = parentDirection === 'column' ? 'height' : 'width';

    // Cross-axis size: always reads style in this slice (no stretch).
    grammar.set(crossSizeField, {
      deps: [],
      compute: () => crossSizeStyle,
    } satisfies FieldRule<number>);

    // Main-axis size: depends on whether the parent flex-distributes
    // its children. A parent flex-distributes when ANY of its children
    // has flexGrow > 0; in that case every sibling's main size is
    // potentially altered. Otherwise the main size is the unaltered
    // style basis (v1/v2 behaviour).
    if (parent === null || !parentHasFlexGrow(parent)) {
      grammar.set(mainSizeField, {
        deps: [],
        compute: () => mainSizeStyle,
      } satisfies FieldRule<number>);
    } else {
      // Flex-grow redistribution. Capture every sibling's basis & grow
      // inline (they're constants per the v3 precondition that all
      // sizes are explicit numbers), look up our own index within
      // siblings, and compute the post-grow size from the parent's
      // main-axis size.
      const siblings: { basis: number; grow: number }[] = [];
      let myIndex = -1;
      for (let i = 0; i < parent.getChildCount(); i++) {
        const sib = parent.getChild(i)!;
        const sibStyle = sib.style;
        if (sib === node) myIndex = siblings.length;
        const sibBasis = parentDirection === 'column' ? sibStyle.height : sibStyle.width;
        // The outer visit() over each child re-validates basis numerics,
        // but we may not have reached every sibling yet — re-check here.
        if (typeof sibBasis !== 'number') {
          throw new Error(
            `[flex-grammar] flex sibling requires explicit numeric ${mainSizeName}; got ${JSON.stringify(sibBasis)}`,
          );
        }
        siblings.push({ basis: sibBasis, grow: sibStyle.flexGrow });
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

/** True iff at least one of `parent`'s children has `flexGrow > 0`. */
function parentHasFlexGrow(parent: Node): boolean {
  const count = parent.getChildCount();
  for (let i = 0; i < count; i++) {
    if (parent.getChild(i)!.style.flexGrow > 0) return true;
  }
  return false;
}

/**
 * Distribute `budget` across siblings using CSS flex-grow semantics
 * (without min/max clamping). Returns each sibling's final main-axis
 * size in input order.
 *
 * Mirrors the imperative `distributeGrow` in `main-axis.ts`: when there
 * is leftover space (budget > sum of bases), each grow-positive sibling
 * receives a share proportional to its `flexGrow` weight. Without
 * clamping the CSS freeze loop terminates in one iteration, so we
 * fold it down to a single pass.
 *
 * @internal
 */
function distributeMainAxis(
  siblings: readonly { basis: number; grow: number }[],
  budget: number,
): number[] {
  let totalBasis = 0;
  let totalGrow = 0;
  for (const s of siblings) {
    totalBasis += s.basis;
    if (s.grow > 0) totalGrow += s.grow;
  }
  const leftover = budget - totalBasis;
  if (leftover <= 0 || totalGrow <= 0) {
    return siblings.map((s) => s.basis);
  }
  return siblings.map((s) => (s.grow > 0 ? s.basis + (leftover * s.grow) / totalGrow : s.basis));
}
