/**
 * `SpinelessLayout` — drives the Spineless incremental layout engine
 * as a `calculateLayout`-equivalent (phase 8).
 *
 * The grammar (`buildFlexGrammar`) + runtime (`SpinelessRuntime`)
 * compute each node's `{width, height, left, top}` in floating-point
 * space; this driver writes those into `node._layout`, then runs the
 * shared integer-cell rounding (`roundLayout`) and scroll-extent
 * pass — mirroring the tail of the imperative `calculateLayoutImpl`.
 *
 * v19 is single-shot: every `layout()` call rebuilds the grammar and
 * a fresh runtime. Persistence and incremental relayout
 * (`markStyleDirty` + `recompute`, `graft` / `detach`) are
 * subsequent slices.
 *
 * @internal
 */

import type { Node } from '../../node.js';
import { roundLayout } from '../round.js';
import { type AvailableSize, buildFlexGrammar } from './flex-grammar.js';
import type { Field } from './grammar.js';
import { SpinelessRuntime } from './runtime.js';

/**
 * A layout driver bound to one root `Node`. Call `layout()` to
 * produce a layout byte-equivalent to imperative `calculateLayout`.
 *
 * @internal
 */
export class SpinelessLayout {
  private readonly root: Node;

  constructor(root: Node) {
    this.root = root;
  }

  /**
   * Lay the tree out. `availableWidth` / `availableHeight` size an
   * `'auto'` root, matching `calculateLayout`'s availability args.
   *
   * v19: a full build every call.
   */
  layout(availableWidth?: number, availableHeight?: number): void {
    const available: AvailableSize = {};
    if (availableWidth !== undefined) available.width = availableWidth;
    if (availableHeight !== undefined) available.height = availableHeight;

    const { grammar, allFields } = buildFlexGrammar(this.root, available);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) {
      rootFields.push(f.width, f.height, f.left, f.top);
    }
    const runtime = new SpinelessRuntime(grammar, rootFields);
    runtime.init();

    // Write each node's evaluated float layout into `_layout`. The
    // grammar emits positions relative to the parent, exactly as the
    // imperative algorithm does; `roundLayout` then turns the float
    // tree into integer cells.
    for (const f of allFields) {
      const node = f.node;
      const left = runtime.evaluate(f.left);
      const top = runtime.evaluate(f.top);
      node._layout.left = left;
      node._layout.top = top;
      node._layout.width = runtime.evaluate(f.width);
      node._layout.height = runtime.evaluate(f.height);
      node._floatLeft = left;
      node._floatTop = top;
    }

    roundLayout(this.root);
    recordScrollSizes(this.root);
    clearDirtyDeep(this.root);
  }
}

/**
 * Post-order walk recording each node's content bounding box on
 * `_layout.scrollWidth` / `scrollHeight`. Mirrors the scroll-extent
 * half of `calculateLayoutImpl`'s `computeScrollSizes` — without the
 * imperative layout-cache writes, which belong to the imperative
 * path only.
 */
function recordScrollSizes(node: Node): void {
  for (let i = 0; i < node.getChildCount(); i++) recordScrollSizes(node.getChild(i)!);
  let contentRight = 0;
  let contentBottom = 0;
  for (let i = 0; i < node.getChildCount(); i++) {
    const cl = node.getChild(i)!._layout;
    contentRight = Math.max(contentRight, cl.left + cl.width);
    contentBottom = Math.max(contentBottom, cl.top + cl.height);
  }
  node._layout.scrollWidth = Math.max(node._layout.width, contentRight);
  node._layout.scrollHeight = Math.max(node._layout.height, contentBottom);
}

function clearDirtyDeep(node: Node): void {
  node.clearDirty();
  for (let i = 0; i < node.getChildCount(); i++) clearDirtyDeep(node.getChild(i)!);
}
