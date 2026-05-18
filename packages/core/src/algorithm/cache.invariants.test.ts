import { describe, expect, it } from 'vitest';
import { Edge } from '../edge.js';
import { Node } from '../node.js';
import { calculateLayoutImperative } from './index.js';

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
    calculateLayoutImperative(row, 100, 50);
    calculateLayoutImperative(col, 100, 50);
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
    calculateLayoutImperative(root, 100, 50);
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
    calculateLayoutImperative(root, 100, 50);
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
    calculateLayoutImperative(root, 100, 50);
    expect(child.layout.left).toBe(0);

    // Add a left-margin to the child. markDirty propagates up to root;
    // cache is invalidated; re-layout reflects the new margin.
    child.setMargin(Edge.Left, 10);
    calculateLayoutImperative(root, 100, 50);
    expect(child.layout.left).toBe(10);
  });
});

describe('cache invariants — relayout boundaries', () => {
  it('layout cache hits at root after descendant mutation under a boundary', () => {
    // The Phase 3 win: with a boundary in the tree, descendant mutations
    // don't invalidate the root cache. Root.calculateLayout hits its
    // cache even though a leaf inside the boundary changed.
    const root = Node.create();
    root.setFlexDirection('row');
    const boundary = Node.create();
    // Explicit width AND height + no flex grow/shrink → boundary.
    boundary.setWidth(50);
    boundary.setHeight(50);
    const leaf = Node.create();
    boundary.insertChild(leaf, 0);
    root.insertChild(boundary, 0);

    // Prime the cache.
    calculateLayoutImperative(root, 100, 50);

    // Mutate a leaf under the boundary.
    leaf.setFlexGrow(3);

    const beforeHits =
      (root as unknown as { _layoutCache?: { hits: number } })._layoutCache?.hits ?? 0;

    calculateLayoutImperative(root, 100, 50);

    const afterHits =
      (root as unknown as { _layoutCache?: { hits: number } })._layoutCache?.hits ?? 0;

    // Root cache must hit (boundary stopped dirty propagation).
    // Differential mode skips this assertion (cold-pass invalidates
    // the counter).
    if (process.env.PILATES_DIFFERENTIAL_LAYOUT !== '1') {
      expect(afterHits).toBe(beforeHits + 1);
    }

    // Layout still correct.
    expect(boundary.layout.width).toBe(50);
    expect(boundary.layout.height).toBe(50);
  });
});
