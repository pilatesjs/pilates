/**
 * Tests for `buildRemoveFragment` — phase-5c slices 3 + 5. Validates
 * that removing a child produces the `SpinelessRuntime.detach` (and,
 * for non-simple regimes, `rebindRule`) inputs; returns `null` only
 * when a true rebuild is required.
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

// Apply a remove fragment: rebind the survivors whose rules changed
// FIRST (so they stop depending on the removed fields), then detach
// the removed subtree, then recompute.
function applyRemove(
  rt: SpinelessRuntime,
  frag: NonNullable<ReturnType<typeof buildRemoveFragment>>,
): void {
  for (const [f, rule] of frag.rebinds) rt.rebindRule(f, rule);
  rt.detach(frag.removed);
  rt.recompute();
}

describe('buildRemoveFragment — simple-regime removals', () => {
  it('removes the last child of a simple row', () => {
    const root = Node.create();
    root.setWidth(150);
    root.setHeight(30);
    root.setFlexDirection('row');
    const cells = [fixedCell(20, 20), fixedCell(25, 20), fixedCell(30, 20)];
    cells.forEach((c, i) => root.insertChild(c, i));
    const { rt, prev } = makeRuntime(root);

    const frag = buildRemoveFragment(prev, root, root, cells[2]!);
    expect(frag).not.toBeNull();
    expect(frag!.rebinds).toHaveLength(0);
    applyRemove(rt, frag!);
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

    const frag = buildRemoveFragment(prev, root, root, cells[2]!);
    expect(frag).not.toBeNull();
    applyRemove(rt, frag!);
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

    const frag = buildRemoveFragment(prev, root, row, cells[2]!);
    expect(frag).not.toBeNull();
    applyRemove(rt, frag!);
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

    const frag = buildRemoveFragment(prev, root, root, abs);
    expect(frag).not.toBeNull();
    expect(frag!.rebinds).toHaveLength(0);
    applyRemove(rt, frag!);
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

    const c3 = fixedCell(30, 20);
    root.insertChild(c3, 2);
    const appended = buildAppendFragment(prev, root, root, c3)!;
    rt.graft(appended.additions, appended.newRoots);

    const removed = buildRemoveFragment(appended.next, root, root, c3)!;
    applyRemove(rt, removed);
    root.removeChild(c3);

    expect(readLayout(rt, removed.next.allFields)).toEqual(before);
    expect(readLayout(rt, removed.next.allFields)).toEqual(freshLayout(root));
  });
});

describe('buildRemoveFragment — regime-aware removals rebind survivors', () => {
  it('removes the last child of a flex-distributing row', () => {
    const root = Node.create();
    root.setWidth(200);
    root.setHeight(30);
    root.setFlexDirection('row');
    const cells: Node[] = [];
    for (let i = 0; i < 3; i++) {
      const c = fixedCell(20, 20);
      c.setFlexGrow(1);
      root.insertChild(c, i);
      cells.push(c);
    }
    const { rt, prev } = makeRuntime(root);

    const frag = buildRemoveFragment(prev, root, root, cells[2]!);
    expect(frag).not.toBeNull();
    expect(frag!.rebinds.length).toBeGreaterThan(0);
    applyRemove(rt, frag!);
    root.removeChild(cells[2]!);

    expect(readLayout(rt, frag!.next.allFields)).toEqual(freshLayout(root));
  });

  it('removes a child from a space-between justified row', () => {
    const root = Node.create();
    root.setWidth(200);
    root.setHeight(30);
    root.setFlexDirection('row');
    root.setJustifyContent('space-between');
    const cells = [fixedCell(20, 20), fixedCell(20, 20), fixedCell(25, 20)];
    cells.forEach((c, i) => root.insertChild(c, i));
    const { rt, prev } = makeRuntime(root);

    const frag = buildRemoveFragment(prev, root, root, cells[2]!);
    expect(frag).not.toBeNull();
    applyRemove(rt, frag!);
    root.removeChild(cells[2]!);

    expect(readLayout(rt, frag!.next.allFields)).toEqual(freshLayout(root));
  });

  it('removes a child from a wrapping container', () => {
    const root = Node.create();
    root.setWidth(70);
    root.setHeight(120);
    root.setFlexDirection('row');
    root.setFlexWrap('wrap');
    const cells: Node[] = [];
    for (let i = 0; i < 4; i++) {
      const c = fixedCell(30, 20);
      root.insertChild(c, i);
      cells.push(c);
    }
    const { rt, prev } = makeRuntime(root);

    const frag = buildRemoveFragment(prev, root, root, cells[3]!);
    expect(frag).not.toBeNull();
    applyRemove(rt, frag!);
    root.removeChild(cells[3]!);

    expect(readLayout(rt, frag!.next.allFields)).toEqual(freshLayout(root));
  });

  it('removes an interior child of a simple row (later siblings shift)', () => {
    const root = Node.create();
    root.setWidth(150);
    root.setHeight(30);
    root.setFlexDirection('row');
    const cells = [fixedCell(20, 20), fixedCell(25, 20), fixedCell(30, 20)];
    cells.forEach((c, i) => root.insertChild(c, i));
    const { rt, prev } = makeRuntime(root);

    // Removing the middle cell shifts the third — a rebind case even
    // though the parent's regime is "simple".
    const frag = buildRemoveFragment(prev, root, root, cells[1]!);
    expect(frag).not.toBeNull();
    expect(frag!.rebinds.length).toBeGreaterThan(0);
    applyRemove(rt, frag!);
    root.removeChild(cells[1]!);

    expect(readLayout(rt, frag!.next.allFields)).toEqual(freshLayout(root));
  });

  it('stays correct under a later style mutation after a flex removal', () => {
    const root = Node.create();
    root.setWidth(200);
    root.setHeight(30);
    root.setFlexDirection('row');
    const cells: Node[] = [];
    for (let i = 0; i < 3; i++) {
      const c = fixedCell(20, 20);
      c.setFlexGrow(1);
      root.insertChild(c, i);
      cells.push(c);
    }
    const { rt, prev } = makeRuntime(root);

    const frag = buildRemoveFragment(prev, root, root, cells[2]!)!;
    applyRemove(rt, frag);
    root.removeChild(cells[2]!);

    // Mutate a surviving sibling — the rebound rules must still
    // recompute to a fresh-build-identical layout.
    cells[0]!.setWidth(45);
    rt.markDirty(frag.next.styleInputs.get(cells[0]!)!.width!);
    rt.recompute();

    expect(readLayout(rt, frag.next.allFields)).toEqual(freshLayout(root));
  });
});

describe('buildRemoveFragment — returns null when a rebuild is required', () => {
  it('null when the node is not a child of the parent', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(30);
    root.setFlexDirection('row');
    root.insertChild(fixedCell(20, 20), 0);
    const prev = buildFlexGrammar(root);
    const stranger = fixedCell(20, 20);
    expect(buildRemoveFragment(prev, root, root, stranger)).toBeNull();
  });
});
