/**
 * M5: justify-content, align-items / align-self, align-content, flex-wrap.
 */

import { describe, expect, it } from 'vitest';
import type { ComputedLayout } from '../layout.js';
import { Node } from '../node.js';

function box(left: number, top: number, width: number, height: number): ComputedLayout {
  return { left, top, width, height };
}

function makeRow(width: number, height: number): Node {
  const n = Node.create();
  n.setFlexDirection('row');
  n.setWidth(width);
  n.setHeight(height);
  return n;
}

function makeColumn(width: number, height: number): Node {
  const n = Node.create();
  n.setFlexDirection('column');
  n.setWidth(width);
  n.setHeight(height);
  return n;
}

function fixed(w: number, h: number): Node {
  const n = Node.create();
  n.setWidth(w);
  n.setHeight(h);
  return n;
}

describe('justify-content', () => {
  it('flex-start packs items at the start (default)', () => {
    const root = makeRow(60, 5);
    const a = fixed(10, 3);
    const b = fixed(10, 3);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();
    expect(a.getComputedLayout().left).toBe(0);
    expect(b.getComputedLayout().left).toBe(10);
  });

  it('flex-end packs items at the end', () => {
    const root = makeRow(60, 5);
    root.setJustifyContent('flex-end');
    const a = fixed(10, 3);
    const b = fixed(10, 3);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();
    expect(a.getComputedLayout().left).toBe(40);
    expect(b.getComputedLayout().left).toBe(50);
  });

  it('center centers the row', () => {
    const root = makeRow(60, 5);
    root.setJustifyContent('center');
    const a = fixed(10, 3);
    const b = fixed(10, 3);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();
    expect(a.getComputedLayout().left).toBe(20);
    expect(b.getComputedLayout().left).toBe(30);
  });

  it('space-between puts no space at the ends', () => {
    const root = makeRow(60, 5);
    root.setJustifyContent('space-between');
    const a = fixed(10, 3);
    const b = fixed(10, 3);
    const c = fixed(10, 3);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.insertChild(c, 2);
    root.calculateLayout();
    expect(a.getComputedLayout().left).toBe(0);
    expect(b.getComputedLayout().left).toBe(25);
    expect(c.getComputedLayout().left).toBe(50);
  });

  it('space-around halves the slack at each end', () => {
    const root = makeRow(60, 5);
    root.setJustifyContent('space-around');
    const a = fixed(10, 3);
    const b = fixed(10, 3);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();
    // Slack 40 / 2 items = 20 per item; 10 before each, 10 after.
    expect(a.getComputedLayout().left).toBe(10);
    expect(b.getComputedLayout().left).toBe(40);
  });

  it('space-evenly equalizes ends and gaps', () => {
    const root = makeRow(60, 5);
    root.setJustifyContent('space-evenly');
    const a = fixed(10, 3);
    const b = fixed(10, 3);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();
    // Slack 40 / (n+1=3) ≈ 13.33; positions ≈ 13, 37 after rounding.
    expect(a.getComputedLayout().left).toBe(13);
    expect(b.getComputedLayout().left).toBe(37);
  });

  it('flex-end on a column container', () => {
    const root = makeColumn(20, 30);
    root.setJustifyContent('flex-end');
    const a = fixed(20, 5);
    const b = fixed(20, 5);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();
    expect(a.getComputedLayout().top).toBe(20);
    expect(b.getComputedLayout().top).toBe(25);
  });
});

describe('align-items', () => {
  it('stretch (default) fills the cross axis', () => {
    const root = makeRow(40, 10);
    const child = fixed(10, 3); // explicit cross size, but stretch overrides? No — explicit wins.
    root.insertChild(child, 0);
    root.calculateLayout();
    // Explicit height: 3, kept (stretch only applies when cross is auto).
    expect(child.getComputedLayout().height).toBe(3);
  });

  it('stretch fills cross axis when item has no explicit cross size', () => {
    const root = makeRow(40, 10);
    const child = Node.create();
    child.setWidth(10);
    root.insertChild(child, 0);
    root.calculateLayout();
    expect(child.getComputedLayout().height).toBe(10);
  });

  it('flex-start aligns items to the cross-axis start', () => {
    const root = makeRow(40, 10);
    root.setAlignItems('flex-start');
    const child = fixed(10, 3);
    root.insertChild(child, 0);
    root.calculateLayout();
    expect(child.getComputedLayout()).toEqual(box(0, 0, 10, 3));
  });

  it('flex-end aligns items to the cross-axis end', () => {
    const root = makeRow(40, 10);
    root.setAlignItems('flex-end');
    const child = fixed(10, 3);
    root.insertChild(child, 0);
    root.calculateLayout();
    expect(child.getComputedLayout()).toEqual(box(0, 7, 10, 3));
  });

  it('center centers items on the cross axis', () => {
    const root = makeRow(40, 10);
    root.setAlignItems('center');
    const child = fixed(10, 4);
    root.insertChild(child, 0);
    root.calculateLayout();
    // (10 - 4) / 2 = 3.
    expect(child.getComputedLayout()).toEqual(box(0, 3, 10, 4));
  });
});

describe('align-self overrides align-items', () => {
  it('per-item override', () => {
    // Use even differences to keep centering cleanly integer.
    const root = makeRow(40, 10);
    root.setAlignItems('flex-start');

    const a = fixed(10, 4);
    const b = fixed(10, 4);
    b.setAlignSelf('flex-end');
    const c = fixed(10, 4);
    c.setAlignSelf('center');

    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.insertChild(c, 2);
    root.calculateLayout();

    expect(a.getComputedLayout().top).toBe(0);
    expect(b.getComputedLayout().top).toBe(6);
    expect(c.getComputedLayout().top).toBe(3);
  });
});

describe('flex-wrap', () => {
  it('wraps row children onto multiple lines when they overflow main axis', () => {
    const root = makeRow(40, 10);
    root.setFlexWrap('wrap');

    const a = fixed(20, 4);
    const b = fixed(20, 4);
    const c = fixed(20, 4);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.insertChild(c, 2);
    root.calculateLayout();

    // Two lines: [a, b] then [c].
    // Line cross sizes: 4 and 4; container cross 10, leftover 2 distributed
    // by alignContent stretch (default) → 1 added to each line cross.
    expect(a.getComputedLayout().left).toBe(0);
    expect(b.getComputedLayout().left).toBe(20);
    expect(c.getComputedLayout().left).toBe(0);
    expect(c.getComputedLayout().top).toBeGreaterThan(0);
  });

  it('does not wrap when flex-wrap is nowrap (default)', () => {
    const root = makeRow(40, 10);
    const a = fixed(20, 4);
    const b = fixed(20, 4);
    const c = fixed(20, 4);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.insertChild(c, 2);
    root.calculateLayout();

    // All on one line, even though they overflow.
    expect(a.getComputedLayout().top).toBe(0);
    expect(b.getComputedLayout().top).toBe(0);
    expect(c.getComputedLayout().top).toBe(0);
  });
});

describe('align-content', () => {
  it('flex-start packs lines at the cross start', () => {
    const root = makeRow(40, 20);
    root.setFlexWrap('wrap');
    root.setAlignContent('flex-start');

    const a = fixed(20, 3);
    const b = fixed(20, 3);
    const c = fixed(20, 3);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.insertChild(c, 2);
    root.calculateLayout();

    // Line 1: [a, b] at top 0, height 3.
    // Line 2: [c] at top 3, height 3.
    expect(a.getComputedLayout().top).toBe(0);
    expect(b.getComputedLayout().top).toBe(0);
    expect(c.getComputedLayout().top).toBe(3);
    // Lines do NOT stretch.
    expect(a.getComputedLayout().height).toBe(3);
  });

  it('center centers lines on the cross axis', () => {
    const root = makeRow(40, 20);
    root.setFlexWrap('wrap');
    root.setAlignContent('center');

    const a = fixed(20, 3);
    const b = fixed(20, 3);
    const c = fixed(20, 3);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.insertChild(c, 2);
    root.calculateLayout();

    // Total used cross: 3 + 3 = 6; leftover 14, half (7) before, half after.
    expect(a.getComputedLayout().top).toBe(7);
    expect(c.getComputedLayout().top).toBe(10);
  });

  it('space-between lines: 0 at ends, slack between', () => {
    const root = makeRow(40, 20);
    root.setFlexWrap('wrap');
    root.setAlignContent('space-between');

    const a = fixed(20, 3);
    const b = fixed(20, 3);
    const c = fixed(20, 3);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.insertChild(c, 2);
    root.calculateLayout();

    expect(a.getComputedLayout().top).toBe(0);
    expect(c.getComputedLayout().top).toBe(17);
  });
});

describe('wrap-reverse', () => {
  it('reverses line stack on cross axis', () => {
    const root = makeRow(40, 10);
    root.setFlexWrap('wrap-reverse');
    root.setAlignContent('flex-start');

    const a = fixed(20, 3);
    const b = fixed(20, 3);
    const c = fixed(20, 3);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.insertChild(c, 2);
    root.calculateLayout();

    // Without wrap-reverse: [a, b] at top 0, [c] at top 3.
    // With wrap-reverse: [c] at top 0, [a, b] at top 3.
    expect(c.getComputedLayout().top).toBeLessThan(a.getComputedLayout().top);
  });
});
