/**
 * End-to-end style-mutation tests for SpinelessRuntime.
 *
 * The flex grammar's size compute callbacks now live-read
 * `node.style.{width|height|flexBasis}` at evaluate time (see the
 * "live-read" notes inside flex-grammar.ts), so mutating those props
 * + calling `markDirty` or `markAllDirty` + `recompute()` produces
 * the same layout as building a fresh runtime against the post-
 * mutation state.
 *
 * This slice covers width / height / flexBasis mutations only.
 * Padding, margin, gap, flex-grow, flex-shrink, flex-wrap, and
 * align-content are still inline-captured at build time; mutating
 * them needs a fresh `buildFlexGrammar()` + `SpinelessRuntime`. The
 * next slice extends the live-read to those props.
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

function readLayout(
  rt: SpinelessRuntime,
  allFields: ReadonlyArray<{
    node: Node;
    width: Field<number>;
    height: Field<number>;
    left: Field<number>;
    top: Field<number>;
  }>,
): Box[] {
  // Mirror the rounding rule that flex-grammar.test.ts and
  // runtime-differential.test.ts use, so byte-identical comparisons
  // against the imperative pipeline stay valid.
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
  const root = allFields[0]!.node;
  function visit(
    n: Node,
    parentAbsX: number,
    parentAbsY: number,
    parentRoundedX: number,
    parentRoundedY: number,
  ): void {
    const f = floatByNode.get(n)!;
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
    for (let i = 0; i < n.getChildCount(); i++) {
      visit(n.getChild(i)!, absX, absY, roundedX, roundedY);
    }
  }
  visit(root, 0, 0, 0, 0);
  return out;
}

function freshLayout(root: Node): Box[] {
  const { grammar, allFields } = buildFlexGrammar(root);
  const rootFields: Field<unknown>[] = [];
  for (const f of allFields) {
    rootFields.push(f.width, f.height, f.left, f.top);
  }
  const rt = new SpinelessRuntime(grammar, rootFields);
  rt.init();
  return readLayout(rt, allFields);
}

describe('SpinelessRuntime — incremental layout under size mutations', () => {
  it('mutating a row child width re-flows the row and matches a fresh build', () => {
    // Three fixed-width children in a row. Mutate the middle child's
    // width; markDirty on its width field; recompute. The middle
    // child's width updates, and the third child's left shifts to
    // butt-join (it depends on prior widths).
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(30);
    root.setFlexDirection('row');
    const children: Node[] = [];
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(30);
      root.insertChild(c, i);
      children.push(c);
    }

    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    // Mutate the middle child's width.
    children[1]!.setWidth(35);
    const widthField = allFields.find((f) => f.node === children[1])!.width;
    rt.markDirty(widthField);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('mutating the root height matches a fresh build under column direction', () => {
    const root = Node.create();
    root.setWidth(30);
    root.setHeight(100);
    root.setFlexDirection('column');
    for (let i = 0; i < 2; i++) {
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(15);
      root.insertChild(c, i);
    }
    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    root.setHeight(140);
    const rootHeightField = allFields[0]!.height;
    rt.markDirty(rootHeightField);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('mutating an absolute child width matches a fresh build', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(60);
    root.setFlexDirection('row');
    const abs = Node.create();
    abs.setPositionType('absolute');
    abs.setWidth(20);
    abs.setHeight(15);
    abs.setPosition(Edge.Top, 4);
    abs.setPosition(Edge.Left, 8);
    root.insertChild(abs, 0);

    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    abs.setWidth(50);
    const absWidthField = allFields.find((f) => f.node === abs)!.width;
    rt.markDirty(absWidthField);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('mutating align-end aligned child height shifts its cross-axis position', () => {
    // align-items=flex-end means the child's cross-pos is derived
    // from parent.height - childHeight - margin. The cross-pos
    // compute live-reads node.style.height, so a height mutation
    // should ripple through markDirty + recompute.
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(60);
    root.setFlexDirection('row');
    root.setAlignItems('flex-end');
    const c = Node.create();
    c.setWidth(30);
    c.setHeight(20);
    root.insertChild(c, 0);

    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    c.setHeight(40);
    const childHeightField = allFields.find((f) => f.node === c)!.height;
    const childTopField = allFields.find((f) => f.node === c)!.top;
    rt.markDirty(childHeightField);
    rt.markDirty(childTopField);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('markAllDirty is a correct (if coarse) escape hatch', () => {
    // Mutate multiple style props at once, call markAllDirty,
    // recompute. Each field re-runs once; propagation only follows
    // value changes. Final layout matches a fresh build.
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(30);
    root.setFlexDirection('row');
    const children: Node[] = [];
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(30);
      root.insertChild(c, i);
      children.push(c);
    }
    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    // Mutate every child's width.
    children[0]!.setWidth(40);
    children[1]!.setWidth(10);
    children[2]!.setWidth(25);
    rt.markAllDirty();
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('successive mutations remain incremental and correct', () => {
    // Mutate, recompute, read; mutate again, recompute, read.
    // The runtime cache should track each mutation correctly.
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(30);
    root.setFlexDirection('row');
    const a = Node.create();
    a.setWidth(20);
    a.setHeight(30);
    root.insertChild(a, 0);
    const b = Node.create();
    b.setWidth(20);
    b.setHeight(30);
    root.insertChild(b, 1);

    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    // First mutation.
    a.setWidth(50);
    rt.markAllDirty();
    rt.recompute();
    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));

    // Second mutation, different field.
    b.setWidth(15);
    rt.markAllDirty();
    rt.recompute();
    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));

    // Third mutation, restore original.
    a.setWidth(20);
    b.setWidth(20);
    rt.markAllDirty();
    rt.recompute();
    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });
});

describe('SpinelessRuntime — markAllDirty defensive', () => {
  it('throws if called before init', () => {
    const root = Node.create();
    root.setWidth(10);
    root.setHeight(10);
    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    expect(() => rt.markAllDirty()).toThrow(/before init/);
  });
});
