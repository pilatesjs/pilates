/**
 * Tests for `buildRemoveFragment` — phase-5c slice 3a. Validates
 * that removing a child is a pure simple-regime detach and produces
 * the `SpinelessRuntime.detach` inputs; returns `null` when a
 * rebuild is required instead.
 */

import { describe, expect, it } from 'vitest';
import { Edge } from '../../edge.js';
import { Node } from '../../node.js';
import { buildAppendFragment, buildFlexGrammar, buildRemoveFragment } from './flex-grammar.js';
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

function makeRuntime(root: Node): {
  rt: SpinelessRuntime;
  prev: ReturnType<typeof buildFlexGrammar>;
} {
  const prev = buildFlexGrammar(root);
  const rootFields: Field<unknown>[] = [];
  for (const f of prev.allFields) rootFields.push(f.width, f.height, f.left, f.top);
  const rt = new SpinelessRuntime(prev.grammar, rootFields);
  rt.init();
  return { rt, prev };
}

function fixedCell(w: number, h: number): Node {
  const c = Node.create();
  c.setWidth(w);
  c.setHeight(h);
  return c;
}

describe('buildRemoveFragment — simple-regime removals detach cleanly', () => {
  it('removes the last child of a simple row', () => {
    const root = Node.create();
    root.setWidth(150);
    root.setHeight(30);
    root.setFlexDirection('row');
    const cells = [fixedCell(20, 20), fixedCell(25, 20), fixedCell(30, 20)];
    cells.forEach((c, i) => root.insertChild(c, i));
    const { rt, prev } = makeRuntime(root);

    const frag = buildRemoveFragment(prev, root, cells[2]!);
    expect(frag).not.toBeNull();
    rt.detach(frag!.removed);
    root.removeChild(cells[2]!);

    expect(readLayout(rt, frag!.next.allFields)).toEqual(freshLayout(root));
  });

  it('removes the last child of a simple column', () => {
    const root = Node.create();
    root.setWidth(30);
    root.setHeight(150);
    root.setFlexDirection('column');
    const cells = [fixedCell(20, 15), fixedCell(20, 18), fixedCell(20, 12)];
    cells.forEach((c, i) => root.insertChild(c, i));
    const { rt, prev } = makeRuntime(root);

    const frag = buildRemoveFragment(prev, root, cells[2]!);
    expect(frag).not.toBeNull();
    rt.detach(frag!.removed);
    root.removeChild(cells[2]!);

    expect(readLayout(rt, frag!.next.allFields)).toEqual(freshLayout(root));
  });

  it('removes the last child of a nested simple parent', () => {
    const root = Node.create();
    root.setWidth(120);
    root.setHeight(60);
    root.setFlexDirection('column');
    const row = Node.create();
    row.setWidth(120);
    row.setHeight(30);
    row.setFlexDirection('row');
    root.insertChild(row, 0);
    const cells = [fixedCell(20, 20), fixedCell(20, 20), fixedCell(15, 20)];
    cells.forEach((c, i) => row.insertChild(c, i));
    const { rt, prev } = makeRuntime(root);

    const frag = buildRemoveFragment(prev, row, cells[2]!);
    expect(frag).not.toBeNull();
    rt.detach(frag!.removed);
    row.removeChild(cells[2]!);

    expect(readLayout(rt, frag!.next.allFields)).toEqual(freshLayout(root));
  });

  it('removes an absolute child from a flex-distributing parent', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(40);
    root.setFlexDirection('row');
    const grown = fixedCell(20, 20);
    grown.setFlexGrow(1);
    root.insertChild(grown, 0);
    const abs = fixedCell(15, 10);
    abs.setPositionType('absolute');
    abs.setPosition(Edge.Left, 0);
    root.insertChild(abs, 1);
    const { rt, prev } = makeRuntime(root);

    const frag = buildRemoveFragment(prev, root, abs);
    expect(frag).not.toBeNull();
    rt.detach(frag!.removed);
    root.removeChild(abs);

    expect(readLayout(rt, frag!.next.allFields)).toEqual(freshLayout(root));
  });

  it('round-trips: append a child then remove it', () => {
    const root = Node.create();
    root.setWidth(200);
    root.setHeight(30);
    root.setFlexDirection('row');
    root.insertChild(fixedCell(20, 20), 0);
    root.insertChild(fixedCell(25, 20), 1);
    const { rt, prev } = makeRuntime(root);
    const before = readLayout(rt, prev.allFields);

    // Append, graft.
    const c3 = fixedCell(30, 20);
    root.insertChild(c3, 2);
    const appended = buildAppendFragment(prev, root, root, c3)!;
    rt.graft(appended.additions, appended.newRoots);

    // Remove it again, detach.
    const removed = buildRemoveFragment(appended.next, root, c3)!;
    rt.detach(removed.removed);
    root.removeChild(c3);

    expect(readLayout(rt, removed.next.allFields)).toEqual(before);
    expect(readLayout(rt, removed.next.allFields)).toEqual(freshLayout(root));
  });
});

describe('buildRemoveFragment — returns null when a rebuild is required', () => {
  function setup(configure: (root: Node) => { parent: Node; child: Node }): {
    prev: ReturnType<typeof buildFlexGrammar>;
    parent: Node;
    child: Node;
  } {
    const root = Node.create();
    root.setWidth(150);
    root.setHeight(30);
    root.setFlexDirection('row');
    const { parent, child } = configure(root);
    const prev = buildFlexGrammar(root);
    return { prev, parent, child };
  }

  it('null when the parent flex-distributes', () => {
    const { prev, parent, child } = setup((r) => {
      const a = fixedCell(20, 20);
      const b = fixedCell(20, 20);
      b.setFlexGrow(1);
      r.insertChild(a, 0);
      r.insertChild(b, 1);
      return { parent: r, child: b };
    });
    expect(buildRemoveFragment(prev, parent, child)).toBeNull();
  });

  it('null when the parent uses non-default justify-content', () => {
    const { prev, parent, child } = setup((r) => {
      r.setJustifyContent('space-between');
      const a = fixedCell(20, 20);
      const b = fixedCell(20, 20);
      r.insertChild(a, 0);
      r.insertChild(b, 1);
      return { parent: r, child: b };
    });
    expect(buildRemoveFragment(prev, parent, child)).toBeNull();
  });

  it('null when the parent wraps', () => {
    const { prev, parent, child } = setup((r) => {
      r.setFlexWrap('wrap');
      const a = fixedCell(20, 20);
      const b = fixedCell(20, 20);
      r.insertChild(a, 0);
      r.insertChild(b, 1);
      return { parent: r, child: b };
    });
    expect(buildRemoveFragment(prev, parent, child)).toBeNull();
  });

  it('null when the child is not the last child', () => {
    const { prev, parent, child } = setup((r) => {
      const a = fixedCell(20, 20);
      const b = fixedCell(20, 20);
      r.insertChild(a, 0);
      r.insertChild(b, 1);
      return { parent: r, child: a }; // interior child
    });
    expect(buildRemoveFragment(prev, parent, child)).toBeNull();
  });
});
