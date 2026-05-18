import { afterEach, describe, expect, it } from 'vitest';
import { Node } from '../node.js';
import { type LayoutTrace, calculateLayoutImperative, setLayoutProfiler } from './index.js';

/**
 * Differential mode runs the imperative algorithm twice and never
 * adopts the Spineless engine, so it never invokes the profiler — the
 * profiler tests below are meaningless there and skip.
 */
const DIFFERENTIAL = process.env.PILATES_DIFFERENTIAL_LAYOUT === '1';

describe('calculateLayout — layout cache hit', () => {
  it('second pass on unchanged tree hits the layout cache', () => {
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

    calculateLayoutImperative(root, 100, 50);

    const beforeHits =
      (root as unknown as { _layoutCache?: { hits: number } })._layoutCache?.hits ?? 0;

    calculateLayoutImperative(root, 100, 50);

    const afterHits =
      (root as unknown as { _layoutCache?: { hits: number } })._layoutCache?.hits ?? 0;

    // Second pass must hit the cache. (Differential mode runs the cold
    // path twice and clears caches between, so this assertion is invalid
    // there. Skip in that case.)
    if (process.env.PILATES_DIFFERENTIAL_LAYOUT !== '1') {
      expect(afterHits).toBeGreaterThan(beforeHits);
    }
  });
});

describe('calculateLayout — rounding correctness on cache hit + ancestor mutation', () => {
  it('cached and cold paths agree after an ancestor width mutation', () => {
    // Regression test for the rounding-after-restore bug the fuzzer
    // caught at run 116 during P2-T4: layout cache stores post-rounded
    // values that were computed with specific ancestor absolute
    // coordinates. If an ancestor's position changes, deep descendants'
    // absolute coordinates shift, and re-rounding after a restore would
    // produce different integer cells than a fresh recompute. This pins
    // the case so a future regression of the useCache-guard would fire
    // here, not just probabilistically in the fuzzer.
    function buildTree(): {
      root: Node;
      mid: Node;
      leaf: Node;
    } {
      const root = Node.create();
      root.setFlexDirection('row');
      const mid = Node.create();
      mid.setFlex(1);
      mid.setFlexDirection('row');
      const leaf = Node.create();
      leaf.setFlex(1);
      mid.insertChild(leaf, 0);
      root.insertChild(mid, 0);
      return { root, mid, leaf };
    }

    // Cached path: prime the cache with a layout pass at width 20, then
    // mutate root width to 1 (shifts ancestor absolute coordinates).
    const cached = buildTree();
    cached.root.setWidth(20);
    cached.root.setHeight(10);
    calculateLayoutImperative(cached.root, 20, 10);
    cached.root.setWidth(1);
    calculateLayoutImperative(cached.root, 1, 10);

    // Cold path: same sequence, but build a fresh tree (no cache).
    const cold = buildTree();
    cold.root.setWidth(20);
    cold.root.setHeight(10);
    calculateLayoutImperative(cold.root, 20, 10);
    cold.root.setWidth(1);
    calculateLayoutImperative(cold.root, 1, 10);

    expect(cached.leaf.layout.width).toBe(cold.leaf.layout.width);
    expect(cached.leaf.layout.height).toBe(cold.leaf.layout.height);
    expect(cached.leaf.layout.left).toBe(cold.leaf.layout.left);
    expect(cached.leaf.layout.top).toBe(cold.leaf.layout.top);
  });
});

describe.skipIf(DIFFERENTIAL)('calculateLayout — setLayoutProfiler (phase 9)', () => {
  afterEach(() => setLayoutProfiler(null));

  const fixedRow = (): Node => {
    const root = Node.create();
    root.setWidth(120);
    root.setHeight(40);
    root.setFlexDirection('row');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(30);
      root.insertChild(c, i);
    }
    return root;
  };

  it('fires once per calculateLayout with the laid-out root', () => {
    const root = fixedRow();
    const traces: Array<{ root: Node; trace: LayoutTrace }> = [];
    setLayoutProfiler((r, t) => traces.push({ root: r, trace: t }));
    root.calculateLayout(120, 40);
    expect(traces).toHaveLength(1);
    expect(traces[0]!.root).toBe(root);
  });

  it('reports imperative for the cold first layout, then build, then incremental', () => {
    const root = fixedRow();
    const paths: string[] = [];
    setLayoutProfiler((_r, t) => paths.push(t.path));
    root.calculateLayout(120, 40); // cold — imperative path
    root.calculateLayout(120, 40); // 2nd layout — Spineless adopts, builds
    root.getChild(0)!.setWidth(50);
    root.calculateLayout(120, 40); // value mutation — incremental
    expect(paths).toEqual(['imperative', 'build', 'incremental']);
  });

  it('setLayoutProfiler(null) stops the callbacks', () => {
    const root = fixedRow();
    let calls = 0;
    setLayoutProfiler(() => {
      calls++;
    });
    root.calculateLayout(120, 40);
    expect(calls).toBe(1);
    setLayoutProfiler(null);
    root.calculateLayout(120, 40);
    expect(calls).toBe(1);
  });

  it('a tree the grammar cannot cover always reports imperative', () => {
    // A measure function on an absolute node is the one feature the
    // grammar still does not model (`display: 'none'` is covered as
    // of v29) — such a tree stays on the imperative path forever.
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(40);
    const abs = Node.create();
    abs.setPositionType('absolute');
    abs.setMeasureFunc(() => ({ width: 10, height: 10 }));
    root.insertChild(abs, 0);
    const paths: string[] = [];
    setLayoutProfiler((_r, t) => paths.push(t.path));
    root.calculateLayout(100, 40);
    root.calculateLayout(100, 40);
    expect(paths).toEqual(['imperative', 'imperative']);
  });
});

describe('calculateLayout — differential mode', () => {
  it('produces correct layout regardless of differential setting', () => {
    // Sanity test only. The differential wrapper reads
    // `PILATES_DIFFERENTIAL_LAYOUT` once at module import; we can't
    // toggle it at runtime, so this test runs in whichever mode the
    // process started in. The CI step `pnpm test:differential` runs
    // the entire suite with the env var ON — that's what gives the
    // differential check its coverage. This file just pins one
    // straightforward layout case so it would visibly fail if the
    // wrapper itself broke `calculateLayout` for the off path.
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(50);
    const child = Node.create();
    child.setFlex(1);
    root.insertChild(child, 0);
    root.calculateLayout(100, 50);
    expect(root.layout.width).toBe(100);
    expect(child.layout.width).toBe(100);
  });
});
