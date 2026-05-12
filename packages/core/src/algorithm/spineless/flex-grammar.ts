/**
 * Flexbox layout expressed as an attribute grammar.
 *
 * This is the first slice — covers the simplest possible flex case:
 *
 *   - flex-direction: row (only)
 *   - Explicit `width` and `height` on every node
 *   - No flex grow, no flex shrink
 *   - No margin, no padding, no gap
 *   - No flex-wrap, no alignment (children always start at top=0)
 *   - No absolute positioning
 *
 * Even this minimal case exercises the full type system: per-node
 * field allocation, dependency wiring across nodes, container-to-child
 * positioning. Subsequent PRs expand the feature set (flex grow, margin,
 * padding, wrap, alignment, abs positioning, multi-direction) one chunk
 * at a time, each gated by a differential test that asserts the grammar
 * produces byte-identical output to the imperative algorithm.
 *
 * Fields emitted per node:
 *
 *   - `width`   — read from `node.style.width` (must be explicit number)
 *   - `height`  — read from `node.style.height` (must be explicit number)
 *   - `left`    — position relative to parent. 0 for root; for non-root,
 *                 sum of prior siblings' widths.
 *   - `top`     — position relative to parent. 0 for root and all
 *                 non-root nodes in this slice (no wrap, no alignment).
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
        `[flex-grammar v1] node requires explicit numeric width; got ${JSON.stringify(styleW)}`,
      );
    }
    if (typeof styleH !== 'number') {
      throw new Error(
        `[flex-grammar v1] node requires explicit numeric height; got ${JSON.stringify(styleH)}`,
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

    // left rule
    if (parent === null) {
      // Root is anchored at 0.
      grammar.set(left as Field<unknown>, {
        deps: [],
        compute: () => 0,
      } satisfies FieldRule<number>);
    } else if (indexInParent === 0) {
      // First child sits at parent's content origin (left = 0 since
      // there's no padding in this slice).
      grammar.set(left as Field<unknown>, {
        deps: [],
        compute: () => 0,
      } satisfies FieldRule<number>);
    } else {
      // Non-first child: left = sum of prior siblings' widths.
      // (For row direction; column would use heights here.)
      const priorWidths = priorSiblings.map((s) => field<number>(s, 'width'));
      const priorLefts: Field<number>[] = [];
      if (indexInParent > 0) {
        // We only need the LAST sibling's left + width to compute ours,
        // not the full sum. But declaring the full chain keeps the
        // dependency DAG sparse-and-explicit, which is what Spineless
        // wants. Equivalent value, cleaner reasoning.
      }
      const deps: Field<number>[] = [...priorWidths, ...priorLefts];
      grammar.set(left as Field<unknown>, {
        deps: deps as Field<unknown>[],
        compute: (read) => {
          let sum = 0;
          for (const w of priorWidths) sum += read(w);
          return sum;
        },
      } satisfies FieldRule<number>);
    }

    // top rule: always 0 in this slice (no wrap, no alignment).
    grammar.set(top as Field<unknown>, {
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
