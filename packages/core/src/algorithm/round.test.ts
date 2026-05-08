import { describe, expect, it } from 'vitest';
import { Node } from '../node.js';
import { roundLayout } from './round.js';

describe('roundLayout', () => {
  it('is a no-op on an already-integer layout', () => {
    const root = new Node();
    root.setWidth(40);
    root.setHeight(10);
    root.calculateLayout();
    roundLayout(root);
    const lo = root.getComputedLayout();
    expect(lo.width).toBe(40);
    expect(lo.height).toBe(10);
  });

  it('produces integer dimensions after fractional injection', () => {
    const root = new Node();
    root.setWidth(10);
    root.setHeight(1);
    root.calculateLayout();
    // _layout fields are directly mutable (round.ts itself writes node._layout.left = ...)
    root._layout.left = 0;
    root._layout.top = 0;
    root._layout.width = 33.333;
    root._layout.height = 1;
    roundLayout(root);
    const lo = root.getComputedLayout();
    expect(Number.isInteger(lo.width)).toBe(true);
    expect(Number.isInteger(lo.height)).toBe(true);
  });

  it('satisfies butt-joint invariant: b.left === a.left + a.width', () => {
    const root = new Node();
    root.setWidth(100);
    root.setHeight(1);
    const a = new Node();
    const b = new Node();
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();
    // Inject fractional sibling layout values
    root._layout.left = 0;
    root._layout.top = 0;
    root._layout.width = 100;
    root._layout.height = 1;
    a._layout.left = 0;
    a._layout.top = 0;
    a._layout.width = 33.333;
    a._layout.height = 1;
    b._layout.left = 33.333;
    b._layout.top = 0;
    b._layout.width = 33.333;
    b._layout.height = 1;
    roundLayout(root);
    const la = a.getComputedLayout();
    const lb = b.getComputedLayout();
    expect(Number.isInteger(la.left)).toBe(true);
    expect(Number.isInteger(la.width)).toBe(true);
    expect(Number.isInteger(lb.left)).toBe(true);
    // sibling right edge must butt cleanly
    expect(lb.left).toBe(la.left + la.width);
  });

  it('clamps to ≥ 0 (no negative dimensions)', () => {
    const root = new Node();
    root.setWidth(1);
    root.setHeight(1);
    root.calculateLayout();
    root._layout.left = 0.4;
    root._layout.top = 0.4;
    root._layout.width = 0.3;
    root._layout.height = 0.3;
    roundLayout(root);
    const lo = root.getComputedLayout();
    expect(lo.width).toBeGreaterThanOrEqual(0);
    expect(lo.height).toBeGreaterThanOrEqual(0);
  });

  it('recurses to children — all child dimensions are integers', () => {
    const root = new Node();
    root.setWidth(10);
    root.setHeight(10);
    const child = new Node();
    root.insertChild(child, 0);
    root.calculateLayout();
    roundLayout(root);
    const lc = child.getComputedLayout();
    expect(Number.isInteger(lc.left)).toBe(true);
    expect(Number.isInteger(lc.top)).toBe(true);
    expect(Number.isInteger(lc.width)).toBe(true);
    expect(Number.isInteger(lc.height)).toBe(true);
  });

  it('real flex-thirds: three flex:1 siblings in 10px container → integer widths summing ≤ 10', () => {
    const root = new Node();
    root.setWidth(10);
    root.setHeight(1);
    root.setFlexDirection('row');
    const [a, b, c] = [new Node(), new Node(), new Node()];
    for (const n of [a, b, c]) {
      n.setFlexGrow(1);
      root.insertChild(n, [a, b, c].indexOf(n));
    }
    root.calculateLayout();
    roundLayout(root);
    for (const n of [a, b, c]) {
      expect(Number.isInteger(n.getComputedLayout().width)).toBe(true);
    }
    const total = [a, b, c].reduce((sum, n) => sum + n.getComputedLayout().width, 0);
    expect(total).toBeLessThanOrEqual(10);
  });
});
