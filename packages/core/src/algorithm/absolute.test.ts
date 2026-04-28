/**
 * M6: absolute positioning fixtures.
 */

import { describe, expect, it } from 'vitest';
import { Edge } from '../edge.js';
import type { ComputedLayout } from '../layout.js';
import { Node } from '../node.js';

function box(left: number, top: number, width: number, height: number): ComputedLayout {
  return { left, top, width, height };
}

function makeRoot(width: number, height: number): Node {
  const n = Node.create();
  n.setFlexDirection('row');
  n.setWidth(width);
  n.setHeight(height);
  return n;
}

describe('absolute positioning — anchored to a single edge', () => {
  it('top + left', () => {
    const root = makeRoot(40, 20);
    const child = Node.create();
    child.setPositionType('absolute');
    child.setPosition(Edge.Top, 2);
    child.setPosition(Edge.Left, 3);
    child.setWidth(10);
    child.setHeight(5);
    root.insertChild(child, 0);
    root.calculateLayout();

    expect(child.getComputedLayout()).toEqual(box(3, 2, 10, 5));
  });

  it('top + right anchors to right edge', () => {
    const root = makeRoot(40, 20);
    const child = Node.create();
    child.setPositionType('absolute');
    child.setPosition(Edge.Top, 1);
    child.setPosition(Edge.Right, 2);
    child.setWidth(10);
    child.setHeight(5);
    root.insertChild(child, 0);
    root.calculateLayout();

    // 40 - 10 - 2 = 28.
    expect(child.getComputedLayout()).toEqual(box(28, 1, 10, 5));
  });

  it('bottom + left anchors to bottom edge', () => {
    const root = makeRoot(40, 20);
    const child = Node.create();
    child.setPositionType('absolute');
    child.setPosition(Edge.Bottom, 0);
    child.setPosition(Edge.Left, 0);
    child.setWidth(10);
    child.setHeight(3);
    root.insertChild(child, 0);
    root.calculateLayout();

    // top = 20 - 3 - 0 = 17.
    expect(child.getComputedLayout()).toEqual(box(0, 17, 10, 3));
  });
});

describe('absolute positioning — sized from opposing edges', () => {
  it('left + right derive width', () => {
    const root = makeRoot(40, 20);
    const child = Node.create();
    child.setPositionType('absolute');
    child.setPosition(Edge.Top, 0);
    child.setPosition(Edge.Left, 5);
    child.setPosition(Edge.Right, 5);
    child.setHeight(10);
    root.insertChild(child, 0);
    root.calculateLayout();

    // width = 40 - 5 - 5 = 30.
    expect(child.getComputedLayout()).toEqual(box(5, 0, 30, 10));
  });

  it('top + bottom derive height', () => {
    const root = makeRoot(40, 20);
    const child = Node.create();
    child.setPositionType('absolute');
    child.setPosition(Edge.Top, 1);
    child.setPosition(Edge.Bottom, 2);
    child.setPosition(Edge.Left, 0);
    child.setWidth(10);
    root.insertChild(child, 0);
    root.calculateLayout();

    // height = 20 - 1 - 2 = 17.
    expect(child.getComputedLayout()).toEqual(box(0, 1, 10, 17));
  });

  it('all four edges set with no width/height fully constrains the box', () => {
    const root = makeRoot(40, 20);
    const child = Node.create();
    child.setPositionType('absolute');
    child.setPosition(Edge.All, 1);
    root.insertChild(child, 0);
    root.calculateLayout();

    expect(child.getComputedLayout()).toEqual(box(1, 1, 38, 18));
  });
});

describe('absolute positioning — out of flex flow', () => {
  it('does not consume main-axis space from flex siblings', () => {
    const root = makeRoot(60, 10);
    const flex = Node.create();
    flex.setFlex(1);
    const overlay = Node.create();
    overlay.setPositionType('absolute');
    overlay.setPosition(Edge.Top, 0);
    overlay.setPosition(Edge.Left, 0);
    overlay.setWidth(20);
    overlay.setHeight(5);
    root.insertChild(flex, 0);
    root.insertChild(overlay, 1);
    root.calculateLayout();

    // The flex sibling fills the entire row regardless of the overlay.
    expect(flex.getComputedLayout()).toEqual(box(0, 0, 60, 10));
    expect(overlay.getComputedLayout()).toEqual(box(0, 0, 20, 5));
  });

  it('a tree of only absolute children still lays them out', () => {
    const root = makeRoot(40, 20);
    const a = Node.create();
    a.setPositionType('absolute');
    a.setPosition(Edge.Top, 0);
    a.setPosition(Edge.Left, 0);
    a.setWidth(5);
    a.setHeight(5);
    const b = Node.create();
    b.setPositionType('absolute');
    b.setPosition(Edge.Bottom, 0);
    b.setPosition(Edge.Right, 0);
    b.setWidth(5);
    b.setHeight(5);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();

    expect(a.getComputedLayout()).toEqual(box(0, 0, 5, 5));
    expect(b.getComputedLayout()).toEqual(box(35, 15, 5, 5));
  });
});

describe('absolute positioning — with parent padding', () => {
  it('edges are relative to parent OUTER box (Yoga semantics)', () => {
    // Note: this is Yoga / React Native behavior. CSS would use the padding
    // (content) edge instead. We pick Yoga's choice so consumers porting
    // from Ink / RN see consistent results.
    const root = makeRoot(40, 20);
    root.setPadding(Edge.All, 2);
    const child = Node.create();
    child.setPositionType('absolute');
    child.setPosition(Edge.Top, 0);
    child.setPosition(Edge.Left, 0);
    child.setWidth(10);
    child.setHeight(5);
    root.insertChild(child, 0);
    root.calculateLayout();

    expect(child.getComputedLayout()).toEqual(box(0, 0, 10, 5));
  });

  it('left + right derives width from outer (parent padding ignored)', () => {
    const root = makeRoot(40, 20);
    root.setPadding(Edge.All, 2);
    const child = Node.create();
    child.setPositionType('absolute');
    child.setPosition(Edge.Top, 0);
    child.setPosition(Edge.Left, 0);
    child.setPosition(Edge.Right, 0);
    child.setHeight(5);
    root.insertChild(child, 0);
    root.calculateLayout();

    // outer width = 40, child fills it.
    expect(child.getComputedLayout()).toEqual(box(0, 0, 40, 5));
  });
});

describe('absolute positioning — margins', () => {
  it('left margin offsets the left anchor', () => {
    const root = makeRoot(40, 20);
    const child = Node.create();
    child.setPositionType('absolute');
    child.setPosition(Edge.Top, 0);
    child.setPosition(Edge.Left, 0);
    child.setMargin(Edge.Left, 3);
    child.setWidth(10);
    child.setHeight(5);
    root.insertChild(child, 0);
    root.calculateLayout();

    expect(child.getComputedLayout().left).toBe(3);
  });

  it('right margin offsets the right anchor', () => {
    const root = makeRoot(40, 20);
    const child = Node.create();
    child.setPositionType('absolute');
    child.setPosition(Edge.Top, 0);
    child.setPosition(Edge.Right, 0);
    child.setMargin(Edge.Right, 3);
    child.setWidth(10);
    child.setHeight(5);
    root.insertChild(child, 0);
    root.calculateLayout();

    // 40 - 10 - 3 = 27.
    expect(child.getComputedLayout().left).toBe(27);
  });
});

describe('absolute positioning — nested', () => {
  it('absolute child has its own subtree laid out', () => {
    const root = makeRoot(80, 24);
    const overlay = Node.create();
    overlay.setPositionType('absolute');
    overlay.setPosition(Edge.Top, 5);
    overlay.setPosition(Edge.Left, 10);
    overlay.setWidth(40);
    overlay.setHeight(10);
    overlay.setFlexDirection('row');

    const a = Node.create();
    a.setFlex(1);
    const b = Node.create();
    b.setFlex(1);
    overlay.insertChild(a, 0);
    overlay.insertChild(b, 1);
    root.insertChild(overlay, 0);

    root.calculateLayout();

    expect(overlay.getComputedLayout()).toEqual(box(10, 5, 40, 10));
    expect(a.getComputedLayout()).toEqual(box(0, 0, 20, 10));
    expect(b.getComputedLayout()).toEqual(box(20, 0, 20, 10));
  });
});

describe('absolute positioning — no edges set', () => {
  it('falls back to parent outer origin', () => {
    const root = makeRoot(40, 20);
    root.setPadding(Edge.All, 1);
    const child = Node.create();
    child.setPositionType('absolute');
    child.setWidth(10);
    child.setHeight(5);
    root.insertChild(child, 0);
    root.calculateLayout();

    expect(child.getComputedLayout()).toEqual(box(0, 0, 10, 5));
  });
});
