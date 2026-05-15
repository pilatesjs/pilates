/**
 * Tests for `buildAppendFragment` — phase-5c slice 2. Validates that
 * appending a child is a pure simple-regime graft and produces the
 * `SpinelessRuntime.graft` inputs; returns `null` when a rebuild is
 * required instead.
 */

import { describe, expect, it } from 'vitest';
import { Edge } from '../../edge.js';
import { Node } from '../../node.js';
import { buildAppendFragment, buildFlexGrammar } from './flex-grammar.js';
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

describe('buildAppendFragment — simple-regime appends graft cleanly', () => {
  it('appends to a simple row', () => {
    const root = Node.create();
    root.setWidth(150);
    root.setHeight(30);
    root.setFlexDirection('row');
    root.insertChild(fixedCell(20, 20), 0);
    root.insertChild(fixedCell(20, 20), 1);
    const { rt, prev } = makeRuntime(root);

    const c3 = fixedCell(25, 20);
    root.insertChild(c3, 2);
    const frag = buildAppendFragment(prev, root, root, c3);
    expect(frag).not.toBeNull();
    rt.graft(frag!.additions, frag!.newRoots);

    expect(readLayout(rt, frag!.next.allFields)).toEqual(freshLayout(root));
  });

  it('appends to a simple column', () => {
    const root = Node.create();
    root.setWidth(30);
    root.setHeight(150);
    root.setFlexDirection('column');
    root.insertChild(fixedCell(20, 15), 0);
    root.insertChild(fixedCell(20, 15), 1);
    const { rt, prev } = makeRuntime(root);

    const c3 = fixedCell(20, 18);
    root.insertChild(c3, 2);
    const frag = buildAppendFragment(prev, root, root, c3);
    expect(frag).not.toBeNull();
    rt.graft(frag!.additions, frag!.newRoots);

    expect(readLayout(rt, frag!.next.allFields)).toEqual(freshLayout(root));
  });

  it('appends to a nested simple parent', () => {
    const root = Node.create();
    root.setWidth(120);
    root.setHeight(60);
    root.setFlexDirection('column');
    const row = Node.create();
    row.setWidth(120);
    row.setHeight(30);
    row.setFlexDirection('row');
    root.insertChild(row, 0);
    row.insertChild(fixedCell(20, 20), 0);
    row.insertChild(fixedCell(20, 20), 1);
    const { rt, prev } = makeRuntime(root);

    const c3 = fixedCell(15, 20);
    row.insertChild(c3, 2);
    const frag = buildAppendFragment(prev, root, row, c3);
    expect(frag).not.toBeNull();
    rt.graft(frag!.additions, frag!.newRoots);

    expect(readLayout(rt, frag!.next.allFields)).toEqual(freshLayout(root));
  });

  it('appends an absolute child even into a flex-distributing parent', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(40);
    root.setFlexDirection('row');
    const grown = fixedCell(20, 20);
    grown.setFlexGrow(1);
    root.insertChild(grown, 0);
    const { rt, prev } = makeRuntime(root);

    // The parent flex-distributes, but an absolute child is filtered
    // out of every in-flow computation — so the append is additive.
    const abs = fixedCell(15, 10);
    abs.setPositionType('absolute');
    abs.setPosition(Edge.Left, 0);
    root.insertChild(abs, 1);
    const frag = buildAppendFragment(prev, root, root, abs);
    expect(frag).not.toBeNull();
    rt.graft(frag!.additions, frag!.newRoots);

    expect(readLayout(rt, frag!.next.allFields)).toEqual(freshLayout(root));
  });

  it('supports a run of successive appends', () => {
    const root = Node.create();
    root.setWidth(300);
    root.setHeight(30);
    root.setFlexDirection('row');
    root.insertChild(fixedCell(20, 20), 0);
    let { rt, prev } = makeRuntime(root);

    for (let i = 1; i <= 4; i++) {
      const c = fixedCell(15 + i, 20);
      root.insertChild(c, i);
      const frag = buildAppendFragment(prev, root, root, c);
      expect(frag).not.toBeNull();
      rt.graft(frag!.additions, frag!.newRoots);
      prev = frag!.next;
    }

    expect(readLayout(rt, prev.allFields)).toEqual(freshLayout(root));
  });
});

describe('buildAppendFragment — returns null when a rebuild is required', () => {
  function setup(configure: (root: Node) => Node): {
    prev: ReturnType<typeof buildFlexGrammar>;
    root: Node;
    appended: Node;
  } {
    const root = Node.create();
    root.setWidth(150);
    root.setHeight(30);
    root.setFlexDirection('row');
    root.insertChild(fixedCell(20, 20), 0);
    const prev = buildFlexGrammar(root);
    const appended = configure(root);
    return { prev, root, appended };
  }

  it('null when the parent flex-distributes', () => {
    const { prev, root, appended } = setup((r) => {
      const c = fixedCell(20, 20);
      c.setFlexGrow(1);
      r.insertChild(c, 1);
      return c;
    });
    expect(buildAppendFragment(prev, root, root, appended)).toBeNull();
  });

  it('null when the parent uses non-default justify-content', () => {
    const { prev, root, appended } = setup((r) => {
      r.setJustifyContent('space-between');
      const c = fixedCell(20, 20);
      r.insertChild(c, 1);
      return c;
    });
    expect(buildAppendFragment(prev, root, root, appended)).toBeNull();
  });

  it('null when the parent wraps', () => {
    const { prev, root, appended } = setup((r) => {
      r.setFlexWrap('wrap');
      const c = fixedCell(20, 20);
      r.insertChild(c, 1);
      return c;
    });
    expect(buildAppendFragment(prev, root, root, appended)).toBeNull();
  });

  it('null when the child is not the last child', () => {
    const { prev, root, appended } = setup((r) => {
      const c = fixedCell(20, 20);
      r.insertChild(c, 0); // inserted before the existing child
      return c;
    });
    expect(buildAppendFragment(prev, root, root, appended)).toBeNull();
  });
});
