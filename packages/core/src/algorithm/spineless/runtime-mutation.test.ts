/**
 * End-to-end style-mutation tests for SpinelessRuntime.
 *
 * The flex grammar's compute callbacks live-read `node.style` at
 * evaluate time (see the "live-read" / thunk notes inside
 * flex-grammar.ts), so mutating a style prop + calling `markDirty`
 * or `markAllDirty` + `recompute()` produces the same layout as
 * building a fresh runtime against the post-mutation state.
 *
 * Coverage is every NUMERIC style value within a fixed structural
 * regime: width / height / flexBasis, padding / margin / gap /
 * flex-grow / flex-shrink, and the per-sibling values feeding the
 * wrap line packer.
 *
 * The SIZE props (`width` / `height` / `flexBasis`), `gap` (`gapRow`
 * / `gapColumn`), `padding` (per-edge), and `margin` (per-edge) are
 * modelled as leaf input Fields exposed via
 * `buildFlexGrammar(...).styleInputs`. Every layout field that reads
 * one declares the matching input as a dependency, so a mutation can
 * be driven precisely — `markDirty` the input field(s) and
 * `recompute()`, no `markAllDirty`. flex-grow / flex-shrink are
 * still read live but undeclared; a mutation to those needs
 * `markAllDirty()` until their own input-field slice lands.
 *
 * What needs a fresh `buildFlexGrammar()` is STRUCTURAL mutation —
 * anything that reshapes the dependency graph: flex-direction,
 * flex-wrap on/off, the justify-content / align category,
 * positionType, and toggling a flex weight (or flexBasis) across the
 * zero / numeric boundary (which flips whether the parent
 * flex-distributes).
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
    // width; markDirty the ONE style input field for it; recompute.
    // The middle child's width updates, and the third child's left
    // shifts to butt-join (it depends on prior widths) — all via
    // declared-dep propagation, no markAllDirty.
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

    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    // Mutate the middle child's width.
    children[1]!.setWidth(35);
    rt.markDirty(styleInputs.get(children[1]!)!.width!);
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
    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    root.setHeight(140);
    rt.markDirty(styleInputs.get(root)!.height!);
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

    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    abs.setWidth(50);
    rt.markDirty(styleInputs.get(abs)!.width!);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('mutating align-end aligned child height shifts its cross-axis position', () => {
    // align-items=flex-end means the child's cross-pos is derived
    // from parent.height - childHeight - margin. crossSize and
    // crossPos both declare the child's `style:height` input as a
    // dep, so marking that ONE input dirty ripples to both.
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(60);
    root.setFlexDirection('row');
    root.setAlignItems('flex-end');
    const c = Node.create();
    c.setWidth(30);
    c.setHeight(20);
    root.insertChild(c, 0);

    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    c.setHeight(40);
    rt.markDirty(styleInputs.get(c)!.height!);
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

describe('SpinelessRuntime — precise size-input propagation', () => {
  // These exercise the style-input-field design: a size mutation is
  // driven by marking the ONE input Field dirty (never markAllDirty).
  // If a declared dep were missing, the result would not match a
  // fresh build.

  it('a flex-distributed sibling width mutation propagates via declared deps', () => {
    const root = Node.create();
    root.setWidth(150);
    root.setHeight(40);
    root.setFlexDirection('row');
    const children: Node[] = [];
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      c.setFlexGrow(1);
      root.insertChild(c, i);
      children.push(c);
    }
    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    // The first child's basis changes — every flex-distributed
    // sibling's main size must re-derive (their mainSize fields
    // declare each sibling's size inputs as deps).
    children[0]!.setWidth(60);
    rt.markDirty(styleInputs.get(children[0]!)!.width!);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('a wrapping-container child width mutation re-packs via declared deps', () => {
    const root = Node.create();
    root.setWidth(70);
    root.setHeight(80);
    root.setFlexDirection('row');
    root.setFlexWrap('wrap');
    const children: Node[] = [];
    for (let i = 0; i < 4; i++) {
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(20);
      root.insertChild(c, i);
      children.push(c);
    }
    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    children[0]!.setWidth(60);
    rt.markDirty(styleInputs.get(children[0]!)!.width!);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('a flexBasis mutation propagates via the flexBasis input field', () => {
    const root = Node.create();
    root.setWidth(150);
    root.setHeight(40);
    root.setFlexDirection('row');
    const children: Node[] = [];
    for (let i = 0; i < 2; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      c.setFlexBasis(40);
      c.setFlexGrow(1);
      root.insertChild(c, i);
      children.push(c);
    }
    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    // flexBasis stays numeric (50, not 'auto') — an in-regime value
    // change, so no rebuild is needed.
    children[0]!.setFlexBasis(50);
    rt.markDirty(styleInputs.get(children[0]!)!.flexBasis!);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });
});

describe('SpinelessRuntime — precise gap-input propagation', () => {
  // gap is modelled as a leaf input Field; mutating it is driven by
  // marking that ONE field dirty — never markAllDirty.

  it('a gap mutation re-spaces a flex-start row via declared deps', () => {
    const root = Node.create();
    root.setWidth(150);
    root.setHeight(40);
    root.setFlexDirection('row');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    // A row stacks items along the column axis → `gapColumn`.
    root.setGap('column', 14);
    rt.markDirty(styleInputs.get(root)!.gapColumn!);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('a gap mutation re-packs a wrapping container via declared deps', () => {
    const root = Node.create();
    root.setWidth(70);
    root.setHeight(120);
    root.setFlexDirection('row');
    root.setFlexWrap('wrap');
    for (let i = 0; i < 4; i++) {
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    // Cross-axis (line) gap — `gapRow` separates wrapped lines.
    root.setGap('row', 9);
    rt.markDirty(styleInputs.get(root)!.gapRow!);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('a gap mutation under non-default justify-content propagates precisely', () => {
    const root = Node.create();
    root.setWidth(200);
    root.setHeight(40);
    root.setFlexDirection('row');
    root.setJustifyContent('space-between');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    root.setGap('column', 10);
    rt.markDirty(styleInputs.get(root)!.gapColumn!);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });
});

describe('SpinelessRuntime — precise padding-input propagation', () => {
  // padding is modelled as per-edge leaf input Fields; mutating one
  // edge is driven by marking that single field dirty.

  it('a padding mutation re-flows a flex-start row via declared deps', () => {
    const root = Node.create();
    root.setWidth(150);
    root.setHeight(40);
    root.setFlexDirection('row');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    root.setPadding(Edge.Left, 12);
    root.setPadding(Edge.Top, 6);
    rt.markDirty(styleInputs.get(root)!.padding![Edge.Left]!);
    rt.markDirty(styleInputs.get(root)!.padding![Edge.Top]!);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('a padding mutation re-packs a wrapping container via declared deps', () => {
    const root = Node.create();
    root.setWidth(80);
    root.setHeight(120);
    root.setFlexDirection('row');
    root.setFlexWrap('wrap');
    for (let i = 0; i < 4; i++) {
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    root.setPadding(Edge.Left, 8);
    root.setPadding(Edge.Right, 8);
    rt.markDirty(styleInputs.get(root)!.padding![Edge.Left]!);
    rt.markDirty(styleInputs.get(root)!.padding![Edge.Right]!);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('a padding mutation under non-default justify-content propagates precisely', () => {
    const root = Node.create();
    root.setWidth(200);
    root.setHeight(40);
    root.setFlexDirection('row');
    root.setJustifyContent('space-between');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    root.setPadding(Edge.Left, 15);
    root.setPadding(Edge.Right, 9);
    rt.markDirty(styleInputs.get(root)!.padding![Edge.Left]!);
    rt.markDirty(styleInputs.get(root)!.padding![Edge.Right]!);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });
});

describe('SpinelessRuntime — precise margin-input propagation', () => {
  // margin is modelled as per-edge leaf input Fields; mutating an
  // edge is driven by marking that single field dirty.

  it('a child margin mutation shifts it and its successors via declared deps', () => {
    const root = Node.create();
    root.setWidth(150);
    root.setHeight(40);
    root.setFlexDirection('row');
    const children: Node[] = [];
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, i);
      children.push(c);
    }
    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    children[1]!.setMargin(Edge.Left, 8);
    children[1]!.setMargin(Edge.Right, 5);
    rt.markDirty(styleInputs.get(children[1]!)!.margin![Edge.Left]!);
    rt.markDirty(styleInputs.get(children[1]!)!.margin![Edge.Right]!);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('a child margin mutation re-packs a wrapping container via declared deps', () => {
    const root = Node.create();
    root.setWidth(80);
    root.setHeight(120);
    root.setFlexDirection('row');
    root.setFlexWrap('wrap');
    const children: Node[] = [];
    for (let i = 0; i < 4; i++) {
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(20);
      root.insertChild(c, i);
      children.push(c);
    }
    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    children[0]!.setMargin(Edge.Left, 6);
    children[0]!.setMargin(Edge.Top, 4);
    rt.markDirty(styleInputs.get(children[0]!)!.margin![Edge.Left]!);
    rt.markDirty(styleInputs.get(children[0]!)!.margin![Edge.Top]!);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('a child margin mutation under non-default justify-content propagates precisely', () => {
    const root = Node.create();
    root.setWidth(200);
    root.setHeight(40);
    root.setFlexDirection('row');
    root.setJustifyContent('space-between');
    const children: Node[] = [];
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, i);
      children.push(c);
    }
    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    children[1]!.setMargin(Edge.Left, 7);
    children[1]!.setMargin(Edge.Right, 11);
    rt.markDirty(styleInputs.get(children[1]!)!.margin![Edge.Left]!);
    rt.markDirty(styleInputs.get(children[1]!)!.margin![Edge.Right]!);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('an absolute child margin mutation propagates via the margin input fields', () => {
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
    const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    abs.setMargin(Edge.Left, 9);
    abs.setMargin(Edge.Top, 6);
    rt.markDirty(styleInputs.get(abs)!.margin![Edge.Left]!);
    rt.markDirty(styleInputs.get(abs)!.margin![Edge.Top]!);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });
});

describe('SpinelessRuntime — incremental layout under spacing / flex mutations', () => {
  it('mutating parent padding re-flows a row and matches a fresh build', () => {
    const root = Node.create();
    root.setWidth(120);
    root.setHeight(40);
    root.setFlexDirection('row');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    root.setPadding(Edge.Left, 9);
    root.setPadding(Edge.Top, 5);
    rt.markAllDirty();
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('mutating a child margin shifts it and its successors', () => {
    const root = Node.create();
    root.setWidth(120);
    root.setHeight(40);
    root.setFlexDirection('row');
    const children: Node[] = [];
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, i);
      children.push(c);
    }
    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    children[1]!.setMargin(Edge.Left, 7);
    children[1]!.setMargin(Edge.Right, 3);
    rt.markAllDirty();
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('mutating parent gap re-spaces a row and matches a fresh build', () => {
    const root = Node.create();
    root.setWidth(120);
    root.setHeight(40);
    root.setFlexDirection('row');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    root.setGap('column', 11);
    rt.markAllDirty();
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('mutating padding under a column direction matches a fresh build', () => {
    const root = Node.create();
    root.setWidth(40);
    root.setHeight(120);
    root.setFlexDirection('column');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    root.setPadding(Edge.Top, 8);
    root.setPadding(Edge.Left, 6);
    rt.markAllDirty();
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('mutating flex-grow re-distributes the main axis and matches a fresh build', () => {
    const root = Node.create();
    root.setWidth(120);
    root.setHeight(40);
    root.setFlexDirection('row');
    const children: Node[] = [];
    for (let i = 0; i < 2; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      c.setFlexGrow(1);
      root.insertChild(c, i);
      children.push(c);
    }
    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    // Still in the flex-distribution regime (a positive grow weight
    // exists before and after) — only the weighting shifts.
    children[0]!.setFlexGrow(3);
    rt.markAllDirty();
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('mutating flex-shrink re-distributes an overflowing row', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(40);
    root.setFlexDirection('row');
    const children: Node[] = [];
    for (let i = 0; i < 2; i++) {
      const c = Node.create();
      c.setWidth(80);
      c.setHeight(20);
      c.setFlexShrink(1);
      root.insertChild(c, i);
      children.push(c);
    }
    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    children[0]!.setFlexShrink(3);
    rt.markAllDirty();
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('mutating a child width re-packs a wrapping container', () => {
    const root = Node.create();
    root.setWidth(70);
    root.setHeight(80);
    root.setFlexDirection('row');
    root.setFlexWrap('wrap');
    const children: Node[] = [];
    for (let i = 0; i < 4; i++) {
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(20);
      root.insertChild(c, i);
      children.push(c);
    }
    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    // Widening the first child changes which items fit per line —
    // the wrap path re-packs from live sibling bases.
    children[0]!.setWidth(60);
    rt.markAllDirty();
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('mutating padding under non-default justify-content matches a fresh build', () => {
    const root = Node.create();
    root.setWidth(150);
    root.setHeight(40);
    root.setFlexDirection('row');
    root.setJustifyContent('space-between');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    root.setPadding(Edge.Left, 12);
    root.setPadding(Edge.Right, 8);
    rt.markAllDirty();
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('mutating an absolute child margin matches a fresh build', () => {
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

    abs.setMargin(Edge.Left, 6);
    abs.setMargin(Edge.Top, 3);
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
