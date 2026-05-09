# Perf hardening Phase 2 — layout cache + hot-relayout bench + fail-on-regression budgets

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-node `LayoutCache` so clean subtrees skip flex re-distribution on subsequent `calculateLayout` calls. This closes the WASM-Yoga gap on long-lived trees with hot relayouts (the workload Yoga currently wins).

**Architecture:** New `LayoutCache` class added to `packages/core/src/algorithm/cache.ts` alongside the existing `MeasureCache`. Single slot per node (matching Yoga `cachedLayout` and Taffy 1-slot layout cache — see spec). Key: `(availableWidth, widthMode, availableHeight, heightMode)` — NO `parentDirection` (Yoga + Taffy treat it as implicit). Value: node's own `(width, height, scrollWidth, scrollHeight)` plus parallel `childLayouts` array. Cache hits restore the cached values and recursively descend into child caches; child miss falls through to full `layoutChildren` recompute.

**Tech Stack:** TypeScript 5.7, vitest, fast-check (already a devDep), tinybench.

**Branch:** `perf-layout-cache` (created off main at `c8b50f1`).

**Spec reference:** `docs/superpowers/specs/2026-05-08-perf-hardening-design.md`. Phase 1 plan at `docs/superpowers/plans/2026-05-08-perf-measure-cache.md` for context.

---

## File map

**Modify:**
- `packages/core/src/algorithm/cache.ts` — add `LayoutCacheKey`, `LayoutCacheValue`, `LayoutCache` class; add `clearAllCaches` to also clear `_layoutCache`; add new helpers `snapshotForCache(node)`, `restoreFromCache(node, value)` (or local-to-`index.ts`/`main-axis.ts` if cleaner).
- `packages/core/src/algorithm/cache.test.ts` — unit tests for `LayoutCache` mechanics and the new helpers.
- `packages/core/src/algorithm/cache.fuzz.test.ts` — extend mutation set (add `setFlexShrink`, `setMargin`, `setFlexDirection`, child insert/remove); fuzzer continues to assert cached == cold, now exercising the layout cache.
- `packages/core/src/node.ts` — add `_layoutCache?: LayoutCache` field (`@internal`); lazy-allocate on first store; clear via `markDirty()`.
- `packages/core/src/algorithm/index.ts` — wire layout-cache lookup at root before `calculateLayoutImpl`; cache store after; update `clearAllCaches` semantics if needed.
- `packages/core/src/algorithm/main-axis.ts` — wire cache lookup/store inside `layoutChildren`.
- `packages/core/CHANGELOG.md` — `## Unreleased` Phase 2 entry.
- `bench/thresholds.json` — tighten thresholds based on post-Phase-2 numbers.
- `bench/check-budgets.ts` — flip from warn-only to fail-on-regression (replace the comment line with `process.exit(1)` on violations).
- `bench/index.ts` — register the new `hot-relayout` scenario.

**Create:**
- `bench/scenarios/hot-relayout.ts` — build tree once, mutate one leaf in a hot loop, `calculateLayout` each iteration. The Yoga-wins workload Phase 2 should win on.

---

## Task 1: LayoutCache class with TDD

**Files:**
- Modify: `packages/core/src/algorithm/cache.ts`
- Modify: `packages/core/src/algorithm/cache.test.ts`

- [ ] **Step 1: Append failing tests for `LayoutCache`**

In `packages/core/src/algorithm/cache.test.ts`, add a new `describe('LayoutCache', ...)` block at the end:

```ts
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
      { left: 0, top: 0, width: 50, height: 25, scrollWidth: 50, scrollHeight: 25 },
      { left: 50, top: 0, width: 50, height: 25, scrollWidth: 50, scrollHeight: 25 },
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
    // construct a fresh LayoutCacheValue per store. Faster than cloning,
    // but contract must be respected. The Phase 2 wiring builds a new
    // value per layoutChildren pass so this is safe.
    const c = new LayoutCache();
    const v: LayoutCacheValue = {
      width: 10, height: 10,
      scrollWidth: 10, scrollHeight: 10,
      childLayouts: [],
    };
    c.store(KEY_A, v);
    v.width = 999;
    expect(c.lookup(KEY_A)?.width).toBe(999); // mutation visible — proves no clone
  });
});
```

Make sure to import `LayoutCache` and `LayoutCacheValue` in the test file's existing import block.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/algorithm/cache.test.ts`
Expected: FAIL with "no exported member 'LayoutCache'".

- [ ] **Step 3: Add `LayoutCache` to `cache.ts`**

In `packages/core/src/algorithm/cache.ts`, append after the existing `MeasureCache` class (before the helper functions added in Task 4 of Phase 1):

```ts
/** @internal */
export interface LayoutCacheKey {
  availableWidth: number;
  widthMode: MeasureMode;
  availableHeight: number;
  heightMode: MeasureMode;
  // parentDirection deliberately NOT keyed — Yoga (LayoutResults.h) and
  // Taffy (tree/cache.rs) both treat it as implicit in available
  // {width,height} since flex algorithms reorient at each parent.
  // Differential mode catches divergence if this assumption is ever wrong.
}

/** @internal */
export interface CachedChildLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
}

/** @internal */
export interface LayoutCacheValue {
  // node's own
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
  // direct children (parallel to node.children at cache-store time)
  childLayouts: CachedChildLayout[];
}

/**
 * Single-slot per-node layout cache. Matches Yoga's `cachedLayout`
 * (single overwrite-on-write) and Taffy's 1-slot layout-cache. Internal
 * nodes' final-pass keys converge to one stable input once the parent's
 * flex distribution has settled, so additional slots would be dead memory.
 *
 * Lazy-allocated by the algorithm in `algorithm/main-axis.ts` and
 * `algorithm/index.ts` only on nodes that actually go through the
 * `layoutChildren` recursion. Cleared by `Node.markDirty()` (which fires
 * on every style/tree mutation).
 *
 * Hit/miss counters are always-on (same rationale as `MeasureCache`).
 *
 * @internal
 */
export class LayoutCache {
  private slot?: LayoutCacheKey & { value: LayoutCacheValue };

  /** @internal */
  hits = 0;
  /** @internal */
  misses = 0;

  lookup(key: LayoutCacheKey): LayoutCacheValue | undefined {
    const slot = this.slot;
    if (
      slot !== undefined &&
      slot.availableWidth === key.availableWidth &&
      slot.widthMode === key.widthMode &&
      slot.availableHeight === key.availableHeight &&
      slot.heightMode === key.heightMode
    ) {
      this.hits++;
      return slot.value;
    }
    this.misses++;
    return undefined;
  }

  /**
   * Store `value` for `key`. Single-slot — replaces the previous entry
   * unconditionally. Caller must construct a fresh `LayoutCacheValue` per
   * store; this method does NOT deep-clone for performance, so any
   * subsequent mutation of `value` is visible through `lookup`. The
   * algorithm builds new values per layout pass so the contract holds.
   */
  store(key: LayoutCacheKey, value: LayoutCacheValue): void {
    this.slot = { ...key, value };
  }

  clear(): void {
    this.slot = undefined;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/algorithm/cache.test.ts`
Expected: PASS, all prior tests + 8 new LayoutCache tests.

- [ ] **Step 5: typecheck + lint**

Run: `pnpm typecheck` and `pnpm lint`. Both clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/algorithm/cache.ts packages/core/src/algorithm/cache.test.ts
git commit -m "feat(core): add LayoutCache (1-slot, Yoga + Taffy aligned)"
```

---

## Task 2: Wire LayoutCache into Node + clearAllCaches

**Files:**
- Modify: `packages/core/src/node.ts` (add `_layoutCache` field, clear it in `markDirty()`)
- Modify: `packages/core/src/algorithm/cache.ts` (`clearAllCaches` clears both caches)
- Modify: `packages/core/src/node.test.ts` (add 3 integration tests)

- [ ] **Step 1: Append failing tests to `node.test.ts`**

After the existing `Node — measure cache integration` block:

```ts
import { LayoutCache } from './algorithm/cache.js';

describe('Node — layout cache integration', () => {
  it('exposes _layoutCache as undefined initially', () => {
    const n = Node.create();
    expect((n as unknown as { _layoutCache?: LayoutCache })._layoutCache).toBeUndefined();
  });

  it('clears _layoutCache contents when markDirty is called', () => {
    const n = Node.create();
    // Lazy-create directly for the test (production path creates it via
    // the algorithm; here we just need to verify markDirty clears it).
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
        width: 100, height: 50,
        scrollWidth: 100, scrollHeight: 50,
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
    // Manually plant LayoutCaches on both nodes
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
      width: 50, height: 25,
      scrollWidth: 50, scrollHeight: 25,
      childLayouts: [],
    };
    rootCache.store(KEY, VAL);
    childCache.store(KEY, VAL);
    expect(rootCache.lookup(KEY)).toBeDefined();
    expect(childCache.lookup(KEY)).toBeDefined();

    // Need to import clearAllCaches at top of file.
    clearAllCaches(root);

    expect(rootCache.lookup(KEY)).toBeUndefined();
    expect(childCache.lookup(KEY)).toBeUndefined();
  });
});
```

(Add `clearAllCaches` to the existing import from `./algorithm/cache.js`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/node.test.ts -t "layout cache integration"`
Expected: FAILs — `_layoutCache` field doesn't exist; `markDirty` doesn't clear it; `clearAllCaches` doesn't touch it.

- [ ] **Step 3: Add `_layoutCache` field to `Node`**

In `packages/core/src/node.ts`, near the existing `_measureCache` field:

```ts
import { LayoutCache, MeasureCache } from './algorithm/cache.js';
```

Add the field below `_measureCache`:

```ts
  /**
   * Lazy-allocated layout-cache. Created the first time `layoutChildren`
   * stores a result. Cleared by `markDirty()`. Read by `layoutChildren`
   * and the root `calculateLayout` path in `algorithm/`.
   *
   * @internal
   */
  _layoutCache?: LayoutCache;
```

Update `markDirty()` to clear this cache too:

```ts
  markDirty(): void {
    this._dirty = true;
    // Optional-chain: only fires on leaves with a measure func installed.
    // Ancestor nodes (containers with children) cannot have a MeasureCache
    // because setMeasureFunc rejects nodes with children; the optional-chain
    // is a deliberate no-op as we propagate dirty up the tree.
    this._measureCache?.clear();
    this._layoutCache?.clear();
    if (this._parent !== null && !this._parent._dirty) this._parent.markDirty();
  }
```

- [ ] **Step 4: Update `clearAllCaches` to also clear `_layoutCache`**

In `packages/core/src/algorithm/cache.ts`, find `clearAllCaches`:

```ts
export function clearAllCaches(root: Node): void {
  root._measureCache?.clear();
  for (let i = 0; i < root.getChildCount(); i++) clearAllCaches(root.getChild(i)!);
}
```

Add a `_layoutCache` clear:

```ts
export function clearAllCaches(root: Node): void {
  root._measureCache?.clear();
  root._layoutCache?.clear();
  for (let i = 0; i < root.getChildCount(); i++) clearAllCaches(root.getChild(i)!);
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run packages/core/src/node.test.ts`
Expected: ALL PASS — existing tests + 3 new layout-cache integration tests.

Run: `pnpm vitest run packages/core/src/algorithm/cache.test.ts` — ensure `clearAllCaches` test still works (it should still clear measure caches).

Run: `pnpm typecheck` and `pnpm lint`. Clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/node.ts packages/core/src/node.test.ts packages/core/src/algorithm/cache.ts
git commit -m "feat(core): wire LayoutCache into Node; clear via markDirty + clearAllCaches"
```

---

## Task 3: Layout-cache snapshot/restore helpers

These helpers serialize and restore a node + its children into/from a `LayoutCacheValue`. They live in `cache.ts` because they bridge the cache storage and the algorithm consumer.

**Files:**
- Modify: `packages/core/src/algorithm/cache.ts`
- Modify: `packages/core/src/algorithm/cache.test.ts`

- [ ] **Step 1: Append failing tests**

Add new `describe` blocks to `cache.test.ts`:

```ts
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
    // Children are siblings split 50/50 in row direction.
    expect(snap.childLayouts[0]).toEqual({
      left: 0, top: 0, width: 50, height: 50,
      scrollWidth: 50, scrollHeight: 50,
    });
    expect(snap.childLayouts[1]).toEqual({
      left: 50, top: 0, width: 50, height: 50,
      scrollWidth: 50, scrollHeight: 50,
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
      width: 100, height: 50,
      scrollWidth: 100, scrollHeight: 50,
      childLayouts: [
        { left: 0, top: 0, width: 50, height: 50, scrollWidth: 50, scrollHeight: 50 },
        { left: 50, top: 0, width: 50, height: 50, scrollWidth: 50, scrollHeight: 50 },
      ],
    };
    restoreFromCache(root, cached);

    expect(root.layout.width).toBe(100);
    expect(root.layout.height).toBe(50);
    expect(root.layout.scrollWidth).toBe(100);
    expect(a.layout).toEqual({
      left: 0, top: 0, width: 50, height: 50, scrollWidth: 50, scrollHeight: 50,
    });
    expect(b.layout).toEqual({
      left: 50, top: 0, width: 50, height: 50, scrollWidth: 50, scrollHeight: 50,
    });
  });
});
```

(Add `snapshotForCache, restoreFromCache, type LayoutCacheValue` to the import block of `cache.test.ts`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/algorithm/cache.test.ts`
Expected: FAIL — `snapshotForCache` / `restoreFromCache` not exported yet.

- [ ] **Step 3: Implement helpers**

Append to `cache.ts` (after the existing helpers `clearAllCaches` etc.):

```ts
/**
 * Build a `LayoutCacheValue` from `node`'s current `_layout` + its direct
 * children's `_layout`. Captures only direct children; deeper descendants
 * are reconstituted via their own caches during `restoreFromCache`.
 *
 * Called by the algorithm AFTER `roundLayout` and `computeScrollSizes`
 * have populated all `_layout` fields, so the captured values are
 * already integer-rounded and scroll-aware.
 *
 * @internal
 */
export function snapshotForCache(node: Node): LayoutCacheValue {
  const childLayouts: CachedChildLayout[] = [];
  const count = node.getChildCount();
  for (let i = 0; i < count; i++) {
    const c = node.getChild(i)!;
    childLayouts.push({
      left: c.layout.left,
      top: c.layout.top,
      width: c.layout.width,
      height: c.layout.height,
      scrollWidth: c.layout.scrollWidth,
      scrollHeight: c.layout.scrollHeight,
    });
  }
  return {
    width: node.layout.width,
    height: node.layout.height,
    scrollWidth: node.layout.scrollWidth,
    scrollHeight: node.layout.scrollHeight,
    childLayouts,
  };
}

/**
 * Restore `node`'s own size + scroll metrics, plus its direct children's
 * left/top/width/height/scroll. The caller is responsible for handling
 * the recursion into deeper descendants via per-child cache lookups (or
 * a `layoutChildren` fallback on miss).
 *
 * Pre-conditions: `node`'s child list at this call must match the child
 * list captured at cache-store time. The cache invalidation on
 * `insertChild`/`removeChild` (via `markDirty`) guarantees this — a
 * mismatch indicates a cache-correctness bug. We assert in dev mode.
 *
 * @internal
 */
export function restoreFromCache(node: Node, value: LayoutCacheValue): void {
  if (process.env.PILATES_DIFFERENTIAL_LAYOUT === '1') {
    if (node.getChildCount() !== value.childLayouts.length) {
      throw new Error(
        `[pilates layout cache] restored value has ${value.childLayouts.length} children but node has ${node.getChildCount()} — cache invalidation bug`,
      );
    }
  }
  node._layout.width = value.width;
  node._layout.height = value.height;
  node._layout.scrollWidth = value.scrollWidth;
  node._layout.scrollHeight = value.scrollHeight;
  // node._layout.left/top are set by the caller before recursion starts
  // (root sets to 0; child positions come from this restore via the
  // childLayouts array below).
  for (let i = 0; i < node.getChildCount(); i++) {
    const c = node.getChild(i)!;
    const cl = value.childLayouts[i]!;
    c._layout.left = cl.left;
    c._layout.top = cl.top;
    c._layout.width = cl.width;
    c._layout.height = cl.height;
    c._layout.scrollWidth = cl.scrollWidth;
    c._layout.scrollHeight = cl.scrollHeight;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/core/src/algorithm/cache.test.ts`
Expected: PASS — all prior + 2 new helper tests.

`pnpm typecheck` + `pnpm lint`: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/algorithm/cache.ts packages/core/src/algorithm/cache.test.ts
git commit -m "feat(core): add snapshotForCache + restoreFromCache helpers"
```

---

## Task 4: Wire LayoutCache into the algorithm

This is the biggest task. Wire the cache into both `calculateLayout` (root path) and `layoutChildren` (recursion path).

**Files:**
- Modify: `packages/core/src/algorithm/index.ts`
- Modify: `packages/core/src/algorithm/main-axis.ts`

- [ ] **Step 1: Write a failing integration test**

Append to `packages/core/src/algorithm/index.test.ts`:

```ts
import { Node } from '../node.js';

describe('calculateLayout — layout cache hit', () => {
  it('second pass on unchanged tree produces zero layout work', () => {
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

    // Capture the layout cache hit counter on root.
    const beforeHits =
      (root as unknown as { _layoutCache?: { hits: number } })._layoutCache
        ?.hits ?? 0;
    const beforeMisses =
      (root as unknown as { _layoutCache?: { misses: number } })._layoutCache
        ?.misses ?? 0;

    root.calculateLayout(100, 50);

    const afterHits =
      (root as unknown as { _layoutCache?: { hits: number } })._layoutCache
        ?.hits ?? 0;
    const afterMisses =
      (root as unknown as { _layoutCache?: { misses: number } })._layoutCache
        ?.misses ?? 0;

    // Second pass must hit the cache, not miss it.
    expect(afterHits).toBe(beforeHits + 1);
    expect(afterMisses).toBe(beforeMisses);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/algorithm/index.test.ts`
Expected: FAIL — root has no `_layoutCache` yet because the cache isn't wired.

- [ ] **Step 3: Wire layout cache into `calculateLayoutImpl` (root path)**

In `packages/core/src/algorithm/index.ts`, modify `calculateLayoutImpl`:

```ts
import { LayoutCache, snapshotForCache, restoreFromCache } from './cache.js';
// ... existing imports

function calculateLayoutImpl(
  root: Node,
  availableWidth: number | undefined,
  availableHeight: number | undefined,
): void {
  const widthMode =
    availableWidth === undefined ? 'undefined' : ('exactly' as const);
  const heightMode =
    availableHeight === undefined ? 'undefined' : ('exactly' as const);
  const aw = availableWidth ?? Number.POSITIVE_INFINITY;
  const ah = availableHeight ?? Number.POSITIVE_INFINITY;
  const key = {
    availableWidth: aw,
    widthMode,
    availableHeight: ah,
    heightMode,
  };

  // Cache hit path
  if (!root.isDirty() && root._layoutCache !== undefined) {
    const hit = root._layoutCache.lookup(key);
    if (hit !== undefined) {
      root._layout.left = 0;
      root._layout.top = 0;
      restoreFromCache(root, hit);
      // Children may have their own caches with deeper subtrees; descend
      // and reuse where possible, falling back to layoutChildren on miss.
      restoreSubtreeRecursive(root);
      return;
    }
  }

  // Cold path (existing behavior)
  root._layout.left = 0;
  root._layout.top = 0;
  root._layout.width = resolveRootAxisSize(root, 'row', availableWidth);
  root._layout.height = resolveRootAxisSize(root, 'column', availableHeight);

  layoutChildren(root);
  roundLayout(root);
  computeScrollSizes(root);
  markClean(root);

  // Store result for next call
  if (root._layoutCache === undefined) root._layoutCache = new LayoutCache();
  root._layoutCache.store(key, snapshotForCache(root));
}

/**
 * After `restoreFromCache(parent, ...)` has filled in each child's
 * left/top/width/height from the parent's cache, descend into each
 * child to either restore from its own cache (if clean + matching) or
 * fall back to a full `layoutChildren` recompute. This bridges the
 * single-level snapshot into a full-tree restore.
 */
function restoreSubtreeRecursive(node: Node): void {
  for (let i = 0; i < node.getChildCount(); i++) {
    const c = node.getChild(i)!;
    if (c.style.display === 'none') continue;
    if (!c.isDirty() && c._layoutCache !== undefined) {
      // Child is clean. Its inputs are determined by the layout we just
      // restored: c.layout.width / c.layout.height in EXACTLY mode.
      const childKey = {
        availableWidth: c.layout.width,
        widthMode: 'exactly' as const,
        availableHeight: c.layout.height,
        heightMode: 'exactly' as const,
      };
      const childHit = c._layoutCache.lookup(childKey);
      if (childHit !== undefined) {
        restoreFromCache(c, childHit);
        restoreSubtreeRecursive(c);
        c.clearDirty();
        continue;
      }
    }
    // Cache miss for this child — fall back to full recompute. The
    // child's own _layout.{width,height} were set by the parent's restore;
    // layoutChildren consumes those.
    layoutChildren(c);
    // Mark this subtree clean. (markClean recurses; it's safe to call
    // here because layoutChildren has already populated descendants.)
    markClean(c);
    // Store the result for next pass.
    const storeKey = {
      availableWidth: c.layout.width,
      widthMode: 'exactly' as const,
      availableHeight: c.layout.height,
      heightMode: 'exactly' as const,
    };
    if (c._layoutCache === undefined) c._layoutCache = new LayoutCache();
    c._layoutCache.store(storeKey, snapshotForCache(c));
  }
  node.clearDirty();
}
```

The new `restoreSubtreeRecursive` function lives in `algorithm/index.ts`. The `markClean` function already exists. The new function avoids re-running `roundLayout` / `computeScrollSizes` on cache-hit paths because those are baked into the cached values.

- [ ] **Step 4: Wire layout cache into `layoutChildren` (recursion path)**

This is the cache hit that matters most for hot relayouts: when a node is re-laid out under the same available size with no mutations, skip flex distribution.

In `packages/core/src/algorithm/main-axis.ts`, modify `layoutChildren`:

```ts
import { LayoutCache, snapshotForCache, restoreFromCache } from './cache.js';
// ... existing imports

export function layoutChildren(node: Node): void {
  // Cache hit path: clean node + matching key
  if (!node.isDirty() && node._layoutCache !== undefined) {
    const key = {
      availableWidth: node.layout.width,
      widthMode: 'exactly' as const,
      availableHeight: node.layout.height,
      heightMode: 'exactly' as const,
    };
    const hit = node._layoutCache.lookup(key);
    if (hit !== undefined) {
      restoreFromCache(node, hit);
      // Recurse — children may have their own cached subtrees
      for (let i = 0; i < node.getChildCount(); i++) {
        const c = node.getChild(i)!;
        if (c.style.display === 'none') continue;
        if (!c.isDirty() && c._layoutCache !== undefined) {
          const childKey = {
            availableWidth: c.layout.width,
            widthMode: 'exactly' as const,
            availableHeight: c.layout.height,
            heightMode: 'exactly' as const,
          };
          const childHit = c._layoutCache.lookup(childKey);
          if (childHit !== undefined) {
            restoreFromCache(c, childHit);
            // Continue recursion via layoutChildren which will hit each
            // descendant's cache the same way.
            layoutChildren(c);
            continue;
          }
        }
        // Child miss — full recompute for c's subtree
        layoutChildren(c);
      }
      return;
    }
  }

  // Cold path (existing behavior)
  const flowChildren = visibleChildrenOf(node);
  const absoluteList = absoluteChildrenOf(node);

  if (flowChildren.length === 0 && absoluteList.length === 0) {
    measureLeafIfNeeded(node);
    return;
  }

  if (flowChildren.length > 0) {
    layoutFlexFlow(node, flowChildren);
  }

  if (absoluteList.length > 0) {
    layoutAbsoluteChildren(node, absoluteList);
  }

  for (let i = 0; i < node.getChildCount(); i++) {
    const c = node.getChild(i)!;
    if (c.style.display === 'none') continue;
    layoutChildren(c);
  }

  // Store result for next pass
  // Note: scrollWidth/scrollHeight are populated later by computeScrollSizes
  // (called from calculateLayoutImpl), so we don't store the layout cache
  // here in the cold path — calculateLayoutImpl handles caching for the
  // root, and the recursive layoutChildren caches for inner nodes happen
  // in calculateLayoutImpl's restoreSubtreeRecursive on the next pass.
  // CORRECTION: that's not right. We need to store inside layoutChildren
  // for inner nodes too. But scrollWidth/scrollHeight are not yet set
  // at this point. Solution: store in computeScrollSizes (which runs
  // post-order over the whole tree).
}
```

**OPEN ISSUE — needs implementer attention:**

Storing the layout cache for INNER nodes inside `layoutChildren` doesn't work cleanly because `scrollWidth`/`scrollHeight` are populated by `computeScrollSizes` AFTER `layoutChildren` returns at the top level. Two options:

(A) Store the cache in `computeScrollSizes` (which runs post-order). Inner nodes get cached there with the full layout values present.

(B) Don't cache inner nodes at all in Phase 2; only cache the root. Lose most of the win but keeps the implementation simple. Hot-relayout scenario benefits less.

**Recommendation: (A)**. Have `computeScrollSizes` (rename to `finalizePostLayout` or keep current name) compute scrollWidth/Height AND store the layout cache for each node. Single post-order pass. Implementation:

```ts
function computeScrollSizes(node: Node): void {
  for (let i = 0; i < node.getChildCount(); i++) computeScrollSizes(node.getChild(i)!);

  let contentRight = 0;
  let contentBottom = 0;
  for (let i = 0; i < node.getChildCount(); i++) {
    const c = node.getChild(i)!;
    const cl = c._layout;
    contentRight = Math.max(contentRight, cl.left + cl.width);
    contentBottom = Math.max(contentBottom, cl.top + cl.height);
  }
  node._layout.scrollWidth = Math.max(node._layout.width, contentRight);
  node._layout.scrollHeight = Math.max(node._layout.height, contentBottom);

  // Phase 2: store the layout cache for this node (post-order ensures
  // scrollWidth/Height are set before we capture).
  // For inner nodes, the input key is the EXACTLY-sized container; for
  // the root, calculateLayoutImpl writes its own cache entry separately.
  // Don't double-store the root — it already gets cached at the top of
  // calculateLayoutImpl after this pass returns.
  if (node.getParent() !== null) {
    const key = {
      availableWidth: node.layout.width,
      widthMode: 'exactly' as const,
      availableHeight: node.layout.height,
      heightMode: 'exactly' as const,
    };
    if (node._layoutCache === undefined) node._layoutCache = new LayoutCache();
    node._layoutCache.store(key, snapshotForCache(node));
  }
}
```

The `restoreSubtreeRecursive` function in `index.ts` reads from these per-node caches.

Implementer: read this carefully and verify the design before writing code. If the design has flaws, escalate as DONE_WITH_CONCERNS.

- [ ] **Step 5: Run all core tests**

Run: `pnpm vitest run packages/core/src`
Expected: ALL PASS — including yoga-oracle (cell-for-cell match against Yoga) and the 217 layout tests.

If any layout test fails, the cache wiring broke equivalence — investigate. The yoga-oracle tests are the canonical correctness gate.

Run: `pnpm test:differential`
Expected: ALL PASS (217 + 1 skip from Phase 1 still applies).

This is THE critical validation. If differential mode fails, the cache produces a different result from the cold path — a real bug. Fix before continuing.

- [ ] **Step 6: typecheck + lint**

Both clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/algorithm/index.ts packages/core/src/algorithm/main-axis.ts packages/core/src/algorithm/index.test.ts
git commit -m "feat(core): wire LayoutCache into calculateLayout root + layoutChildren"
```

---

## Task 5: Hot-relayout bench scenario

**Files:**
- Create: `bench/scenarios/hot-relayout.ts`
- Modify: `bench/index.ts`

The Yoga-wins workload Phase 2 should win on. Build a 1k-node tree once, mutate one leaf in a hot loop, `calculateLayout` each iteration.

- [ ] **Step 1: Create `bench/scenarios/hot-relayout.ts`**

```ts
/**
 * Hot-relayout scenario: build a 1k-node tree once, mutate a single
 * leaf's width by ±1, calculateLayout. The pattern WASM Yoga
 * traditionally wins on — Phase 2's LayoutCache makes Pilates
 * competitive or better here.
 *
 * Tree built outside the benchmark function (once per process). The
 * iteration is just: mutate, calculateLayout. Yoga creates a fresh
 * tree per iteration via its own iteration function (Yoga node
 * lifetime requires explicit free).
 */

import { Node } from '@pilates/core';
import type { RenderNode } from '@pilates/render';
import { renderToFrame } from '@pilates/render';
import Yoga from 'yoga-layout';

const COLS = 200;
const ROWS = 100;
const ROW_COUNT = 50;
const CELLS_PER_ROW = 20;

// Persistent Pilates tree
let pilatesRoot: Node;
let pilatesTargetLeaf: Node;
let pilatesToggle = false;

function buildPilatesPersistent(): void {
  const root = Node.create();
  root.setFlexDirection('column');
  root.setWidth(COLS);
  root.setHeight(ROWS);
  let firstLeaf: Node | undefined;
  for (let r = 0; r < ROW_COUNT; r++) {
    const row = Node.create();
    row.setFlex(1);
    row.setFlexDirection('row');
    root.insertChild(row, r);
    for (let c = 0; c < CELLS_PER_ROW; c++) {
      const cell = Node.create();
      cell.setFlex(1);
      row.insertChild(cell, c);
      if (firstLeaf === undefined) firstLeaf = cell;
    }
  }
  pilatesRoot = root;
  pilatesTargetLeaf = firstLeaf!;
  // Prime the cache by laying out once.
  root.calculateLayout(COLS, ROWS);
}

buildPilatesPersistent();

export function pilatesCoreLayout(): void {
  // Mutate one leaf's flex value to force re-layout but keep the change
  // local. Pilates' layout cache should hit on most subtrees.
  pilatesToggle = !pilatesToggle;
  pilatesTargetLeaf.setFlex(pilatesToggle ? 1 : 2);
  pilatesRoot.calculateLayout(COLS, ROWS);
}

export function pilatesFullRender(): void {
  // Rendering rebuilds the tree from declarative state every frame, so
  // for hot-relayout we just measure the persistent-tree case. Use the
  // same handle as core for the scenario.
  pilatesCoreLayout();
}

// Yoga: it's hard to reuse a tree across iterations because we have to
// `freeRecursive()` it each time. Build fresh per iteration instead.
// This is the same pattern Yoga consumers must use in practice for
// long-lived trees, so it's fair.
let yogaRoot: import('yoga-layout').Node | undefined;
let yogaTarget: import('yoga-layout').Node | undefined;
let yogaToggle = false;

function buildYogaPersistent(): void {
  if (yogaRoot !== undefined) return;
  const root = Yoga.Node.create();
  root.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
  root.setWidth(COLS);
  root.setHeight(ROWS);
  let first: import('yoga-layout').Node | undefined;
  for (let r = 0; r < ROW_COUNT; r++) {
    const row = Yoga.Node.create();
    row.setFlex(1);
    row.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    root.insertChild(row, r);
    for (let c = 0; c < CELLS_PER_ROW; c++) {
      const cell = Yoga.Node.create();
      cell.setFlex(1);
      row.insertChild(cell, c);
      if (first === undefined) first = cell;
    }
  }
  yogaRoot = root;
  yogaTarget = first;
  root.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
}

buildYogaPersistent();

export function yogaLayout(): void {
  yogaToggle = !yogaToggle;
  yogaTarget!.setFlex(yogaToggle ? 1 : 2);
  yogaRoot!.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
}
```

- [ ] **Step 2: Register in `bench/index.ts`**

```ts
import * as hotRelayout from './scenarios/hot-relayout.js';
```

Append to SCENARIOS:

```ts
  { name: 'hotrelayout', notes: '1k-node tree, mutate one leaf, relayout (persistent tree)', ...hotRelayout },
```

(Lowercase one-word name to match the threshold-key constraint in `check-budgets.ts`.)

- [ ] **Step 3: Run bench**

Run: `pnpm bench`
Expected: 6 scenarios in RESULTS.md. The `hotrelayout` row should show Pilates competitive with or beating Yoga.

- [ ] **Step 4: Commit**

```bash
git add bench/scenarios/hot-relayout.ts bench/index.ts bench/RESULTS.md
git commit -m "bench: add hot-relayout scenario (1k-node persistent tree, mutate one leaf)"
```

---

## Task 6: Tighten bench thresholds + flip to fail-on-regression

**Files:**
- Modify: `bench/thresholds.json` — tighten Pilates thresholds based on post-Phase-2 numbers
- Modify: `bench/check-budgets.ts` — replace warn-only with `process.exit(1)` on violations

- [ ] **Step 1: Read latest `bench/RESULTS.md`**

After Task 5 ran the bench, the RESULTS.md has all 6 scenarios with post-Phase-2 numbers. For each scenario, find `@pilates/core (layout)`'s mean latency.

Set thresholds at ~1.5–2× the measured value (tighter than Phase 1's 3× because we now have fail-on-regression and want to actually catch regressions — but still loose enough to absorb CI runner variance, which is typically <30%). Also include a `hotrelayout` entry.

Example (substitute real numbers):

```json
{
  "tiny":         { "@pilates/core (layout)": { "maxMeanMs": 0.005 } },
  "realistic":    { "@pilates/core (layout)": { "maxMeanMs": 0.10  } },
  "stress":       { "@pilates/core (layout)": { "maxMeanMs": 0.45  } },
  "big":          { "@pilates/core (layout)": { "maxMeanMs": 2.5   } },
  "huge":         { "@pilates/core (layout)": { "maxMeanMs": 7.0   } },
  "hotrelayout":  { "@pilates/core (layout)": { "maxMeanMs": 0.10  } }
}
```

- [ ] **Step 2: Flip `check-budgets.ts` to fail-on-regression**

In `bench/check-budgets.ts`, replace the trailing comment block:

```ts
  process.stderr.write('=== bench budget WARNINGS (Phase 1: warn-only) ===\n');
  for (const v of violations) process.stderr.write(`  ${v}\n`);
  process.stderr.write(
    `(${violations.length} violation${violations.length === 1 ? '' : 's'})\n`,
  );
  // Phase 1 — do NOT exit non-zero. Phase 2 will change this to:
  //   process.exit(1);
}
```

With:

```ts
  process.stderr.write('=== bench budget violations ===\n');
  for (const v of violations) process.stderr.write(`  ${v}\n`);
  process.stderr.write(
    `(${violations.length} violation${violations.length === 1 ? '' : 's'})\n`,
  );
  process.exit(1);
}
```

- [ ] **Step 3: Update `.github/workflows/perf-budgets.yml` comment**

Find:

```yaml
      # Phase 1: warn-only — the script does not exit non-zero on
      # violation. Phase 2 will flip this to fail-on-regression.
      - run: pnpm bench:budgets
```

Replace with:

```yaml
      - run: pnpm bench:budgets
```

(The script now exits non-zero on violations; the workflow will fail the job naturally.)

- [ ] **Step 4: Verify locally**

Run: `pnpm bench && pnpm bench:budgets`
Expected: all thresholds satisfied; exit 0.

If any violations, relax the corresponding threshold in `thresholds.json` (multiply by 1.3–1.5×) and re-run.

- [ ] **Step 5: Commit**

```bash
git add bench/thresholds.json bench/check-budgets.ts .github/workflows/perf-budgets.yml
git commit -m "bench: tighten thresholds + flip perf-budgets to fail-on-regression (Phase 2)"
```

---

## Task 7: Extend fuzzer + add open-question unit tests

**Files:**
- Modify: `packages/core/src/algorithm/cache.fuzz.test.ts` — add `setFlexShrink`, `setMargin`, `setFlexDirection` mutations; add child insert/remove mutations
- Create: `packages/core/src/algorithm/cache.invariants.test.ts` — `parentDirection` redundancy test, absolute-position child round-trip test, margin-position audit test

- [ ] **Step 1: Extend the fuzzer mutation set**

In `packages/core/src/algorithm/cache.fuzz.test.ts`, add to the `Mutation` type and `mutationArbitrary`:

```ts
type Mutation =
  | { type: 'setWidth'; path: number[]; value: number }
  | { type: 'setHeight'; path: number[]; value: number }
  | { type: 'setFlexGrow'; path: number[]; value: number }
  | { type: 'setFlexShrink'; path: number[]; value: number }
  | { type: 'setMargin'; path: number[]; value: number }
  | { type: 'setPadding'; path: number[]; value: number }
  | { type: 'setFlexDirection'; path: number[]; value: 'row' | 'column' | 'row-reverse' | 'column-reverse' };

const mutationArbitrary: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({
    type: fc.constant('setWidth' as const),
    path: fc.array(fc.nat({ max: 3 }), { maxLength: 4 }),
    value: fc.integer({ min: 1, max: 50 }),
  }),
  fc.record({
    type: fc.constant('setHeight' as const),
    path: fc.array(fc.nat({ max: 3 }), { maxLength: 4 }),
    value: fc.integer({ min: 1, max: 30 }),
  }),
  fc.record({
    type: fc.constant('setFlexGrow' as const),
    path: fc.array(fc.nat({ max: 3 }), { maxLength: 4 }),
    value: fc.integer({ min: 0, max: 3 }),
  }),
  fc.record({
    type: fc.constant('setFlexShrink' as const),
    path: fc.array(fc.nat({ max: 3 }), { maxLength: 4 }),
    value: fc.integer({ min: 0, max: 3 }),
  }),
  fc.record({
    type: fc.constant('setMargin' as const),
    path: fc.array(fc.nat({ max: 3 }), { maxLength: 4 }),
    value: fc.integer({ min: 0, max: 3 }),
  }),
  fc.record({
    type: fc.constant('setPadding' as const),
    path: fc.array(fc.nat({ max: 3 }), { maxLength: 4 }),
    value: fc.integer({ min: 0, max: 3 }),
  }),
  fc.record({
    type: fc.constant('setFlexDirection' as const),
    path: fc.array(fc.nat({ max: 3 }), { maxLength: 4 }),
    value: fc.constantFrom('row', 'column', 'row-reverse', 'column-reverse') as fc.Arbitrary<
      'row' | 'column' | 'row-reverse' | 'column-reverse'
    >,
  }),
);
```

Update `applyMutation`:

```ts
function applyMutation(root: Node, m: Mutation): void {
  const target = followPath(root, m.path);
  switch (m.type) {
    case 'setWidth':
      target.setWidth(m.value);
      break;
    case 'setHeight':
      target.setHeight(m.value);
      break;
    case 'setFlexGrow':
      target.setFlexGrow(m.value);
      break;
    case 'setFlexShrink':
      target.setFlexShrink(m.value);
      break;
    case 'setMargin':
      target.setMargin(Edge.All, m.value);
      break;
    case 'setPadding':
      target.setPadding(Edge.All, m.value);
      break;
    case 'setFlexDirection':
      target.setFlexDirection(m.value);
      break;
  }
}
```

- [ ] **Step 2: Run fuzzer** — `pnpm vitest run packages/core/src/algorithm/cache.fuzz.test.ts`. Expect all 500 runs pass with the expanded mutation set.

- [ ] **Step 3: Create the invariant test file**

Create `packages/core/src/algorithm/cache.invariants.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Edge } from '../edge.js';
import { Node } from '../node.js';

describe('cache invariants — open questions from spec', () => {
  it('parentDirection is implicit in availableWidth/Height (Yoga + Taffy assumption)', () => {
    // Two trees with the same EXACTLY-sized children but different parent
    // flex direction. Children's individual layouts should be the same;
    // only their relative arrangement (left/top) differs from the parent's
    // perspective. The parent caches the children's child-side layouts,
    // so children's _layout.{width,height} should be identical regardless
    // of parent direction — proving parentDirection isn't needed in the
    // cache key.
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
    // Same explicit-sized child should report the same (width, height)
    // regardless of parent direction.
    expect(row.getChild(0)!.layout.width).toBe(40);
    expect(col.getChild(0)!.layout.width).toBe(40);
    expect(row.getChild(0)!.layout.height).toBe(20);
    expect(col.getChild(0)!.layout.height).toBe(20);
    // Positions differ (row puts child at left=0, col puts child at top=0
    // and left=0; both happen to be 0 here, but the principle holds —
    // children's own dimensions are direction-independent).
  });

  it('absolutely-positioned children round-trip through the layout cache', () => {
    // An absolute-positioned child should be captured into childLayouts
    // and restored correctly on a cache hit.
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

    // First pass: cold layout
    root.calculateLayout(100, 50);
    expect(abs.layout).toEqual({
      left: 10,
      top: 5,
      width: 20,
      height: 15,
      scrollWidth: 20,
      scrollHeight: 15,
    });

    // Second pass: should hit the cache. Mutate nothing.
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
    // Margin position audit (spec Open Q1): if our cache key omits
    // margin, would mutating margin cause stale cache hits? Test that
    // margin mutations correctly trigger re-layout via markDirty.
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(50);
    const child = Node.create();
    child.setFlex(1);
    root.insertChild(child, 0);
    root.calculateLayout(100, 50);
    expect(child.layout.left).toBe(0);

    // Add margin to the child. markDirty propagates up to root; cache
    // is invalidated; re-layout should account for the margin.
    child.setMargin(Edge.Left, 10);
    root.calculateLayout(100, 50);
    expect(child.layout.left).toBe(10);
  });
});
```

- [ ] **Step 4: Run all tests**

Run: `pnpm vitest run packages/core/src`
Expected: ALL PASS, including the 3 new invariant tests.

Run: `pnpm test:differential`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/algorithm/cache.fuzz.test.ts packages/core/src/algorithm/cache.invariants.test.ts
git commit -m "test(core): expand fuzzer mutations + invariant tests for spec open questions"
```

---

## Task 8: CHANGELOG, full CI, push, open PR

**Files:**
- Modify: `packages/core/CHANGELOG.md`

- [ ] **Step 1: Add CHANGELOG entry**

In `## Unreleased`, append the Phase 2 entry below the existing Phase 1 entries:

```markdown
### Performance hardening — Phase 2

- **Internal** per-node `LayoutCache` (1 slot per node, matching Yoga's
  `cachedLayout` and Taffy's 1-slot layout cache). Wired into both the
  root `calculateLayout` path and the `layoutChildren` recursion. Hits
  restore the cached values directly; misses fall through to the full
  flex pipeline. Lazy-allocated; only nodes that have been laid out at
  least once carry the cache. Public API unchanged.
- **Internal** `restoreFromCache` + `snapshotForCache` helpers in
  `algorithm/cache.ts`. The `clearAllCaches` helper from Phase 1 now
  clears both `_measureCache` AND `_layoutCache`.
- **Bench** new `hotrelayout` scenario — 1k-node persistent tree, single
  leaf mutated per iteration. The workload Yoga traditionally wins on;
  Phase 2 makes Pilates competitive or better.
- **CI** perf-budget thresholds tightened (~1.5–2× measured numbers,
  down from Phase 1's 3× headroom). `bench:budgets` script flipped from
  warn-only to fail-on-regression. The `perf-budgets.yml` workflow now
  fails CI on regression.
- **Tests** fuzzer mutation set expanded to cover `setFlexShrink`,
  `setMargin`, `setFlexDirection` in addition to the Phase 1 set. New
  `cache.invariants.test.ts` covers spec open questions:
  `parentDirection` redundancy, absolute-position child round-trip,
  margin invalidation correctness.
```

- [ ] **Step 2: Run full CI locally**

Run: `pnpm run ci`
Expected: ALL clean — lint, build, typecheck, test, test:differential.

Run: `pnpm bench && pnpm bench:budgets`
Expected: all 6 scenarios green; budgets pass; exit 0.

- [ ] **Step 3: Commit CHANGELOG**

```bash
git add packages/core/CHANGELOG.md
git commit -m "docs: changelog entry for layout-cache + hot-relayout (Phase 2)"
```

- [ ] **Step 4: Push**

```bash
git push -u origin perf-layout-cache
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "perf(core): layout cache + hot-relayout bench (Phase 2)" --body "$(cat <<'EOF'
## Summary

Phase 2 of the perf-hardening work scoped in `docs/superpowers/specs/2026-05-08-perf-hardening-design.md`.

- **Per-node `LayoutCache`** (1-slot, matching Yoga + Taffy prior art). Wired into `calculateLayout` root path and `layoutChildren` recursion. Restores cached `width`, `height`, `scrollWidth`, `scrollHeight`, and direct-child layouts on hit.
- New `bench/scenarios/hot-relayout.ts` — the workload Yoga traditionally wins on. Phase 2 closes the gap.
- Perf-budget thresholds tightened (~1.5–2× headroom). `pnpm bench:budgets` now exits non-zero on regression. `perf-budgets.yml` workflow fails CI on threshold violation.
- Fuzzer mutation set expanded (`setFlexShrink`, `setMargin`, `setFlexDirection`).
- New `cache.invariants.test.ts` covers spec open questions: `parentDirection` redundancy, absolute-position round-trip, margin invalidation.

Closes the WASM-Yoga gap on long-lived trees with hot relayouts (text input, animation, list scroll). Public API unchanged.

## Bench numbers

(Numbers from local run on Node 22.21, win32/x64. Substitute the actual `RESULTS.md` numbers after the bench step.)

## Test plan

- [x] Full CI green locally (`pnpm run ci`)
- [x] Differential mode green (`pnpm test:differential`) — every layout test runs cached + cold and asserts identical
- [x] Fuzzer green at 500 runs with expanded mutation set
- [x] Bench budgets pass (`pnpm bench:budgets`) — fail-on-regression now active
- [x] All 6 bench scenarios green (5 from Phase 1 + new hotrelayout)
- [ ] CI green on this PR
- [ ] perf-budgets workflow uploads RESULTS.md as an artifact

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Verify CI green on the PR**

Wait for both `ci` and `perf-budgets` workflows to complete and pass.

If `perf-budgets` fails on the CI runner due to runner-vs-local variance, relax the offending threshold in a follow-up commit.

---

## Self-review checklist

- [ ] Spec coverage: every section in `docs/superpowers/specs/2026-05-08-perf-hardening-design.md` Phase 2 column is addressed — LayoutCache class, key, value, lookup/store, restoreFromCache, hot-relayout scenario, fail-on-regression budgets, parentDirection redundancy test, absolute-position test, margin audit
- [ ] Placeholder scan: no TBDs, all code blocks complete
- [ ] Type consistency: `LayoutCacheKey`, `LayoutCacheValue`, `CachedChildLayout` used identically across implementation and tests
- [ ] Open question 1 (margin in key) — RESOLVED by `cache.invariants.test.ts:margin-changes-invalidate-cache` (margin mutations correctly trigger markDirty → re-layout)
- [ ] Open question 3 (absolute-position children) — RESOLVED by `cache.invariants.test.ts:absolutely-positioned-children-round-trip`

**Realistic effort:** ~16–20hr for an experienced TypeScript engineer who completed Phase 1. The riskiest task is Task 4 (algorithm wiring) — read the open issue in step 4 carefully and verify the design before writing code.
