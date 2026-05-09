import { describe, expect, it } from 'vitest';
import { Edge } from '../edge.js';
import { MeasureMode } from '../measure-func.js';
import { Node } from '../node.js';
import {
  LayoutCache,
  MeasureCache,
  clearAllCaches,
  diffLayouts,
  markDirtyDeep,
  restoreFromCache,
  snapshotForCache,
  snapshotTreeLayouts,
} from './cache.js';
import type { LayoutCacheValue } from './cache.js';

describe('MeasureCache', () => {
  const KEY_A = {
    availableWidth: 10,
    widthMode: MeasureMode.AtMost,
    availableHeight: 5,
    heightMode: MeasureMode.AtMost,
  };
  const KEY_B = {
    availableWidth: 20,
    widthMode: MeasureMode.Exactly,
    availableHeight: 10,
    heightMode: MeasureMode.AtMost,
  };

  it('returns undefined on empty cache', () => {
    const c = new MeasureCache();
    expect(c.lookup(KEY_A)).toBeUndefined();
  });

  it('stores and retrieves an entry by exact key match', () => {
    const c = new MeasureCache();
    c.store(KEY_A, { width: 8, height: 4 });
    expect(c.lookup(KEY_A)).toEqual({ width: 8, height: 4 });
  });

  it('returns undefined when any key field differs', () => {
    const c = new MeasureCache();
    c.store(KEY_A, { width: 8, height: 4 });
    expect(c.lookup({ ...KEY_A, availableWidth: 11 })).toBeUndefined();
    expect(c.lookup({ ...KEY_A, widthMode: MeasureMode.Exactly })).toBeUndefined();
    expect(c.lookup({ ...KEY_A, availableHeight: 6 })).toBeUndefined();
    expect(c.lookup({ ...KEY_A, heightMode: MeasureMode.Exactly })).toBeUndefined();
  });

  it('overwrites the value when storing the same key twice', () => {
    const c = new MeasureCache();
    c.store(KEY_A, { width: 8, height: 4 });
    c.store(KEY_A, { width: 9, height: 5 });
    expect(c.lookup(KEY_A)).toEqual({ width: 9, height: 5 });
  });

  it('overwriting a key in a full cache does not evict any other slot', () => {
    // Fill to capacity (8 entries), then overwrite the value at slot 0.
    // The overwrite path must NOT fall through to push+evict — if it
    // did, slot 0 would still be there (re-pushed) but slot 1 would
    // get evicted as the "oldest". This regression-guards the early
    // return on the in-place-overwrite branch in `store()`.
    const c = new MeasureCache();
    const keys = Array.from({ length: 8 }, (_, i) => ({
      availableWidth: 10 + i,
      widthMode: MeasureMode.AtMost,
      availableHeight: 5,
      heightMode: MeasureMode.AtMost,
    }));
    keys.forEach((k, i) => c.store(k, { width: i, height: i }));
    c.store(keys[0]!, { width: 99, height: 99 });
    // All eight original keys must still resolve.
    for (let i = 0; i < 8; i++) {
      const found = c.lookup(keys[i]!);
      expect(found).toBeDefined();
    }
    // The overwrite took effect.
    expect(c.lookup(keys[0]!)).toEqual({ width: 99, height: 99 });
  });

  it('keeps eight distinct entries (slot capacity)', () => {
    const c = new MeasureCache();
    const keys = Array.from({ length: 8 }, (_, i) => ({
      availableWidth: 10 + i,
      widthMode: MeasureMode.AtMost,
      availableHeight: 5,
      heightMode: MeasureMode.AtMost,
    }));
    keys.forEach((k, i) => c.store(k, { width: i, height: i }));
    keys.forEach((k, i) => {
      expect(c.lookup(k)).toEqual({ width: i, height: i });
    });
  });

  it('evicts the oldest entry when a ninth distinct key is stored', () => {
    const c = new MeasureCache();
    const keys = Array.from({ length: 9 }, (_, i) => ({
      availableWidth: 10 + i,
      widthMode: MeasureMode.AtMost,
      availableHeight: 5,
      heightMode: MeasureMode.AtMost,
    }));
    keys.forEach((k, i) => c.store(k, { width: i, height: i }));
    expect(c.lookup(keys[0]!)).toBeUndefined();
    for (let i = 1; i < 9; i++) {
      expect(c.lookup(keys[i]!)).toEqual({ width: i, height: i });
    }
  });

  it('clear() drops every entry', () => {
    const c = new MeasureCache();
    c.store(KEY_A, { width: 8, height: 4 });
    c.store(KEY_B, { width: 18, height: 9 });
    c.clear();
    expect(c.lookup(KEY_A)).toBeUndefined();
    expect(c.lookup(KEY_B)).toBeUndefined();
  });

  it('treats Number.POSITIVE_INFINITY as a valid availableWidth/Height key value', () => {
    const c = new MeasureCache();
    const inf = {
      availableWidth: Number.POSITIVE_INFINITY,
      widthMode: MeasureMode.Undefined,
      availableHeight: Number.POSITIVE_INFINITY,
      heightMode: MeasureMode.Undefined,
    };
    c.store(inf, { width: 5, height: 5 });
    expect(c.lookup(inf)).toEqual({ width: 5, height: 5 });
  });

  it('tracks hits and misses', () => {
    const c = new MeasureCache();
    expect(c.hits).toBe(0);
    expect(c.misses).toBe(0);
    c.lookup(KEY_A);
    expect(c.misses).toBe(1);
    c.store(KEY_A, { width: 8, height: 4 });
    c.lookup(KEY_A);
    c.lookup(KEY_A);
    expect(c.hits).toBe(2);
    expect(c.misses).toBe(1);
  });
});

describe('snapshotTreeLayouts', () => {
  it('returns a flat array in pre-order with all six layout fields per node', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(50);
    const child = Node.create();
    child.setWidth(40);
    child.setHeight(20);
    root.insertChild(child, 0);
    root.calculateLayout(100, 50);

    const snap = snapshotTreeLayouts(root);
    expect(snap).toHaveLength(2); // root + child
    expect(snap[0]).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      scrollWidth: 100,
      scrollHeight: 50,
    });
    expect(snap[1]).toEqual({
      left: 0,
      top: 0,
      width: 40,
      height: 20,
      scrollWidth: 40,
      scrollHeight: 20,
    });
  });
});

describe('clearAllCaches', () => {
  it('clears _measureCache on every node in the subtree', () => {
    const root = Node.create();
    const leaf = Node.create();
    leaf.setMeasureFunc((w, _wm, h, _hm) => ({ width: w, height: h }));
    root.insertChild(leaf, 0);
    root.calculateLayout(100, 50);
    leaf._measureCache!.store(
      { availableWidth: 7, widthMode: 'at-most', availableHeight: 3, heightMode: 'at-most' },
      { width: 7, height: 3 },
    );
    expect(
      leaf._measureCache!.lookup({
        availableWidth: 7,
        widthMode: 'at-most',
        availableHeight: 3,
        heightMode: 'at-most',
      }),
    ).toBeDefined();

    clearAllCaches(root);
    expect(
      leaf._measureCache!.lookup({
        availableWidth: 7,
        widthMode: 'at-most',
        availableHeight: 3,
        heightMode: 'at-most',
      }),
    ).toBeUndefined();
  });
});

describe('markDirtyDeep', () => {
  it('marks every node in the subtree dirty', () => {
    const root = Node.create();
    const child = Node.create();
    const grand = Node.create();
    root.insertChild(child, 0);
    child.insertChild(grand, 0);
    root.calculateLayout(100, 50);

    expect(root.isDirty()).toBe(false);
    expect(child.isDirty()).toBe(false);
    expect(grand.isDirty()).toBe(false);

    markDirtyDeep(root);
    expect(root.isDirty()).toBe(true);
    expect(child.isDirty()).toBe(true);
    expect(grand.isDirty()).toBe(true);
  });
});

describe('diffLayouts', () => {
  it('returns empty string when snapshots match', () => {
    const a = [{ left: 0, top: 0, width: 10, height: 5, scrollWidth: 10, scrollHeight: 5 }];
    const b = [{ left: 0, top: 0, width: 10, height: 5, scrollWidth: 10, scrollHeight: 5 }];
    expect(diffLayouts(a, b)).toBe('');
  });

  it('describes the first divergent node', () => {
    const a = [
      { left: 0, top: 0, width: 10, height: 5, scrollWidth: 10, scrollHeight: 5 },
      { left: 0, top: 0, width: 4, height: 2, scrollWidth: 4, scrollHeight: 2 },
    ];
    const b = [
      { left: 0, top: 0, width: 10, height: 5, scrollWidth: 10, scrollHeight: 5 },
      { left: 0, top: 0, width: 5, height: 2, scrollWidth: 5, scrollHeight: 2 },
    ];
    const out = diffLayouts(a, b);
    expect(out).toContain('node[1]');
    expect(out).toContain('width');
    expect(out).toContain('4');
    expect(out).toContain('5');
  });

  it('reports length mismatch', () => {
    const a = [{ left: 0, top: 0, width: 10, height: 5, scrollWidth: 10, scrollHeight: 5 }];
    const b: typeof a = [];
    expect(diffLayouts(a, b)).toContain('length');
  });
});

describe('LayoutCache', () => {
  const KEY_A = {
    availableWidth: 100,
    widthMode: MeasureMode.Exactly,
    availableHeight: 50,
    heightMode: MeasureMode.Exactly,
  };
  const KEY_B = {
    availableWidth: 80,
    widthMode: MeasureMode.AtMost,
    availableHeight: 40,
    heightMode: MeasureMode.AtMost,
  };
  const VAL_A = {
    width: 100,
    height: 50,
    scrollWidth: 100,
    scrollHeight: 50,
    childLayouts: [
      {
        left: 0,
        top: 0,
        width: 50,
        height: 25,
        scrollWidth: 50,
        scrollHeight: 25,
        floatLeft: 0,
        floatTop: 0,
      },
      {
        left: 50,
        top: 0,
        width: 50,
        height: 25,
        scrollWidth: 50,
        scrollHeight: 25,
        floatLeft: 50,
        floatTop: 0,
      },
    ],
  };

  it('returns undefined on empty cache', () => {
    const c = new LayoutCache();
    expect(c.lookup(KEY_A)).toBeUndefined();
  });

  it('stores and retrieves an entry by exact key match', () => {
    const c = new LayoutCache();
    c.store(KEY_A, VAL_A);
    expect(c.lookup(KEY_A)).toEqual(VAL_A);
  });

  it('returns undefined when any key field differs', () => {
    const c = new LayoutCache();
    c.store(KEY_A, VAL_A);
    expect(c.lookup({ ...KEY_A, availableWidth: 99 })).toBeUndefined();
    expect(c.lookup({ ...KEY_A, widthMode: MeasureMode.AtMost })).toBeUndefined();
    expect(c.lookup({ ...KEY_A, availableHeight: 49 })).toBeUndefined();
    expect(c.lookup({ ...KEY_A, heightMode: MeasureMode.AtMost })).toBeUndefined();
  });

  it('overwrites the value on second store with same key (single slot)', () => {
    const c = new LayoutCache();
    c.store(KEY_A, VAL_A);
    const VAL_A2 = { ...VAL_A, width: 200 };
    c.store(KEY_A, VAL_A2);
    expect(c.lookup(KEY_A)).toEqual(VAL_A2);
  });

  it('storing a new key overwrites the previous slot (single-slot cache)', () => {
    const c = new LayoutCache();
    c.store(KEY_A, VAL_A);
    c.store(KEY_B, { ...VAL_A, width: 80 });
    expect(c.lookup(KEY_A)).toBeUndefined();
    expect(c.lookup(KEY_B)).toEqual({ ...VAL_A, width: 80 });
  });

  it('clear() drops the slot', () => {
    const c = new LayoutCache();
    c.store(KEY_A, VAL_A);
    c.clear();
    expect(c.lookup(KEY_A)).toBeUndefined();
  });

  it('tracks hits and misses', () => {
    const c = new LayoutCache();
    expect(c.hits).toBe(0);
    expect(c.misses).toBe(0);
    c.lookup(KEY_A);
    expect(c.misses).toBe(1);
    c.store(KEY_A, VAL_A);
    c.lookup(KEY_A);
    c.lookup(KEY_A);
    expect(c.hits).toBe(2);
    expect(c.misses).toBe(1);
  });

  it('value is stored by reference; mutating the input affects the cache (caller must not mutate after store)', () => {
    // Documenting the contract: store does not deep-clone; callers must
    // construct a fresh LayoutCacheValue per store.
    const c = new LayoutCache();
    const v: LayoutCacheValue = {
      width: 10,
      height: 10,
      scrollWidth: 10,
      scrollHeight: 10,
      childLayouts: [],
    };
    c.store(KEY_A, v);
    v.width = 999;
    expect(c.lookup(KEY_A)?.width).toBe(999); // mutation visible — proves no clone
  });
});

describe('snapshotForCache', () => {
  it('captures the node plus a parallel array of direct-child layouts', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(50);
    root.setFlexDirection('row');
    const a = Node.create();
    a.setFlex(1);
    const b = Node.create();
    b.setFlex(1);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout(100, 50);

    const snap = snapshotForCache(root);
    expect(snap.width).toBe(100);
    expect(snap.height).toBe(50);
    expect(snap.scrollWidth).toBe(100);
    expect(snap.scrollHeight).toBe(50);
    expect(snap.childLayouts).toHaveLength(2);
    expect(snap.childLayouts[0]).toEqual({
      left: 0,
      top: 0,
      width: 50,
      height: 50,
      scrollWidth: 50,
      scrollHeight: 50,
      floatLeft: 0,
      floatTop: 0,
    });
    expect(snap.childLayouts[1]).toEqual({
      left: 50,
      top: 0,
      width: 50,
      height: 50,
      scrollWidth: 50,
      scrollHeight: 50,
      floatLeft: 50,
      floatTop: 0,
    });
  });
});

describe('restoreFromCache', () => {
  it('writes the node and its direct children back to _layout (positions and sizes)', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(50);
    root.setFlexDirection('row');
    const a = Node.create();
    const b = Node.create();
    root.insertChild(a, 0);
    root.insertChild(b, 1);

    const cached: LayoutCacheValue = {
      width: 100,
      height: 50,
      scrollWidth: 100,
      scrollHeight: 50,
      childLayouts: [
        {
          left: 0,
          top: 0,
          width: 50,
          height: 50,
          scrollWidth: 50,
          scrollHeight: 50,
          floatLeft: 0,
          floatTop: 0,
        },
        {
          left: 50,
          top: 0,
          width: 50,
          height: 50,
          scrollWidth: 50,
          scrollHeight: 50,
          floatLeft: 50,
          floatTop: 0,
        },
      ],
    };
    restoreFromCache(root, cached);

    expect(root.layout.width).toBe(100);
    expect(root.layout.height).toBe(50);
    expect(root.layout.scrollWidth).toBe(100);
    expect(a.layout).toEqual({
      left: 0,
      top: 0,
      width: 50,
      height: 50,
      scrollWidth: 50,
      scrollHeight: 50,
    });
    expect(b.layout).toEqual({
      left: 50,
      top: 0,
      width: 50,
      height: 50,
      scrollWidth: 50,
      scrollHeight: 50,
    });
  });
});

describe('relayout boundary rounding correctness (regression: seed 1283320469)', () => {
  /**
   * Regression test for the Phase 3 relayout-boundary rounding divergence
   * caught by the fuzzer with seed 1283320469.
   *
   * Tree structure:
   *   root (height=1, column-reverse)
   *   ├── child0 (height=1, flexShrink=1, row)
   *   └── child1 (height=1, flexShrink=1, column-reverse)
   *       └── grandchild (width=1, height=5, column-reverse)  ← boundary
   *           ├── ggc0 (height=1, flexShrink=1, row)          ← node[4]
   *           └── ggc1 (height=1, flexShrink=1, row)
   *
   * Root is 20×10 but has explicit height=1, so root.height=1.
   * child0 and child1 each have flexShrink=1 → they share the 1-unit main
   * axis, each getting 0.5 (float) before rounding. grandchild has explicit
   * height=5 and no flexShrink, so it overflows child1's box (float height
   * 0.5) and gets top = 0.5 - 5 = -4.5 (float) from the column-reverse flip.
   * After rounding, grandchild.top = -4.
   *
   * After mutation (ggc0.setMargin(Edge.All, 2)):
   * - ggc0 is dirtied → grandchild is dirtied (boundary) → child1+root get
   *   _hasDirtyDescendant = true.
   * - Cached path: root cache-hit → child1 cache-hit (restores grandchild.top=-4
   *   from rounded cache) → grandchild dirty (boundary re-layout with innerMain=1).
   * - Cold path: full recompute gives grandchild.top=-4.5 (float).
   *
   * The bug: roundLayoutSubtree used grandchild._layout.top=-4 (rounded, from
   * cache) as the anchor for computing ggc0's absolute Y. The correct anchor is
   * the float -4.5. Using -4 shifted ggc0.absY from -2.0 to -1.5, and
   * Math.round(-1.5)=-1 while Math.round(-2.0)=-2, so ggc0.top came out 3
   * (cached) vs 2 (cold).
   *
   * Fix: cache records the pre-rounding float left/top (Node._floatLeft/Top)
   * alongside the rounded positions; roundLayoutSubtree and the cache-hit walk
   * use the float values for absolute coordinate computation.
   */
  it('cached and cold paths produce identical layouts after boundary mutation with float-rounding edge case', () => {
    // Build tree
    const root = Node.create();
    root.setHeight(1);
    root.setFlexDirection('column-reverse');

    const child0 = Node.create();
    child0.setHeight(1);
    child0.setFlexShrink(1);
    child0.setFlexDirection('row');
    root.insertChild(child0, 0);

    const child1 = Node.create();
    child1.setHeight(1);
    child1.setFlexShrink(1);
    child1.setFlexDirection('column-reverse');
    root.insertChild(child1, 1);

    const grandchild = Node.create();
    grandchild.setWidth(1);
    grandchild.setHeight(5);
    grandchild.setFlexDirection('column-reverse');
    child1.insertChild(grandchild, 0);

    const ggc0 = Node.create();
    ggc0.setHeight(1);
    ggc0.setFlexShrink(1);
    ggc0.setFlexDirection('row');
    grandchild.insertChild(ggc0, 0);

    const ggc1 = Node.create();
    ggc1.setHeight(1);
    ggc1.setFlexShrink(1);
    ggc1.setFlexDirection('row');
    grandchild.insertChild(ggc1, 1);

    // Prime the caches
    root.calculateLayout(20, 10);

    // Mutation: add margin=2 to ggc0 (makes grandchild's flex distribution
    // produce a float ggc0.top that when anchored to the rounded grandchild.top
    // crosses a rounding threshold unless we use the float anchor)
    ggc0.setMargin(Edge.All, 2);

    // Cached path
    root.calculateLayout(20, 10);
    const cachedSnap = snapshotTreeLayouts(root);

    // Cold path: force full recompute
    clearAllCaches(root);
    markDirtyDeep(root);
    root.calculateLayout(20, 10);
    const coldSnap = snapshotTreeLayouts(root);

    const diff = diffLayouts(cachedSnap, coldSnap);
    expect(diff).toBe('');

    // Verify ggc0 specifically (node[4]) — this was the diverging node
    expect(cachedSnap[4]!.top).toBe(coldSnap[4]!.top);
  });
});
