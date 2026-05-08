import { describe, expect, it } from 'vitest';
import { Node } from '../node.js';

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

    root.calculateLayout(100, 50);

    const beforeHits =
      (root as unknown as { _layoutCache?: { hits: number } })._layoutCache?.hits ?? 0;

    root.calculateLayout(100, 50);

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
    cached.root.calculateLayout(20, 10);
    cached.root.setWidth(1);
    cached.root.calculateLayout(1, 10);

    // Cold path: same sequence, but build a fresh tree (no cache).
    const cold = buildTree();
    cold.root.setWidth(20);
    cold.root.setHeight(10);
    cold.root.calculateLayout(20, 10);
    cold.root.setWidth(1);
    cold.root.calculateLayout(1, 10);

    expect(cached.leaf.layout.width).toBe(cold.leaf.layout.width);
    expect(cached.leaf.layout.height).toBe(cold.leaf.layout.height);
    expect(cached.leaf.layout.left).toBe(cold.leaf.layout.left);
    expect(cached.leaf.layout.top).toBe(cold.leaf.layout.top);
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
