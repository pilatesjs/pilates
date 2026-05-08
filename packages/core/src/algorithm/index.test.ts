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
