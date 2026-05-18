import { describe, expect, it, vi } from 'vitest';
// Differential mode runs calculateLayout twice (cached + cold pass), which
// causes extra measure calls that break the measure-cache hit counter test.
const DIFFERENTIAL = process.env.PILATES_DIFFERENTIAL_LAYOUT === '1';
import { LayoutCache, MeasureCache, clearAllCaches } from './algorithm/cache.js';
import { calculateLayoutImperative } from './algorithm/index.js';
import { Edge } from './edge.js';
import { MeasureMode } from './measure-func.js';
import { Node } from './node.js';

describe('Node — defaults', () => {
  it('starts with sensible CSS-Flexbox defaults', () => {
    const n = Node.create();
    const s = n.style;
    expect(s.flexDirection).toBe('column');
    expect(s.flexWrap).toBe('nowrap');
    expect(s.flexGrow).toBe(0);
    expect(s.flexShrink).toBe(0);
    expect(s.flexBasis).toBe('auto');
    expect(s.width).toBe('auto');
    expect(s.height).toBe('auto');
    expect(s.justifyContent).toBe('flex-start');
    expect(s.alignItems).toBe('stretch');
    expect(s.alignContent).toBe('flex-start');
    expect(s.alignSelf).toBe('auto');
    expect(s.positionType).toBe('relative');
    expect(s.display).toBe('flex');
    expect(s.padding).toEqual([0, 0, 0, 0]);
    expect(s.margin).toEqual([0, 0, 0, 0]);
    expect(s.position).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('starts with zeroed computed layout', () => {
    expect(Node.create().getComputedLayout()).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      scrollWidth: 0,
      scrollHeight: 0,
    });
  });

  it('starts dirty (never been laid out)', () => {
    expect(Node.create().isDirty()).toBe(true);
  });
});

describe('Node — public surface immutability (type-level)', () => {
  // These directives confirm that the public types of `style` and `layout`
  // are `Readonly<...>` so external callers can't bypass `markDirty()` by
  // mutating fields directly. The `@ts-expect-error` lines fail typecheck
  // if the field type ever loosens to mutable.
  it('rejects external mutation of style at the type level', () => {
    const n = Node.create();
    // @ts-expect-error — `style` is exposed as Readonly<Style>; mutate via setX().
    n.style.flexGrow = 99;
    // Runtime is still mutable (the cast is type-only). The point of the
    // typecheck guard is to catch the mistake at compile time — the runtime
    // fact below just makes it visible that the directive isn't lying.
    expect(n.style.flexGrow).toBe(99);
  });

  it('rejects external mutation of layout at the type level', () => {
    const n = Node.create();
    // @ts-expect-error — `layout` is exposed as Readonly<ComputedLayout>.
    n.layout.left = 99;
    expect(n.layout.left).toBe(99);
  });
});

describe('Node — flex shorthand', () => {
  it('positive flex sets grow and basis 0', () => {
    const n = Node.create();
    n.setFlex(3);
    expect(n.style.flexGrow).toBe(3);
    expect(n.style.flexShrink).toBe(1);
    expect(n.style.flexBasis).toBe(0);
  });

  it('zero flex resets shorthand', () => {
    const n = Node.create();
    n.setFlex(2);
    n.setFlex(0);
    expect(n.style.flexGrow).toBe(0);
    expect(n.style.flexShrink).toBe(0);
    expect(n.style.flexBasis).toBe('auto');
  });

  it('negative flex maps to shrink-only', () => {
    const n = Node.create();
    n.setFlex(-2);
    expect(n.style.flexGrow).toBe(0);
    expect(n.style.flexShrink).toBe(2);
    expect(n.style.flexBasis).toBe('auto');
  });

  it('rejects non-finite flex values', () => {
    expect(() => Node.create().setFlex(Number.NaN)).toThrow(/flex must be finite/);
  });
});

describe('Node — sizing setters', () => {
  it('width and height accept numbers and "auto"', () => {
    const n = Node.create();
    n.setWidth(40);
    n.setHeight(10);
    expect(n.style.width).toBe(40);
    expect(n.style.height).toBe(10);
    n.setWidth('auto');
    n.setHeight('auto');
    expect(n.style.width).toBe('auto');
    expect(n.style.height).toBe('auto');
  });

  it('rejects negative widths', () => {
    expect(() => Node.create().setWidth(-1)).toThrow(/non-negative/);
  });

  it('clamps negative flexGrow / flexShrink to 0', () => {
    const n = Node.create();
    n.setFlexGrow(-1);
    n.setFlexShrink(-2);
    expect(n.style.flexGrow).toBe(0);
    expect(n.style.flexShrink).toBe(0);
  });

  it('max-width undefined removes the bound', () => {
    const n = Node.create();
    n.setMaxWidth(100);
    expect(n.style.maxWidth).toBe(100);
    n.setMaxWidth(undefined);
    expect(n.style.maxWidth).toBeUndefined();
  });
});

describe('Node — Edge writes', () => {
  it('Edge.All sets all four sides', () => {
    const n = Node.create();
    n.setPadding(Edge.All, 2);
    expect(n.style.padding).toEqual([2, 2, 2, 2]);
  });

  it('Edge.Horizontal sets left and right only', () => {
    const n = Node.create();
    n.setPadding(Edge.Horizontal, 3);
    // padding tuple is [top, right, bottom, left]
    expect(n.style.padding).toEqual([0, 3, 0, 3]);
  });

  it('Edge.Vertical sets top and bottom only', () => {
    const n = Node.create();
    n.setMargin(Edge.Vertical, 1);
    expect(n.style.margin).toEqual([1, 0, 1, 0]);
  });

  it('individual edges write only that side', () => {
    const n = Node.create();
    n.setPadding(Edge.Top, 5);
    n.setPadding(Edge.Right, 6);
    n.setPadding(Edge.Bottom, 7);
    n.setPadding(Edge.Left, 8);
    expect(n.style.padding).toEqual([5, 6, 7, 8]);
  });

  it('position edges accept undefined to unconstrain', () => {
    const n = Node.create();
    n.setPositionType('absolute');
    n.setPosition(Edge.Top, 4);
    n.setPosition(Edge.Left, 0);
    expect(n.style.position).toEqual([4, undefined, undefined, 0]);
    n.setPosition(Edge.Top, undefined);
    expect(n.style.position).toEqual([undefined, undefined, undefined, 0]);
  });

  it('rejects negative padding', () => {
    expect(() => Node.create().setPadding(Edge.Top, -1)).toThrow(/non-negative/);
  });
});

describe('Node — gap', () => {
  it('row and column gap are independent', () => {
    const n = Node.create();
    n.setGap('row', 1);
    n.setGap('column', 2);
    expect(n.style.gapRow).toBe(1);
    expect(n.style.gapColumn).toBe(2);
  });
});

describe('Node — tree mutation', () => {
  it('insertChild attaches child and parent', () => {
    const parent = Node.create();
    const child = Node.create();
    parent.insertChild(child, 0);
    expect(parent.getChildCount()).toBe(1);
    expect(parent.getChild(0)).toBe(child);
    expect(child.getParent()).toBe(parent);
    expect(child.isRoot()).toBe(false);
    expect(parent.isRoot()).toBe(true);
  });

  it('insertChild clamps the index', () => {
    const parent = Node.create();
    const a = Node.create();
    const b = Node.create();
    const c = Node.create();
    parent.insertChild(a, 0);
    parent.insertChild(b, 999);
    parent.insertChild(c, -5);
    expect(parent.getChildren()).toEqual([c, a, b]);
  });

  it('removeChild detaches', () => {
    const parent = Node.create();
    const child = Node.create();
    parent.insertChild(child, 0);
    parent.removeChild(child);
    expect(parent.getChildCount()).toBe(0);
    expect(child.getParent()).toBeNull();
  });

  it('rejects inserting a node that already has a parent', () => {
    const parent = Node.create();
    const other = Node.create();
    const child = Node.create();
    parent.insertChild(child, 0);
    expect(() => other.insertChild(child, 0)).toThrow(/already has a parent/);
  });

  it('rejects inserting a node into itself', () => {
    const n = Node.create();
    expect(() => n.insertChild(n, 0)).toThrow(/itself/);
  });
});

describe('Node — measure function', () => {
  it('setMeasureFunc rejects nodes that have children', () => {
    const parent = Node.create();
    parent.insertChild(Node.create(), 0);
    expect(() => parent.setMeasureFunc(() => ({ width: 0, height: 0 }))).toThrow(
      /measure function/,
    );
  });

  it('insertChild rejects nodes that have a measure function', () => {
    const leaf = Node.create();
    leaf.setMeasureFunc(() => ({ width: 0, height: 0 }));
    expect(() => leaf.insertChild(Node.create(), 0)).toThrow(/measure function/);
  });

  it('round-trips the measure function', () => {
    const fn = vi.fn(() => ({ width: 5, height: 1 }));
    const n = Node.create();
    n.setMeasureFunc(fn);
    expect(n.getMeasureFunc()).toBe(fn);
    // Sanity-check the documented signature compiles and runs.
    const out = n.getMeasureFunc()!(20, MeasureMode.AtMost, 5, MeasureMode.Undefined);
    expect(out).toEqual({ width: 5, height: 1 });
  });

  it('setMeasureFunc(null) clears it', () => {
    const n = Node.create();
    n.setMeasureFunc(() => ({ width: 0, height: 0 }));
    n.setMeasureFunc(null);
    expect(n.getMeasureFunc()).toBeNull();
  });
});

describe('Node — dirty tracking', () => {
  it('any setter marks the node dirty', () => {
    const n = Node.create();
    n.clearDirty();
    expect(n.isDirty()).toBe(false);
    n.setWidth(10);
    expect(n.isDirty()).toBe(true);
  });

  it('mutating a child marks the parent dirty', () => {
    const root = Node.create();
    const child = Node.create();
    root.insertChild(child, 0);
    root.clearDirty();
    child.clearDirty();
    child.setHeight(5);
    expect(child.isDirty()).toBe(true);
    expect(root.isDirty()).toBe(true);
  });
});

describe('Node — layout entry points', () => {
  it('getComputedLayout returns a fresh object each call', () => {
    const n = Node.create();
    const a = n.getComputedLayout();
    const b = n.getComputedLayout();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('calculateLayout produces a layout for a leaf root', () => {
    const n = Node.create();
    n.setWidth(40);
    n.setHeight(10);
    n.calculateLayout();
    expect(n.getComputedLayout()).toEqual({
      left: 0,
      top: 0,
      width: 40,
      height: 10,
      scrollWidth: 40,
      scrollHeight: 10,
    });
  });
});

describe('Node — measure cache integration', () => {
  it('exposes _measureCache as undefined before setMeasureFunc', () => {
    const n = Node.create();
    expect((n as unknown as { _measureCache?: MeasureCache })._measureCache).toBeUndefined();
  });

  it('lazy-creates _measureCache on setMeasureFunc', () => {
    const n = Node.create();
    n.setMeasureFunc((w, _wm, h, _hm) => ({ width: w, height: h }));
    expect((n as unknown as { _measureCache?: MeasureCache })._measureCache).toBeInstanceOf(
      MeasureCache,
    );
  });

  it('clears _measureCache contents when markDirty is called', () => {
    const n = Node.create();
    n.setMeasureFunc((w, _wm, h, _hm) => ({ width: w, height: h }));
    const cache = (n as unknown as { _measureCache: MeasureCache })._measureCache;
    cache.store(
      { availableWidth: 5, widthMode: 'at-most', availableHeight: 3, heightMode: 'at-most' },
      { width: 5, height: 3 },
    );
    expect(
      cache.lookup({
        availableWidth: 5,
        widthMode: 'at-most',
        availableHeight: 3,
        heightMode: 'at-most',
      }),
    ).toBeDefined();
    n.markDirty();
    expect(
      cache.lookup({
        availableWidth: 5,
        widthMode: 'at-most',
        availableHeight: 3,
        heightMode: 'at-most',
      }),
    ).toBeUndefined();
  });

  it('clears _measureCache contents when setMeasureFunc is called again', () => {
    const n = Node.create();
    n.setMeasureFunc((w, _wm, h, _hm) => ({ width: w, height: h }));
    const cache = (n as unknown as { _measureCache: MeasureCache })._measureCache;
    cache.store(
      { availableWidth: 5, widthMode: 'at-most', availableHeight: 3, heightMode: 'at-most' },
      { width: 5, height: 3 },
    );
    n.setMeasureFunc((w, _wm, h, _hm) => ({ width: w * 2, height: h }));
    expect(
      cache.lookup({
        availableWidth: 5,
        widthMode: 'at-most',
        availableHeight: 3,
        heightMode: 'at-most',
      }),
    ).toBeUndefined();
  });

  it('clears _measureCache contents when setMeasureFunc(null) is called', () => {
    const n = Node.create();
    n.setMeasureFunc((w, _wm, h, _hm) => ({ width: w, height: h }));
    const cache = (n as unknown as { _measureCache: MeasureCache })._measureCache;
    cache.store(
      { availableWidth: 5, widthMode: 'at-most', availableHeight: 3, heightMode: 'at-most' },
      { width: 5, height: 3 },
    );
    n.setMeasureFunc(null);
    expect(
      cache.lookup({
        availableWidth: 5,
        widthMode: 'at-most',
        availableHeight: 3,
        heightMode: 'at-most',
      }),
    ).toBeUndefined();
    // The cache instance itself must remain — `setMeasureFunc(null)`
    // calls `clear()`, not delete; this pins the contract.
    expect((n as unknown as { _measureCache?: MeasureCache })._measureCache).toBeInstanceOf(
      MeasureCache,
    );
  });
});

describe('Node — measure cache hit during calculateLayout', () => {
  // In differential mode calculateLayout intentionally runs a cold pass that
  // clears the measure cache, so the "zero calls on second pass" invariant
  // cannot hold. Skip in that mode — coverage comes from the differential
  // check itself, not from this counter assertion.
  it.skipIf(DIFFERENTIAL)(
    'two layout passes on the same tree result in cache hits on the second pass',
    () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(50);

      const leaf = Node.create();
      let measureCalls = 0;
      leaf.setMeasureFunc((w, _wm, h, _hm) => {
        measureCalls++;
        return { width: Math.min(20, w), height: Math.min(3, h) };
      });
      root.insertChild(leaf, 0);

      calculateLayoutImperative(root, 100, 50);
      const callsAfterFirst = measureCalls;
      expect(callsAfterFirst).toBeGreaterThan(0);

      // Force a re-layout by marking the root dirty (simulates a parent-only
      // change that doesn't touch the leaf's cache).
      root.setWidth(100);
      calculateLayoutImperative(root, 100, 50);

      // Pass-2 measureCalls should be 0 — the leaf wasn't dirtied; its
      // measure cache should hit on every input combination it saw on pass 1.
      const callsOnPass2 = measureCalls - callsAfterFirst;
      expect(callsOnPass2).toBe(0);
    },
  );
});

describe('Node — relayout boundary semantics', () => {
  it('node with explicit width and height stops dirty propagation', () => {
    const root = Node.create();
    const boundary = Node.create();
    boundary.setWidth(50);
    boundary.setHeight(20);
    const leaf = Node.create();
    boundary.insertChild(leaf, 0);
    root.insertChild(boundary, 0);
    root.calculateLayout(100, 50);

    expect(root.isDirty()).toBe(false);
    expect(boundary.isDirty()).toBe(false);

    leaf.setFlexGrow(2);

    expect(leaf.isDirty()).toBe(true);
    expect(boundary.isDirty()).toBe(true);
    expect(root.isDirty()).toBe(false);
  });

  it('node with only explicit width (no height) propagates dirty up', () => {
    const root = Node.create();
    const partial = Node.create();
    partial.setWidth(50);
    const leaf = Node.create();
    partial.insertChild(leaf, 0);
    root.insertChild(partial, 0);
    root.calculateLayout(100, 50);

    leaf.setFlexGrow(2);
    expect(root.isDirty()).toBe(true);
  });

  it('toggling width to "auto" removes the boundary', () => {
    const root = Node.create();
    const node = Node.create();
    node.setWidth(50);
    node.setHeight(20);
    root.insertChild(node, 0);
    const leaf = Node.create();
    node.insertChild(leaf, 0);
    root.calculateLayout(100, 50);

    node.setWidth('auto');
    root.calculateLayout(100, 50);
    expect(root.isDirty()).toBe(false);

    leaf.setFlexGrow(2);
    expect(root.isDirty()).toBe(true);
  });

  it('absolute-positioned boundary still acts as a boundary', () => {
    const root = Node.create();
    const abs = Node.create();
    abs.setPositionType('absolute');
    abs.setWidth(30);
    abs.setHeight(15);
    const leaf = Node.create();
    abs.insertChild(leaf, 0);
    root.insertChild(abs, 0);
    root.calculateLayout(100, 50);

    leaf.setFlexGrow(2);
    expect(abs.isDirty()).toBe(true);
    expect(root.isDirty()).toBe(false);
  });

  it('_forceDirty bypasses boundary semantics for differential-mode infra', () => {
    const root = Node.create();
    const boundary = Node.create();
    boundary.setWidth(50);
    boundary.setHeight(20);
    const leaf = Node.create();
    boundary.insertChild(leaf, 0);
    root.insertChild(boundary, 0);
    root.calculateLayout(100, 50);

    (leaf as unknown as { _forceDirty: () => void })._forceDirty();
    expect(leaf.isDirty()).toBe(true);
    expect(boundary.isDirty()).toBe(true);
    expect(root.isDirty()).toBe(true);
  });
});

describe('Node — layout cache integration', () => {
  it('exposes _layoutCache as undefined initially', () => {
    const n = Node.create();
    expect((n as unknown as { _layoutCache?: LayoutCache })._layoutCache).toBeUndefined();
  });

  it('clears _layoutCache contents when markDirty is called', () => {
    const n = Node.create();
    // Plant a cache directly for the test (production path lazy-allocates
    // it via the algorithm).
    const cache = new LayoutCache();
    (n as unknown as { _layoutCache: LayoutCache })._layoutCache = cache;
    cache.store(
      {
        availableWidth: 100,
        widthMode: 'exactly',
        availableHeight: 50,
        heightMode: 'exactly',
      },
      {
        width: 100,
        height: 50,
        scrollWidth: 100,
        scrollHeight: 50,
        childLayouts: [],
      },
    );
    expect(
      cache.lookup({
        availableWidth: 100,
        widthMode: 'exactly',
        availableHeight: 50,
        heightMode: 'exactly',
      }),
    ).toBeDefined();
    n.markDirty();
    expect(
      cache.lookup({
        availableWidth: 100,
        widthMode: 'exactly',
        availableHeight: 50,
        heightMode: 'exactly',
      }),
    ).toBeUndefined();
  });

  it('clearAllCaches clears _layoutCache on every node in the subtree', () => {
    const root = Node.create();
    const child = Node.create();
    root.insertChild(child, 0);
    const rootCache = new LayoutCache();
    const childCache = new LayoutCache();
    (root as unknown as { _layoutCache: LayoutCache })._layoutCache = rootCache;
    (child as unknown as { _layoutCache: LayoutCache })._layoutCache = childCache;
    const KEY = {
      availableWidth: 50,
      widthMode: 'at-most' as const,
      availableHeight: 25,
      heightMode: 'at-most' as const,
    };
    const VAL = {
      width: 50,
      height: 25,
      scrollWidth: 50,
      scrollHeight: 25,
      childLayouts: [],
    };
    rootCache.store(KEY, VAL);
    childCache.store(KEY, VAL);
    expect(rootCache.lookup(KEY)).toBeDefined();
    expect(childCache.lookup(KEY)).toBeDefined();

    clearAllCaches(root);

    expect(rootCache.lookup(KEY)).toBeUndefined();
    expect(childCache.lookup(KEY)).toBeUndefined();
  });
});
