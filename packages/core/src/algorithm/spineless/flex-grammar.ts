/**
 * Flexbox layout expressed as an attribute grammar.
 *
 * Current slice (v2) covers:
 *
 *   - flex-direction: `row` and `column` (parent's direction governs how
 *     its children stack along the main axis)
 *   - Explicit `width` and `height` on every node
 *   - No flex grow, no flex shrink
 *   - No margin, no padding, no gap
 *   - No flex-wrap, no alignment (cross-axis offset is always 0)
 *   - No absolute positioning
 *   - `row-reverse` and `column-reverse` rejected at build time — they
 *     require the main-axis accumulator to walk in the opposite
 *     direction, which is a separate slice.
 *
 * Subsequent PRs expand the feature set (flex grow, margin, padding,
 * wrap, alignment, abs positioning, direction-reverse) one chunk at a
 * time, each gated by a differential test that asserts the grammar
 * produces byte-identical output to the imperative algorithm.
 *
 * Fields emitted per node:
 *
 *   - `width`   — read from `node.style.width` (must be explicit number)
 *   - `height`  — read from `node.style.height` (must be explicit number)
 *   - `left`    — position relative to parent. 0 for root and for any
 *                 child whose parent is `column` (cross-axis). For
 *                 children of a `row` parent: sum of prior siblings'
 *                 widths.
 *   - `top`     — symmetric to `left`: 0 for root and for any child
 *                 whose parent is `row`. For children of a `column`
 *                 parent: sum of prior siblings' heights.
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
 * — those cases need flex grow/shrink semantics which this slice does
 * not yet support.
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

    // Validate that this slice's preconditions are met.
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

    // width / height rules: just read style.
    grammar.set(width as Field<unknown>, {
      deps: [],
      compute: () => styleW,
    } satisfies FieldRule<number>);
    grammar.set(height as Field<unknown>, {
      deps: [],
      compute: () => styleH,
    } satisfies FieldRule<number>);

    // Main-axis offset = sum of prior siblings' main-axis sizes (or 0
    // for root / first child). Cross-axis offset is always 0 in this
    // slice (no alignment, no wrap). The parent's direction decides
    // which of {left, top} is main vs cross — root is parent-less and
    // uses 0 for both.
    const parentDirection = parent === null ? null : parent.style.flexDirection;
    const mainAxisField =
      parentDirection === 'column' ? (top as Field<unknown>) : (left as Field<unknown>);
    const crossAxisField =
      parentDirection === 'column' ? (left as Field<unknown>) : (top as Field<unknown>);
    const mainAxisSizeName: 'width' | 'height' = parentDirection === 'column' ? 'height' : 'width';

    if (parent === null || indexInParent === 0) {
      grammar.set(mainAxisField, {
        deps: [],
        compute: () => 0,
      } satisfies FieldRule<number>);
    } else {
      // Sparse-and-explicit DAG: depend on every prior sibling's
      // main-axis size. The Spineless runtime relies on this shape;
      // equivalent to "last sibling's main offset + last sibling's
      // main size" but reasons more cleanly under incremental updates.
      const priorMainSizes = priorSiblings.map((s) => field<number>(s, mainAxisSizeName));
      grammar.set(mainAxisField, {
        deps: priorMainSizes as Field<unknown>[],
        compute: (read) => {
          let sum = 0;
          for (const m of priorMainSizes) sum += read(m);
          return sum;
        },
      } satisfies FieldRule<number>);
    }

    grammar.set(crossAxisField, {
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
