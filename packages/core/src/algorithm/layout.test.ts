/**
 * Hand-crafted layout fixtures for the M4 main-axis algorithm.
 *
 * Each test builds a small tree, calls `calculateLayout()`, and asserts the
 * exact integer-cell layout boxes. Coverage targets:
 *
 *   - row + column directions, with reverse variants
 *   - fixed sizes, flex grow / shrink distribution
 *   - padding, margin, gap on both axes
 *   - min / max constraints
 *   - default cross-axis stretch
 *   - measure-function leaves
 *   - nested containers
 */

import { describe, expect, it } from 'vitest';
import { Edge } from '../edge.js';
import type { ComputedLayout } from '../layout.js';
import { Node } from '../node.js';

function box(left: number, top: number, width: number, height: number): ComputedLayout {
  return { left, top, width, height };
}

describe('layout — leaf root', () => {
  it('honors explicit width/height on the root', () => {
    const n = Node.create();
    n.setWidth(80);
    n.setHeight(24);
    n.calculateLayout();
    expect(n.getComputedLayout()).toEqual(box(0, 0, 80, 24));
  });

  it('falls back to availableWidth/availableHeight when style is auto', () => {
    const n = Node.create();
    n.calculateLayout(80, 24);
    expect(n.getComputedLayout()).toEqual(box(0, 0, 80, 24));
  });

  it('clamps the root size to its min/max bounds', () => {
    const n = Node.create();
    n.setMaxWidth(50);
    n.calculateLayout(80, 24);
    expect(n.getComputedLayout().width).toBe(50);
  });
});

describe('layout — row direction, fixed widths', () => {
  it('places two fixed-width children side by side', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(80);
    root.setHeight(10);

    const a = Node.create();
    a.setWidth(30);
    const b = Node.create();
    b.setWidth(20);

    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();

    expect(a.getComputedLayout()).toEqual(box(0, 0, 30, 10));
    expect(b.getComputedLayout()).toEqual(box(30, 0, 20, 10));
  });

  it('stretches children to fill the cross axis by default', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(40);
    root.setHeight(8);

    const child = Node.create();
    child.setWidth(20);
    root.insertChild(child, 0);
    root.calculateLayout();

    expect(child.getComputedLayout()).toEqual(box(0, 0, 20, 8));
  });
});

describe('layout — flex grow distribution', () => {
  it('splits leftover space proportionally between flex:1 children', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(60);
    root.setHeight(10);

    const a = Node.create();
    a.setFlex(1);
    const b = Node.create();
    b.setFlex(1);
    const c = Node.create();
    c.setFlex(1);

    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.insertChild(c, 2);
    root.calculateLayout();

    // 60 / 3 = 20 each, no rounding ambiguity.
    expect(a.getComputedLayout()).toEqual(box(0, 0, 20, 10));
    expect(b.getComputedLayout()).toEqual(box(20, 0, 20, 10));
    expect(c.getComputedLayout()).toEqual(box(40, 0, 20, 10));
  });

  it('respects different grow weights', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(60);
    root.setHeight(10);

    const a = Node.create();
    a.setFlexGrow(1);
    const b = Node.create();
    b.setFlexGrow(2);

    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();

    expect(a.getComputedLayout().width).toBe(20);
    expect(b.getComputedLayout().width).toBe(40);
  });

  it('mixes a fixed-width sibling with a flex:1 sibling', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(80);
    root.setHeight(24);

    const main = Node.create();
    main.setFlex(1);
    const sidebar = Node.create();
    sidebar.setWidth(20);

    root.insertChild(main, 0);
    root.insertChild(sidebar, 1);
    root.calculateLayout();

    expect(main.getComputedLayout()).toEqual(box(0, 0, 60, 24));
    expect(sidebar.getComputedLayout()).toEqual(box(60, 0, 20, 24));
  });

  it('rounds to integer cells with butting edges across uneven splits', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(100);
    root.setHeight(1);

    const a = Node.create();
    a.setFlex(1);
    const b = Node.create();
    b.setFlex(1);
    const c = Node.create();
    c.setFlex(1);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.insertChild(c, 2);
    root.calculateLayout();

    const la = a.getComputedLayout();
    const lb = b.getComputedLayout();
    const lc = c.getComputedLayout();
    // No gaps and no overlaps.
    expect(la.left + la.width).toBe(lb.left);
    expect(lb.left + lb.width).toBe(lc.left);
    expect(lc.left + lc.width).toBe(100);
    // Every cell is integer.
    for (const v of [la.width, lb.width, lc.width]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('layout — flex shrink distribution', () => {
  it('shrinks oversized children weighted by basis when flexShrink is set', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(40);
    root.setHeight(1);

    // Two children width 30 each; total 60, container 40, overflow 20.
    // flexShrink=1 each → scaled factor = 30 each, so each shrinks by 10.
    // (Default flexShrink is 0 — Yoga semantics — so the shrink must be opted into.)
    const a = Node.create();
    a.setWidth(30);
    a.setFlexShrink(1);
    const b = Node.create();
    b.setWidth(30);
    b.setFlexShrink(1);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();

    expect(a.getComputedLayout().width).toBe(20);
    expect(b.getComputedLayout().width).toBe(20);
  });

  it('does not shrink when flexShrink is 0', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(40);
    root.setHeight(1);

    const a = Node.create();
    a.setWidth(30);
    a.setFlexShrink(0);
    const b = Node.create();
    b.setWidth(30);
    b.setFlexShrink(1);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();

    expect(a.getComputedLayout().width).toBe(30);
    expect(b.getComputedLayout().width).toBe(10);
  });
});

describe('layout — padding, margin, gap', () => {
  it('applies container padding to children', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(40);
    root.setHeight(10);
    root.setPadding(Edge.All, 1);

    const child = Node.create();
    child.setFlex(1);
    root.insertChild(child, 0);
    root.calculateLayout();

    expect(child.getComputedLayout()).toEqual(box(1, 1, 38, 8));
  });

  it('applies child margin on both axes', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(40);
    root.setHeight(10);

    const child = Node.create();
    child.setFlex(1);
    child.setMargin(Edge.All, 2);
    root.insertChild(child, 0);
    root.calculateLayout();

    // Width: 40 - 2 (left margin) - 2 (right margin) = 36.
    // Height: 10 - 2 - 2 = 6 (cross stretch minus margin).
    expect(child.getComputedLayout()).toEqual(box(2, 2, 36, 6));
  });

  it('inserts column-gap between row siblings', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(40);
    root.setHeight(10);
    root.setGap('column', 4);

    const a = Node.create();
    a.setFlex(1);
    const b = Node.create();
    b.setFlex(1);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();

    // Available 40, gap 4, two children share remaining 36, 18 each.
    expect(a.getComputedLayout().width).toBe(18);
    expect(b.getComputedLayout()).toEqual(box(22, 0, 18, 10));
  });

  it('inserts row-gap between column siblings', () => {
    const root = Node.create();
    root.setFlexDirection('column');
    root.setWidth(20);
    root.setHeight(10);
    root.setGap('row', 2);

    const a = Node.create();
    a.setFlex(1);
    const b = Node.create();
    b.setFlex(1);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();

    // Available 10, gap 2, two children share remaining 8, 4 each.
    expect(a.getComputedLayout()).toEqual(box(0, 0, 20, 4));
    expect(b.getComputedLayout()).toEqual(box(0, 6, 20, 4));
  });
});

describe('layout — min / max constraints', () => {
  it('respects minWidth even when there is plenty of room', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(60);
    root.setHeight(1);

    const a = Node.create();
    a.setFlex(1);
    a.setMinWidth(50);
    const b = Node.create();
    b.setFlex(1);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();

    expect(a.getComputedLayout().width).toBeGreaterThanOrEqual(50);
  });

  it('respects maxWidth on a stretching child', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(60);
    root.setHeight(1);

    const a = Node.create();
    a.setFlex(1);
    a.setMaxWidth(20);
    const b = Node.create();
    b.setFlex(1);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();

    expect(a.getComputedLayout().width).toBe(20);
  });
});

describe('layout — direction', () => {
  it('handles column direction', () => {
    const root = Node.create();
    root.setFlexDirection('column');
    root.setWidth(20);
    root.setHeight(60);

    const a = Node.create();
    a.setFlex(1);
    const b = Node.create();
    b.setFlex(1);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();

    expect(a.getComputedLayout()).toEqual(box(0, 0, 20, 30));
    expect(b.getComputedLayout()).toEqual(box(0, 30, 20, 30));
  });

  it('handles row-reverse', () => {
    const root = Node.create();
    root.setFlexDirection('row-reverse');
    root.setWidth(60);
    root.setHeight(10);

    const a = Node.create();
    a.setWidth(20);
    const b = Node.create();
    b.setWidth(15);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();

    // Reversed: a sits at the right edge, b to its left.
    expect(a.getComputedLayout()).toEqual(box(40, 0, 20, 10));
    expect(b.getComputedLayout()).toEqual(box(25, 0, 15, 10));
  });

  it('handles column-reverse', () => {
    const root = Node.create();
    root.setFlexDirection('column-reverse');
    root.setWidth(20);
    root.setHeight(20);

    const a = Node.create();
    a.setHeight(5);
    const b = Node.create();
    b.setHeight(5);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();

    expect(a.getComputedLayout()).toEqual(box(0, 15, 20, 5));
    expect(b.getComputedLayout()).toEqual(box(0, 10, 20, 5));
  });
});

describe('layout — measure func leaves', () => {
  it('uses the measure func to size a leaf', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(40);
    root.setHeight(5);

    const text = Node.create();
    text.setMeasureFunc(() => ({ width: 7, height: 1 }));
    root.insertChild(text, 0);
    root.calculateLayout();

    // The leaf reports width 7 and is stretched to fill the cross axis.
    expect(text.getComputedLayout().width).toBe(7);
    expect(text.getComputedLayout().height).toBe(5);
  });
});

describe('layout — nested containers', () => {
  it('lays out a two-pane app shell with a header row', () => {
    // A typical TUI layout:
    //   ┌────────────────────────────────────────┐
    //   │ header (height 1)                      │
    //   ├──────────────────────────┬─────────────┤
    //   │ main flex:1              │ sidebar 20  │
    //   │                          │             │
    //   └──────────────────────────┴─────────────┘
    const root = Node.create();
    root.setFlexDirection('column');
    root.setWidth(80);
    root.setHeight(24);

    const header = Node.create();
    header.setHeight(1);
    root.insertChild(header, 0);

    const body = Node.create();
    body.setFlex(1);
    body.setFlexDirection('row');
    root.insertChild(body, 1);

    const main = Node.create();
    main.setFlex(1);
    body.insertChild(main, 0);

    const sidebar = Node.create();
    sidebar.setWidth(20);
    body.insertChild(sidebar, 1);

    root.calculateLayout();

    expect(header.getComputedLayout()).toEqual(box(0, 0, 80, 1));
    expect(body.getComputedLayout()).toEqual(box(0, 1, 80, 23));
    expect(main.getComputedLayout()).toEqual(box(0, 0, 60, 23));
    expect(sidebar.getComputedLayout()).toEqual(box(60, 0, 20, 23));
  });
});

describe('layout — display none', () => {
  it('a hidden child takes no space', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(40);
    root.setHeight(10);

    const visible = Node.create();
    visible.setFlex(1);
    const hidden = Node.create();
    hidden.setFlex(1);
    hidden.setDisplay('none');
    root.insertChild(visible, 0);
    root.insertChild(hidden, 1);
    root.calculateLayout();

    expect(visible.getComputedLayout().width).toBe(40);
  });
});

describe('layout — dirty bit', () => {
  it('clears the dirty bit on every node after calculateLayout', () => {
    const root = Node.create();
    root.setWidth(20);
    root.setHeight(5);
    const child = Node.create();
    child.setFlex(1);
    root.insertChild(child, 0);

    expect(root.isDirty()).toBe(true);
    root.calculateLayout();
    expect(root.isDirty()).toBe(false);
    expect(child.isDirty()).toBe(false);
  });
});
