/**
 * `markStyleDirty` — convenience for driving a precise incremental
 * relayout after a style mutation.
 *
 * Every numeric style prop the flex grammar reads is modelled as a
 * leaf input `Field` (see `buildFlexGrammar` / `StyleInputs`). After
 * a `Node` setter call, the runtime needs the matching input Field
 * marked dirty before `recompute()`. Looking that Field up through
 * the `styleInputs` map by hand is repetitive and easy to get wrong;
 * `createStyleDirtier` binds a runtime + its `styleInputs` into a
 * single `(node, prop[, edge])` call that mirrors the `Node`
 * setters:
 *
 * ```ts
 * const { grammar, rootFields, styleInputs } = buildFlexGrammar(root);
 * const rt = new SpinelessRuntime(grammar, [...rootFields...]);
 * rt.init();
 * const markStyleDirty = createStyleDirtier(rt, styleInputs);
 *
 * node.setWidth(50);
 * markStyleDirty(node, 'width');
 * rt.recompute();
 * ```
 *
 * Value mutations only — a structural mutation (flex-direction,
 * flex-wrap on/off, the justify / align category, `positionType`, a
 * flex weight / `flexBasis` crossing the zero / numeric boundary)
 * reshapes the dependency graph and still needs a fresh
 * `buildFlexGrammar()`.
 *
 * @internal
 */

import type { Node } from '../../node.js';
import type { StyleInputs } from './flex-grammar.js';
import type { Field } from './grammar.js';
import type { SpinelessRuntime } from './runtime.js';

/** Style props addressed by a single input Field. */
export type ScalarStyleProp =
  | 'width'
  | 'height'
  | 'flexBasis'
  | 'flexGrow'
  | 'flexShrink'
  | 'gapRow'
  | 'gapColumn'
  | 'minWidth'
  | 'minHeight'
  | 'maxWidth'
  | 'maxHeight';

/** Style props addressed per `[top, right, bottom, left]` edge. */
export type EdgeStyleProp = 'padding' | 'margin';

/**
 * A bound `(node, prop[, edge])` callback that marks the input
 * Field(s) for a mutated style prop dirty on its runtime.
 *
 * @internal
 */
export interface StyleDirtier {
  (node: Node, prop: ScalarStyleProp): void;
  (node: Node, prop: EdgeStyleProp, edge: number): void;
}

/**
 * Bind a `SpinelessRuntime` and the `styleInputs` map from the
 * `buildFlexGrammar` output that produced its grammar into a
 * `StyleDirtier`.
 *
 * The returned callback throws if `node` is not part of the
 * grammar's `styleInputs` (a node from a different / stale build),
 * or if an edge prop is called without an edge index. It is a no-op
 * when the grammar emits no input Field for the `(node, prop)` —
 * which happens precisely when that prop can't affect layout (e.g.
 * `padding` on a childless leaf), so marking nothing is correct.
 *
 * @internal
 */
export function createStyleDirtier(
  runtime: SpinelessRuntime,
  styleInputs: ReadonlyMap<Node, StyleInputs>,
): StyleDirtier {
  return (node: Node, prop: ScalarStyleProp | EdgeStyleProp, edge?: number): void => {
    const entry = styleInputs.get(node);
    if (entry === undefined) {
      throw new Error(
        '[spineless] markStyleDirty: node has no style inputs in this grammar — pass a node from the same buildFlexGrammar() tree',
      );
    }

    let f: Field<number> | undefined;
    if (prop === 'padding' || prop === 'margin') {
      if (edge === undefined) {
        throw new Error(`[spineless] markStyleDirty: '${prop}' requires an edge index`);
      }
      f = entry[prop]?.[edge];
    } else {
      f = entry[prop];
    }

    // Marking nothing is the correct, precise behaviour when the
    // mutation cannot move any layout field. That is the case both
    // when no input Field exists for the prop, and when one exists
    // but has been orphaned by a `detach` — e.g. the previous last
    // child's main-end margin after its follower was removed. An
    // orphaned input is no longer tracked by the runtime; a stale
    // reference to it may linger in a `styleInputs` map.
    if (f !== undefined && runtime.isTracked(f as Field<unknown>)) {
      runtime.markDirty(f as Field<unknown>);
    }
  };
}
