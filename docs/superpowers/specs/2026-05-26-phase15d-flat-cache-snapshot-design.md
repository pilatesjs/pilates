# Phase 15D — Flat `Float64Array` cache snapshots

## Context

Phase 15A profiling found `snapshotForCache` is the single largest cost at scale: **54% of `huge`'s 4.7ms runtime**, more than `layoutChildren` and `roundLayout` combined.

Root cause: `snapshotForCache(node)` allocates, per call:
- One `childLayouts: CachedChildLayout[]` array.
- One `CachedChildLayout` object per direct child — each an 8-field JS object with hidden-class overhead, scattered across the heap.
- One `LayoutCacheValue` object.

For `huge` (100 rows × 100 cells = 10,101 nodes), a cold build allocates ~30,000 heap objects in `snapshotForCache` alone. GC pressure from this churn dominates.

`CachedChildLayout` carries exactly 8 numbers: `left, top, width, height, scrollWidth, scrollHeight, floatLeft, floatTop`. A JS object is the wrong container — a contiguous `Float64Array` is the right one.

## Goal

**Replace `childLayouts: CachedChildLayout[]` with a flat `Float64Array` (stride 8 per child).** Eliminate per-child object allocation. Share a single empty array for leaf nodes.

Projected: `huge`'s `snapshotForCache` phase drops from ~2.4ms to ~0.5-0.8ms — a **~1.6-1.9ms total saving on `huge`**, bringing it from ~12ms to ~10-10.5ms → **~2× Yoga win** (Yoga 19.67ms). `big` and `stress` benefit proportionally.

**Success criteria:**

1. `CachedChildLayout` interface deleted; `LayoutCacheValue.childLayouts` replaced with `childData: Float64Array` + `childCount: number`.
2. `snapshotForCache` allocates ONE `Float64Array(childCount * 8)` per non-leaf node; leaf nodes share a module-level `EMPTY_CHILD_DATA`.
3. `restoreFromCache` reads from the flat array by stride; output byte-identical.
4. `pnpm bench`: `huge` ≥ 12% faster; `big`/`stress` measurably faster; no scenario regresses.
5. `pnpm test:differential` (820 / 6 skipped) green — `restoreFromCache` output unchanged.
6. Structural-differential fuzzer + Yoga oracle green.

**Non-goals (deferred):**
- Pooling `childData` into a single slab allocator (eliminating per-node `Float64Array` allocation). Phase 15D ships per-node arrays; if profiling shows the ~101 non-leaf array allocations on `huge` still matter, a Phase 15D.2 can slab-pool them.
- Moving `LayoutCacheValue`'s own 4 fields (`width/height/scrollWidth/scrollHeight`) into the LayoutPool. The object is small; measure first.
- Eliminating the `LayoutCache.slot` object allocated per `store()`. Separate concern; not the profiled bottleneck.

## Architecture

### The stride-8 layout

Each child occupies 8 consecutive `Float64Array` slots:

| Offset | Field |
|:-:|---|
| `i*8 + 0` | left |
| `i*8 + 1` | top |
| `i*8 + 2` | width |
| `i*8 + 3` | height |
| `i*8 + 4` | scrollWidth |
| `i*8 + 5` | scrollHeight |
| `i*8 + 6` | floatLeft |
| `i*8 + 7` | floatTop |

A `CHILD_STRIDE = 8` constant + named offset constants (`OFF_LEFT = 0`, `OFF_TOP = 1`, ...) keep the code readable.

### `LayoutCacheValue` change

Before:
```ts
export interface LayoutCacheValue {
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
  childLayouts: CachedChildLayout[];
}
```

After:
```ts
export interface LayoutCacheValue {
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
  /** Flat child layout data — `CHILD_STRIDE` floats per direct child. */
  childData: Float64Array;
  /** Number of direct children captured (childData.length / CHILD_STRIDE). */
  childCount: number;
}
```

`CachedChildLayout` interface is **deleted**.

### `snapshotForCache` change

```ts
const CHILD_STRIDE = 8;
const EMPTY_CHILD_DATA = new Float64Array(0);

export function snapshotForCache(node: Node): LayoutCacheValue {
  const count = node.getChildCount();
  const childData = count === 0 ? EMPTY_CHILD_DATA : new Float64Array(count * CHILD_STRIDE);
  for (let i = 0; i < count; i++) {
    const c = node.getChild(i)!;
    const base = i * CHILD_STRIDE;
    childData[base] = c.layout.left;
    childData[base + 1] = c.layout.top;
    childData[base + 2] = c.layout.width;
    childData[base + 3] = c.layout.height;
    childData[base + 4] = c.layout.scrollWidth;
    childData[base + 5] = c.layout.scrollHeight;
    childData[base + 6] = c._floatLeft;
    childData[base + 7] = c._floatTop;
  }
  return {
    width: node.layout.width,
    height: node.layout.height,
    scrollWidth: node.layout.scrollWidth,
    scrollHeight: node.layout.scrollHeight,
    childData,
    childCount: count,
  };
}
```

The shared `EMPTY_CHILD_DATA` for leaves is safe: leaves never have their `childData` written (the loop doesn't run for `count === 0`), and `restoreFromCache` never reads it for `count === 0`.

### `restoreFromCache` change

```ts
export function restoreFromCache(node: Node, value: LayoutCacheValue): void {
  if (process.env.PILATES_DIFFERENTIAL_LAYOUT === '1') {
    if (node.getChildCount() !== value.childCount) {
      throw new Error(
        `[pilates layout cache] restored value has ${value.childCount} children but node has ${node.getChildCount()} — cache invalidation bug`,
      );
    }
  }
  node._layout.width = value.width;
  node._layout.height = value.height;
  node._layout.scrollWidth = value.scrollWidth;
  node._layout.scrollHeight = value.scrollHeight;
  const cd = value.childData;
  const count = node.getChildCount();
  for (let i = 0; i < count; i++) {
    const c = node.getChild(i)!;
    const base = i * CHILD_STRIDE;
    c._layout.left = cd[base]!;
    c._layout.top = cd[base + 1]!;
    c._layout.width = cd[base + 2]!;
    c._layout.height = cd[base + 3]!;
    c._layout.scrollWidth = cd[base + 4]!;
    c._layout.scrollHeight = cd[base + 5]!;
    c._floatLeft = cd[base + 6]!;
    c._floatTop = cd[base + 7]!;
  }
}
```

### Consumer updates

Any code reading `LayoutCacheValue.childLayouts` must change to `childData` + `childCount`. Known consumers:
- `restoreFromCache` itself (above).
- Differential-mode child-count check (above).
- Possibly tests in `cache.invariants.test.ts` or similar — the implementer greps `childLayouts` workspace-wide and updates each.

### Files touched

```
packages/core/src/algorithm/cache.ts                MODIFY — LayoutCacheValue, snapshotForCache, restoreFromCache, delete CachedChildLayout
packages/core/src/algorithm/cache.*.test.ts         MODIFY — any test reading childLayouts
bench/RESULTS.md                                    REGEN  — confirms huge improvement
```

## Risk model

| Risk | Likelihood | Mitigation |
|---|:-:|---|
| Stride offset bug (read/write wrong slot) | Medium | Named offset constants. `pnpm test:differential` catches any divergence — `restoreFromCache` runs on every cache hit. |
| Shared `EMPTY_CHILD_DATA` accidentally written | Low | The write loop is gated `count > 0`; leaves never reach it. A defensive `Object.freeze` won't work on Float64Array, but the code path is provably unreachable for leaves. |
| `childData.length` vs `childCount` desync | Low | `childCount` is the authoritative count; `childData.length === childCount * CHILD_STRIDE` always (or 0 for shared empty). A test asserts this invariant. |
| V8 deopt on `Float64Array` index reads in `restoreFromCache` hot path | Low | TypedArray reads are V8's fastest path; this is a speedup, not a risk. |
| A consumer outside cache.ts holds a `CachedChildLayout` reference | Low | Grep workspace-wide for `CachedChildLayout` + `childLayouts` before deleting. |

## Validation plan

1. `pnpm typecheck`: clean. Deleting `CachedChildLayout` surfaces any external consumer.
2. `pnpm test`: 1456 pass.
3. `pnpm test:differential` ×3: 820 / 6 skipped. `restoreFromCache` runs on every cache-hit layout — divergence surfaces instantly.
4. Structural-differential fuzzer numRuns=300: green.
5. Yoga oracle (33 fixtures): green.
6. `pnpm bench`: `huge` ≥ 12% faster (target ~10-10.5ms from ~12ms); `big`/`stress` measurably faster; hot-* within variance.

## Projected impact

| Scenario | Pre-15D | Projected post-15D | vs Yoga |
|---|---:|---:|---|
| huge | 11.92ms | ~10.0-10.5ms | ~1.9× win (Yoga 19.67ms) |
| big | 4.31ms | ~3.7-3.9ms | ~2.6× win (Yoga 10ms) |
| stress | 700µs | ~620-650µs | ~3× win (Yoga 1.93ms) |
| realistic | 138µs | ~128-132µs | ~2.5× win (Yoga 335µs) |
| tiny | 5.1µs | ~5.0µs | ~3.8× win (Yoga 19.5µs) |
| hot-* | ~21µs | ~21µs (flat) | unchanged — hot scenarios don't rebuild full cache snapshots |

`huge` reaching ~2× Yoga is the headline: it was the weakest scenario (1.5× pre-Phase-15). Phase 15D alone gets it past the 2× decisive-win bar.

## Why this is the highest-leverage sub-phase

Phase 15A ranked `snapshotForCache` allocation churn as the #1 cold-scenario lever. Phase 15D is the smallest possible change that captures it: one interface, two functions, ~60 lines. No algorithm change, no traversal change — purely swapping the storage container from "array of objects" to "flat typed array". The differential fuzzer makes the correctness trivially verifiable.
