import { describe, expect, it } from 'vitest';
import { Edge } from '../edge.js';
import { Node } from '../node.js';

describe('cache invariants — open questions from spec', () => {
  it('parentDirection is implicit in availableWidth/Height (Yoga + Taffy assumption)', () => {
    // Two trees with explicitly-sized children, one in row direction and
    // one in column. The children's own (width, height) should be the
    // same regardless of the parent's flex direction — proving that
    // parentDirection isn't needed in the layout cache key.
    function makeRow(): Node {
      const r = Node.create();
      r.setFlexDirection('row');
      r.setWidth(100);
      r.setHeight(50);
      const a = Node.create();
      a.setWidth(40);
      a.setHeight(20);
      r.insertChild(a, 0);
      return r;
    }
    function makeCol(): Node {
      const r = Node.create();
      r.setFlexDirection('column');
      r.setWidth(100);
      r.setHeight(50);
      const a = Node.create();
      a.setWidth(40);
      a.setHeight(20);
      r.insertChild(a, 0);
      return r;
    }
    const row = makeRow();
    const col = makeCol();
    row.calculateLayout(100, 50);
    col.calculateLayout(100, 50);
    // Same explicit-sized child yields the same (width, height)
    // regardless of parent direction.
    expect(row.getChild(0)!.layout.width).toBe(40);
    expect(col.getChild(0)!.layout.width).toBe(40);
    expect(row.getChild(0)!.layout.height).toBe(20);
    expect(col.getChild(0)!.layout.height).toBe(20);
  });

  it('absolutely-positioned children round-trip through the layout cache', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(50);
    const flex = Node.create();
    flex.setFlex(1);
    root.insertChild(flex, 0);
    const abs = Node.create();
    abs.setPositionType('absolute');
    abs.setPosition(Edge.Top, 5);
    abs.setPosition(Edge.Left, 10);
    abs.setWidth(20);
    abs.setHeight(15);
    root.insertChild(abs, 1);

    // First pass: cold layout.
    root.calculateLayout(100, 50);
    expect(abs.layout).toEqual({
      left: 10,
      top: 5,
      width: 20,
      height: 15,
      scrollWidth: 20,
      scrollHeight: 15,
    });

    // Second pass with no mutation: should hit the layout cache and
    // produce the same result.
    root.calculateLayout(100, 50);
    expect(abs.layout).toEqual({
      left: 10,
      top: 5,
      width: 20,
      height: 15,
      scrollWidth: 20,
      scrollHeight: 15,
    });
  });

  it('margin changes invalidate the cache and trigger re-layout', () => {
    // Margin position audit (spec Open Q1): the cache key omits margin.
    // Verify that mutating margin correctly triggers re-layout via
    // markDirty, so the cache invalidation path is correct without
    // needing margin in the key.
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(100);
    root.setHeight(50);
    const child = Node.create();
    child.setWidth(40);
    child.setHeight(20);
    root.insertChild(child, 0);
    root.calculateLayout(100, 50);
    expect(child.layout.left).toBe(0);

    // Add a left-margin to the child. markDirty propagates up to root;
    // cache is invalidated; re-layout reflects the new margin.
    child.setMargin(Edge.Left, 10);
    root.calculateLayout(100, 50);
    expect(child.layout.left).toBe(10);
  });
});
