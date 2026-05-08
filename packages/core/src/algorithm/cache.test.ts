import { describe, expect, it } from 'vitest';
import { MeasureMode } from '../measure-func.js';
import { Node } from '../node.js';
import {
  MeasureCache,
  clearAllCaches,
  diffLayouts,
  markDirtyDeep,
  snapshotTreeLayouts,
} from './cache.js';

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
