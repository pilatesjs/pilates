/**
 * Tests for `SpinelessRuntime.graft` — phase-5c additive field
 * insertion.
 *
 * Two layers:
 * - hand-built grammars, to exercise the primitive directly (graft a
 *   field, graft a chain, the new → existing reverse-dependency
 *   edge, the defensive throws);
 * - a realistic path — build a tree + grammar + runtime, append a
 *   child to a simple-regime parent, diff the rebuilt grammar for the
 *   additions, `graft`, and assert the layout is byte-identical to a
 *   fresh runtime over the rebuilt grammar.
 */

import { describe, expect, it } from 'vitest';
import { Node } from '../../node.js';
import { buildFlexGrammar } from './flex-grammar.js';
import { type Field, type Grammar, field } from './grammar.js';
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
  for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
  const rt = new SpinelessRuntime(grammar, rootFields);
  rt.init();
  return readLayout(rt, allFields);
}

describe('SpinelessRuntime.graft — primitive', () => {
  it('integrates a new field that reads an existing one', () => {
    const n = Node.create();
    const a = field<number>(n, 'a');
    const b = field<number>(n, 'b');
    const grammar: Grammar = new Map();
    grammar.set(a, { deps: [], compute: () => 10 });
    grammar.set(b, { deps: [a], compute: (read) => read(a) + 1 });

    const rt = new SpinelessRuntime(grammar, [b]);
    rt.init();
    expect(rt.evaluate(b)).toBe(11);

    // Graft `c`, which reads the existing `b`.
    const c = field<number>(n, 'c');
    const additions: Grammar = new Map();
    additions.set(c, { deps: [b], compute: (read) => read(b) * 2 });
    rt.graft(additions, [c]);

    expect(rt.evaluate(c)).toBe(22);
  });

  it('integrates a chain of new fields in one graft', () => {
    const n = Node.create();
    const a = field<number>(n, 'a');
    const grammar: Grammar = new Map();
    grammar.set(a, { deps: [], compute: () => 1 });
    const rt = new SpinelessRuntime(grammar, [a]);
    rt.init();

    // c -> b -> a, with b and c both new.
    const b = field<number>(n, 'b');
    const c = field<number>(n, 'c');
    const additions: Grammar = new Map();
    additions.set(b, { deps: [a], compute: (read) => read(a) + 10 });
    additions.set(c, { deps: [b], compute: (read) => read(b) + 100 });
    rt.graft(additions, [c]);

    expect(rt.evaluate(b)).toBe(11);
    expect(rt.evaluate(c)).toBe(111);
  });

  it('records the new → existing reverse-dep edge so later changes propagate', () => {
    const n = Node.create();
    let aVal = 10;
    const a = field<number>(n, 'a');
    const b = field<number>(n, 'b');
    const grammar: Grammar = new Map();
    grammar.set(a, { deps: [], compute: () => aVal });
    grammar.set(b, { deps: [a], compute: (read) => read(a) + 1 });
    const rt = new SpinelessRuntime(grammar, [b]);
    rt.init();

    const c = field<number>(n, 'c');
    const additions: Grammar = new Map();
    additions.set(c, { deps: [b], compute: (read) => read(b) * 2 });
    rt.graft(additions, [c]);
    expect(rt.evaluate(c)).toBe(22);

    // Mutate the existing input and recompute: the change must
    // ripple a -> b -> c, reaching the grafted field.
    aVal = 20;
    rt.markDirty(a);
    rt.recompute();
    expect(rt.evaluate(a)).toBe(20);
    expect(rt.evaluate(b)).toBe(21);
    expect(rt.evaluate(c)).toBe(42);
  });

  it('throws when grafting before init', () => {
    const n = Node.create();
    const a = field<number>(n, 'a');
    const grammar: Grammar = new Map();
    grammar.set(a, { deps: [], compute: () => 1 });
    const rt = new SpinelessRuntime(grammar, [a]);
    expect(() => rt.graft(new Map(), [])).toThrow(/before init/);
  });

  it('throws when grafting a field that already exists', () => {
    const n = Node.create();
    const a = field<number>(n, 'a');
    const grammar: Grammar = new Map();
    grammar.set(a, { deps: [], compute: () => 1 });
    const rt = new SpinelessRuntime(grammar, [a]);
    rt.init();

    const additions: Grammar = new Map();
    additions.set(a, { deps: [], compute: () => 99 });
    expect(() => rt.graft(additions, [a])).toThrow(/already exists/);
  });
});

describe('SpinelessRuntime.graft — appending a child', () => {
  // Diff the rebuilt grammar G2 against the runtime's grammar G1:
  // the entries G2 has and G1 lacks are exactly the new node's
  // fields (Field identity is stable across builds).
  function graftAppendedChild(rt: SpinelessRuntime, g1: Grammar, root: Node, appended: Node): void {
    const g2 = buildFlexGrammar(root);
    const additions: Grammar = new Map();
    for (const [f, rule] of g2.grammar) {
      if (!g1.has(f)) additions.set(f, rule);
    }
    const entry = g2.allFields.find((e) => e.node === appended)!;
    rt.graft(additions, [entry.width, entry.height, entry.left, entry.top]);
  }

  it('grafts a 3rd child appended to a simple-regime row', () => {
    const root = Node.create();
    root.setWidth(120);
    root.setHeight(30);
    root.setFlexDirection('row');
    for (let i = 0; i < 2; i++) {
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

    // Append a 3rd child and graft it — no recompute() needed.
    const c3 = Node.create();
    c3.setWidth(25);
    c3.setHeight(20);
    root.insertChild(c3, 2);
    graftAppendedChild(rt, grammar, root, c3);

    expect(readLayout(rt, buildFlexGrammar(root).allFields)).toEqual(freshLayout(root));
  });

  it('grafts a child appended to a simple-regime column', () => {
    const root = Node.create();
    root.setWidth(30);
    root.setHeight(120);
    root.setFlexDirection('column');
    for (let i = 0; i < 2; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(15);
      root.insertChild(c, i);
    }
    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    const c3 = Node.create();
    c3.setWidth(20);
    c3.setHeight(18);
    root.insertChild(c3, 2);
    graftAppendedChild(rt, grammar, root, c3);

    expect(readLayout(rt, buildFlexGrammar(root).allFields)).toEqual(freshLayout(root));
  });

  it('grafts a child appended to a nested simple-regime parent', () => {
    const root = Node.create();
    root.setWidth(120);
    root.setHeight(60);
    root.setFlexDirection('column');
    const rowA = Node.create();
    rowA.setWidth(120);
    rowA.setHeight(30);
    rowA.setFlexDirection('row');
    root.insertChild(rowA, 0);
    for (let i = 0; i < 2; i++) {
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      rowA.insertChild(c, i);
    }
    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    // Append a cell to the nested row.
    const c3 = Node.create();
    c3.setWidth(15);
    c3.setHeight(20);
    rowA.insertChild(c3, 2);
    graftAppendedChild(rt, grammar, root, c3);

    expect(readLayout(rt, buildFlexGrammar(root).allFields)).toEqual(freshLayout(root));
  });

  it('grafts the first child appended to a previously childless parent', () => {
    const root = Node.create();
    root.setWidth(60);
    root.setHeight(20);
    root.setFlexDirection('row');
    const { grammar, allFields } = buildFlexGrammar(root);
    const rootFields: Field<unknown>[] = [];
    for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
    const rt = new SpinelessRuntime(grammar, rootFields);
    rt.init();

    const c1 = Node.create();
    c1.setWidth(20);
    c1.setHeight(20);
    root.insertChild(c1, 0);
    graftAppendedChild(rt, grammar, root, c1);

    expect(readLayout(rt, buildFlexGrammar(root).allFields)).toEqual(freshLayout(root));
  });
});
