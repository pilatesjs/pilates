/**
 * Differential tests for `SpinelessLayout` (phase 8, v19): the
 * Spineless layout driver vs the imperative `calculateLayout`.
 *
 * Each tree is laid out by both engines and every node's `layout`
 * (`left` / `top` / `width` / `height`) plus `scrollWidth` /
 * `scrollHeight` is asserted byte-identical. Trees are kept
 * integer-friendly so rounding is unambiguous — the grammar and the
 * imperative agree on the float layout to within ULPs, and only an
 * exact `x.5` cell boundary could round them apart (see the phase-7
 * spec). The fuzzers cover the random-tree surface.
 */

import { describe, expect, it } from 'vitest';
import { Edge } from '../../edge.js';
import { Node } from '../../node.js';
import { SpinelessLayout } from './layout.js';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
}

function snapshot(root: Node): Box[] {
  const out: Box[] = [];
  function visit(n: Node): void {
    out.push({
      left: n.layout.left,
      top: n.layout.top,
      width: n.layout.width,
      height: n.layout.height,
      scrollWidth: n.layout.scrollWidth,
      scrollHeight: n.layout.scrollHeight,
    });
    for (let i = 0; i < n.getChildCount(); i++) visit(n.getChild(i)!);
  }
  visit(root);
  return out;
}

/**
 * Build the tree twice — one laid out by `SpinelessLayout`, one by
 * imperative `calculateLayout` — and assert the two layouts match.
 */
function sameLayout(make: () => Node, availableWidth?: number, availableHeight?: number): void {
  const viaSpineless = make();
  new SpinelessLayout(viaSpineless).layout(availableWidth, availableHeight);

  const viaImperative = make();
  viaImperative.calculateLayout(availableWidth, availableHeight);

  expect(snapshot(viaSpineless)).toEqual(snapshot(viaImperative));
}

describe('SpinelessLayout — differential vs calculateLayout (slice v19)', () => {
  it('a fixed-size row', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(40);
      root.setFlexDirection('row');
      for (const w of [30, 50, 20]) {
        const c = Node.create();
        c.setWidth(w);
        c.setHeight(30);
        root.insertChild(c, root.getChildCount());
      }
      return root;
    });
  });

  it('flex-grow distribution', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(300);
      root.setHeight(40);
      root.setFlexDirection('row');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(30);
        c.setFlexGrow(i + 1);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('flex-shrink with numeric basis', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(40);
      root.setFlexDirection('row');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(0);
        c.setHeight(30);
        c.setFlexBasis(60);
        c.setFlexShrink(1);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('column with padding, gap and margins', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(200);
      root.setFlexDirection('column');
      root.setPadding(Edge.Top, 10);
      root.setPadding(Edge.Left, 6);
      root.setGap('row', 8);
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(30);
        c.setMargin(Edge.Top, 4);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('justify-content + align-items', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(240);
      root.setHeight(80);
      root.setFlexDirection('row');
      root.setJustifyContent('space-between');
      root.setAlignItems('center');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('a multi-line wrap container', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(150);
      root.setHeight(120);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      for (let i = 0; i < 4; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(30);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it("an 'auto' root sized from available", () => {
    sameLayout(
      () => {
        const root = Node.create();
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(40);
        root.insertChild(c, 0);
        return root;
      },
      120,
      90,
    );
  });

  it("an 'auto' cross size stretches under align-items: stretch", () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(100);
      const c = Node.create();
      c.setHeight(20); // width 'auto' → stretches to 100
      root.insertChild(c, 0);
      return root;
    });
  });

  it('aspectRatio derivation', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(200);
      const c = Node.create();
      c.setWidth(60); // height 'auto', ratio 2 → 30
      c.setAspectRatio(2);
      root.insertChild(c, 0);
      return root;
    });
  });

  it('a measure-function leaf', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(100);
      const leaf = Node.create();
      leaf.setWidth(40); // explicit cross; height measured
      leaf.setMeasureFunc(() => ({ width: 40, height: 26 }));
      root.insertChild(leaf, 0);
      return root;
    });
  });

  it('absolute positioning', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(120);
      root.setFlexDirection('row');
      const a = Node.create();
      a.setWidth(40);
      a.setHeight(40);
      root.insertChild(a, 0);
      const abs = Node.create();
      abs.setPositionType('absolute');
      abs.setWidth(20);
      abs.setHeight(15);
      abs.setPosition(Edge.Right, 8);
      abs.setPosition(Edge.Top, 6);
      root.insertChild(abs, 1);
      return root;
    });
  });

  it('min / max clamping', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(300);
      root.setHeight(40);
      root.setFlexDirection('row');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(20);
        c.setFlexGrow(1);
        c.setMaxWidth(60);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('a reverse direction', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(40);
      root.setFlexDirection('row-reverse');
      for (const w of [30, 40, 50]) {
        const c = Node.create();
        c.setWidth(w);
        c.setHeight(30);
        root.insertChild(c, root.getChildCount());
      }
      return root;
    });
  });

  it('a nested column-of-rows tree', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(120);
      root.setFlexDirection('column');
      for (let i = 0; i < 2; i++) {
        const row = Node.create();
        row.setWidth(120);
        row.setHeight(60);
        row.setFlexDirection('row');
        root.insertChild(row, i);
        for (let j = 0; j < 2; j++) {
          const leaf = Node.create();
          leaf.setWidth(50);
          leaf.setHeight(40);
          row.insertChild(leaf, j);
        }
      }
      return root;
    });
  });
});
