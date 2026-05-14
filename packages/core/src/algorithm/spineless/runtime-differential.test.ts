/**
 * Differential harness: SpinelessRuntime vs the imperative pipeline.
 *
 * The flex grammar (flex-grammar.ts) is already validated byte-
 * identically against the imperative algorithm in flex-grammar.test.ts
 * via the `TopoInterpreter`. This file does the same for the
 * incremental runtime — building a `SpinelessRuntime` for each
 * representative tree, evaluating, and asserting the layout matches
 * what `root.calculateLayout()` produces.
 *
 * If both the grammar and the runtime agree with the imperative on
 * the same corpus, then by transitivity any future Spineless runtime
 * mode that swaps for the imperative path inherits the imperative's
 * full test coverage.
 *
 * Scenarios are one-per-slice (v1 → v8). Adding a tree here is the
 * lightest possible way to widen the runtime's confidence envelope
 * as new grammar features land.
 */

import { describe, expect, it } from 'vitest';
import { Edge } from '../../edge.js';
import { Node } from '../../node.js';
import { buildFlexGrammar } from './flex-grammar.js';
import type { Field } from './grammar.js';
import { SpinelessRuntime } from './runtime.js';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Build the grammar for `root`, drive it with `SpinelessRuntime`,
 * then apply the same integer-cell rounding rule as `round.ts` so
 * the comparison against the imperative pipeline stays byte-
 * identical when fractional values arise (flex-grow ratios).
 *
 * Mirrors the helper in flex-grammar.test.ts, but reads field values
 * from the runtime rather than the topo interpreter.
 */
function evaluateViaRuntime(root: Node): Box[] {
  const { grammar, allFields } = buildFlexGrammar(root);
  const rootFields: Field<unknown>[] = [];
  for (const f of allFields) {
    rootFields.push(f.width, f.height, f.left, f.top);
  }
  const rt = new SpinelessRuntime(grammar, rootFields);
  rt.init();

  const floatByNode = new Map<Node, Box>();
  for (const f of allFields) {
    floatByNode.set(f.node, {
      left: rt.evaluate(f.left),
      top: rt.evaluate(f.top),
      width: rt.evaluate(f.width),
      height: rt.evaluate(f.height),
    });
  }

  const out: Box[] = [];
  function visit(
    node: Node,
    parentAbsX: number,
    parentAbsY: number,
    parentRoundedX: number,
    parentRoundedY: number,
  ): void {
    const f = floatByNode.get(node)!;
    const absX = parentAbsX + f.left;
    const absY = parentAbsY + f.top;
    const roundedX = Math.round(absX);
    const roundedY = Math.round(absY);
    const roundedR = Math.round(absX + f.width);
    const roundedB = Math.round(absY + f.height);
    out.push({
      left: roundedX - parentRoundedX,
      top: roundedY - parentRoundedY,
      width: Math.max(0, roundedR - roundedX),
      height: Math.max(0, roundedB - roundedY),
    });
    for (let i = 0; i < node.getChildCount(); i++) {
      visit(node.getChild(i)!, absX, absY, roundedX, roundedY);
    }
  }
  visit(root, 0, 0, 0, 0);
  return out;
}

function evaluateImperative(root: Node): Box[] {
  root.calculateLayout();
  const out: Box[] = [];
  function visit(n: Node): void {
    out.push({
      left: n.layout.left,
      top: n.layout.top,
      width: n.layout.width,
      height: n.layout.height,
    });
    for (let i = 0; i < n.getChildCount(); i++) visit(n.getChild(i)!);
  }
  visit(root);
  return out;
}

describe('SpinelessRuntime differential — one tree per flex slice', () => {
  it('v1 fixed-width row matches imperative', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(30);
    root.setFlexDirection('row');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(30);
      root.insertChild(c, i);
    }
    expect(evaluateViaRuntime(root)).toEqual(evaluateImperative(root));
  });

  it('v2 fixed column matches imperative', () => {
    const root = Node.create();
    root.setWidth(40);
    root.setHeight(100);
    root.setFlexDirection('column');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(40);
      c.setHeight(15);
      root.insertChild(c, i);
    }
    expect(evaluateViaRuntime(root)).toEqual(evaluateImperative(root));
  });

  it('v3 flex-grow distribution matches imperative', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(30);
    root.setFlexDirection('row');
    const a = Node.create();
    a.setWidth(10);
    a.setHeight(30);
    a.setFlexGrow(1);
    root.insertChild(a, 0);
    const b = Node.create();
    b.setWidth(10);
    b.setHeight(30);
    b.setFlexGrow(2);
    root.insertChild(b, 1);
    expect(evaluateViaRuntime(root)).toEqual(evaluateImperative(root));
  });

  it('v4 flex-shrink + flexBasis matches imperative', () => {
    const root = Node.create();
    root.setWidth(60);
    root.setHeight(30);
    root.setFlexDirection('row');
    const a = Node.create();
    a.setWidth(0);
    a.setHeight(30);
    a.setFlexBasis(50);
    a.setFlexShrink(1);
    root.insertChild(a, 0);
    const b = Node.create();
    b.setWidth(0);
    b.setHeight(30);
    b.setFlexBasis(30);
    b.setFlexShrink(1);
    root.insertChild(b, 1);
    expect(evaluateViaRuntime(root)).toEqual(evaluateImperative(root));
  });

  it('v5 padding + gap + margin matches imperative', () => {
    const root = Node.create();
    root.setWidth(120);
    root.setHeight(40);
    root.setFlexDirection('row');
    root.setPadding(Edge.Left, 6);
    root.setGap('column', 8);
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      c.setMargin(Edge.Top, 2);
      root.insertChild(c, i);
    }
    expect(evaluateViaRuntime(root)).toEqual(evaluateImperative(root));
  });

  it('v6 justify-content=center + align-items=flex-end matches imperative', () => {
    const root = Node.create();
    root.setWidth(120);
    root.setHeight(60);
    root.setFlexDirection('row');
    root.setJustifyContent('center');
    root.setAlignItems('flex-end');
    for (let i = 0; i < 2; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    expect(evaluateViaRuntime(root)).toEqual(evaluateImperative(root));
  });

  it('v7 flex-wrap matches imperative', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(80);
    root.setFlexDirection('row');
    root.setFlexWrap('wrap');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(60);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    expect(evaluateViaRuntime(root)).toEqual(evaluateImperative(root));
  });

  it('v8 absolute positioning matches imperative', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(60);
    root.setFlexDirection('row');
    const a = Node.create();
    a.setWidth(30);
    a.setHeight(60);
    root.insertChild(a, 0);
    const abs = Node.create();
    abs.setPositionType('absolute');
    abs.setWidth(20);
    abs.setHeight(15);
    abs.setPosition(Edge.Right, 6);
    abs.setPosition(Edge.Top, 4);
    root.insertChild(abs, 1);
    const b = Node.create();
    b.setWidth(30);
    b.setHeight(60);
    b.setFlexGrow(1);
    root.insertChild(b, 2);
    expect(evaluateViaRuntime(root)).toEqual(evaluateImperative(root));
  });

  it('nested tree (column-of-rows) matches imperative', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(60);
    root.setFlexDirection('column');
    for (let i = 0; i < 2; i++) {
      const innerRow = Node.create();
      innerRow.setWidth(100);
      innerRow.setHeight(30);
      innerRow.setFlexDirection('row');
      root.insertChild(innerRow, i);
      for (let j = 0; j < 2; j++) {
        const gc = Node.create();
        gc.setWidth(50);
        gc.setHeight(30);
        innerRow.insertChild(gc, j);
      }
    }
    expect(evaluateViaRuntime(root)).toEqual(evaluateImperative(root));
  });
});

describe('SpinelessRuntime — incremental recompute matches a fresh run', () => {
  it("recomputing after a manual cache poke arrives at the same answer as re-init'ing", () => {
    // This is the core "incremental == from-scratch" invariant. We
    // can't yet drive recompute via style-mutation (next slice), so
    // we exercise it by manually marking fields dirty after init and
    // verifying that recompute() produces an answer identical to
    // building a fresh runtime.
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(30);
    root.setFlexDirection('row');
    const a = Node.create();
    a.setWidth(10);
    a.setHeight(30);
    a.setFlexGrow(1);
    root.insertChild(a, 0);
    const b = Node.create();
    b.setWidth(10);
    b.setHeight(30);
    b.setFlexGrow(2);
    root.insertChild(b, 1);

    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) {
      rootFields.push(f.width, f.height, f.left, f.top);
    }

    // Drive (init + markDirty(*) + recompute) — semantically a no-op
    // since values are unchanged, but every dependent gets a chance
    // to re-run. Result should be identical to a fresh init.
    const incremental = new SpinelessRuntime(grammar, rootFields);
    incremental.init();
    for (const f of rootFields) incremental.markDirty(f);
    incremental.recompute();

    const fresh = new SpinelessRuntime(grammar, rootFields);
    fresh.init();

    for (const f of allFields) {
      expect(incremental.evaluate(f.width)).toBe(fresh.evaluate(f.width));
      expect(incremental.evaluate(f.height)).toBe(fresh.evaluate(f.height));
      expect(incremental.evaluate(f.left)).toBe(fresh.evaluate(f.left));
      expect(incremental.evaluate(f.top)).toBe(fresh.evaluate(f.top));
    }
  });
});
