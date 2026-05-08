# Performance Hardening at 5k–10k Nodes Design

**Date:** 2026-05-08
**Branches:** `perf-measure-cache` (Phase 1), `perf-layout-cache` (Phase 2)
**Status:** Approved — ready for implementation plan

---

## Overview

Add an incremental relayout path to `@pilates/core` so trees that have been
laid out once and then mutated in a small region don't pay the full-tree
cost on every `calculateLayout()` call. This closes the one workload where
WASM Yoga still beats Pilates today (long-lived trees with hot relayouts —
text input, animation, list scroll, etc.) and keeps Pilates competitive at
5k–10k nodes, the size class where the gap currently shows up most.

The work ships as two PRs with shared validation infrastructure built in
the first.

### Scope

- **Phase 1:** Per-leaf measure-func cache. Wired into every measure call
  site in the algorithm. Lazy-allocated; only nodes with a `MeasureFunc`
  pay any memory cost.
- **Phase 2:** Per-node layout cache. Wired into `calculateLayout()` and
  `layoutChildren()`. Lazy-allocated; nodes that never relayout never
  instantiate the cache.
- **Validation infrastructure (built in Phase 1):**
  - Differential mode — env-gated wrapper around `calculateLayout()` that
    runs cached and cold paths and asserts byte-identical layout
    snapshots. Wired into a new `pnpm test:differential` CI step.
  - Property-based fuzzer — `cache.fuzz.test.ts`, 500 random
    tree+mutation-sequence combinations per CI run, asserts cached
    layout == fresh recompute.
- **Bench coverage:**
  - `bench/scenarios/big.ts` (5k nodes, tree-build-then-layout)
  - `bench/scenarios/huge.ts` (10k nodes)
  - `bench/scenarios/hot-relayout.ts` (build once, mutate one leaf,
    relayout in a loop) — the workload Yoga currently wins
- **CI perf budgets:** `bench/thresholds.json` + `bench/check-budgets.ts`,
  rolled out warn-only in Phase 1, fail-on-regression in Phase 2.
- **Out of scope:**
  - Public API change of any kind (`Node`, `calculateLayout`,
    `MeasureFunc`, `Style` all unchanged)
  - Public hit-rate metric / opt-out flag — defer until someone asks
  - Cross-node cache sharing (structural-hash content-addressing)
  - Async / off-main-thread layout
  - Manual cache eviction API

---

## Architecture

### New files

| File | Purpose |
|---|---|
| `packages/core/src/algorithm/cache.ts` | `MeasureCache`, `LayoutCache`, key/value types, snapshot/restore helpers |
| `packages/core/src/algorithm/cache.test.ts` | Unit tests for cache mechanics: hit, miss, eviction, clear, dirty propagation |
| `packages/core/src/algorithm/cache.fuzz.test.ts` | Property-based fuzzer: random tree + random mutations, cached == cold |
| `bench/scenarios/big.ts` | 5k-node scenario (50 × 100 grid) |
| `bench/scenarios/huge.ts` | 10k-node scenario (100 × 100 grid) |
| `bench/scenarios/hot-relayout.ts` | Build-once-mutate-relayout-in-loop scenario |
| `bench/thresholds.json` | Per-scenario, per-engine latency floors |
| `bench/check-budgets.ts` | Reads `RESULTS.md`, asserts no engine exceeds its threshold |

### Modified files

| File | Change |
|---|---|
| `packages/core/src/node.ts` | Add `_measureCache?: MeasureCache` (Phase 1) and `_layoutCache?: LayoutCache` (Phase 2) `@internal` fields. `markDirty()` clears both. `setMeasureFunc()` clears measure cache. |
| `packages/core/src/algorithm/index.ts` | Cache lookup before `layoutChildren`; cache write after. Differential-mode wrapper gated on `PILATES_DIFFERENTIAL_LAYOUT=1`. |
| `packages/core/src/algorithm/main-axis.ts` | Wrap every measure-func invocation with cache lookup/store. Wrap `layoutChildren` recursion with cache lookup/store. |
| `packages/core/src/algorithm/round.ts` | Verify and document `roundLayout` idempotency — required so cache stores already-rounded values. |
| `bench/index.ts` | Register `big`, `huge`, `hot-relayout` scenarios. |
| `bench/RESULTS.md` | Regenerated with new scenarios + post-Phase-2 numbers. |
| `.github/workflows/ci.yml` | Add `pnpm test:differential` step; add `bench-check` job (warn-only Phase 1, fail-on-regression Phase 2). |
| `package.json` (root) | Add `test:differential` and `bench:budgets` scripts. |
| `packages/core/CHANGELOG.md` | `## Unreleased` entry per phase. |
| `docs/STRATEGY.md` | Short note: hot-relayout is now competitive with WASM Yoga (link to bench evidence). |

### No new dependency unless required

`fast-check` is the preferred fuzzing library. Implementation will check
`pnpm-lock.yaml` first; if not already present, weigh adding it as a
devDep against a hand-rolled seeded-random fuzzer (loses shrinking but
zero deps). Default to `fast-check` if devDep policy permits — shrinking
is the difference between "fails after 30 mutations" and "minimal
reproducer is one mutation on an empty tree."

---

## Phase 1: measure-func cache

### Data structure

```ts
// packages/core/src/algorithm/cache.ts
import type { MeasureMode } from '../measure-func.js';

export interface MeasureCacheKey {
  availableWidth: number;       // integer cells or Infinity
  widthMode: MeasureMode;       // EXACTLY | AT_MOST | UNDEFINED
  availableHeight: number;
  heightMode: MeasureMode;
}

export interface MeasureCacheValue {
  width: number;
  height: number;
}

export class MeasureCache {
  // Two slots: hypothetical-vs-final pattern often hits both per pass.
  private static readonly MAX_ENTRIES = 2;
  private slots: Array<MeasureCacheKey & MeasureCacheValue> = [];

  // Dev-only counters (gated on __DEV__ build flag; absent in published builds)
  hits = 0;
  misses = 0;

  lookup(key: MeasureCacheKey): MeasureCacheValue | undefined {
    for (const slot of this.slots) {
      if (
        slot.availableWidth === key.availableWidth &&
        slot.widthMode === key.widthMode &&
        slot.availableHeight === key.availableHeight &&
        slot.heightMode === key.heightMode
      ) {
        if (__DEV__) this.hits++;
        return { width: slot.width, height: slot.height };
      }
    }
    if (__DEV__) this.misses++;
    return undefined;
  }

  store(key: MeasureCacheKey, value: MeasureCacheValue): void {
    // overwrite if present
    for (const slot of this.slots) {
      if (
        slot.availableWidth === key.availableWidth &&
        slot.widthMode === key.widthMode &&
        slot.availableHeight === key.availableHeight &&
        slot.heightMode === key.heightMode
      ) {
        slot.width = value.width;
        slot.height = value.height;
        return;
      }
    }
    if (this.slots.length < MeasureCache.MAX_ENTRIES) {
      this.slots.push({ ...key, ...value });
    } else {
      this.slots.shift();
      this.slots.push({ ...key, ...value });
    }
  }

  clear(): void {
    this.slots.length = 0;
  }
}
```

### Lifecycle

| Event | Action |
|---|---|
| `setMeasureFunc(fn)` called | `_measureCache = new MeasureCache()` (lazy create); also `clear()` since the function changed |
| Any style setter (`setWidth`, `setFlex`, etc.) on this node | `markDirty()` runs → clears `_measureCache` |
| `markDirty()` called externally | clears `_measureCache` |
| Child added/removed | leaves can't have children — N/A |

`markDirty()` is the single chokepoint where invalidation happens. All
setters already call it. Adding `_measureCache?.clear()` to `markDirty()`
is the only invalidation-site change.

### Wiring (main-axis.ts)

Every measure-func call site is wrapped:

```ts
function callMeasureFunc(
  node: Node,
  availableWidth: number,
  widthMode: MeasureMode,
  availableHeight: number,
  heightMode: MeasureMode,
): { width: number; height: number } {
  const fn = node._measureFunc!;
  const key = { availableWidth, widthMode, availableHeight, heightMode };
  const cached = node._measureCache?.lookup(key);
  if (cached !== undefined) return cached;
  const result = fn(availableWidth, widthMode, availableHeight, heightMode);
  node._measureCache ??= new MeasureCache();
  node._measureCache.store(key, result);
  return result;
}
```

`measureLeafIfNeeded` and the FlexItem hypothetical-sizing path both go
through this helper — there are no remaining direct invocations of
`node._measureFunc(...)`. Implementation grep + replace; one call site
left untouched is a bug.

### Why two slots

In a single `calculateLayout()` pass a leaf's measure-func can be called
twice:

1. During parent's flex-distribution, with `(AT_MOST, parentInnerWidth)`
   to compute hypothetical sizes.
2. During the child's own `layoutChildren`, with `(EXACTLY, finalWidth)`
   for paint.

With one slot the second call evicts the first; the next pass restarts.
Two slots keep both, so the next pass hits twice. Memory cost: ~80 bytes
per leaf with a measure func.

### Numeric key match

Exact `===`. All four key fields are integers, `Infinity`, or
`MeasureMode` enum values. No float arithmetic produces a measure-cache
key. Documented invariant; if it ever breaks, the cache silently
mis-matches — covered by the differential test.

---

## Phase 2: layout cache on internal nodes

### Cache hit precondition (must be ALL of)

1. Node is clean (`!_dirty`).
2. Cache has an entry whose key matches the requested layout inputs.

A clean node implies a clean subtree (descendant mutations propagate
dirty up via the existing `markDirty()` parent walk). With an
input-match the previously cached output is reusable verbatim.

### Data structure

```ts
// packages/core/src/algorithm/cache.ts
import type { FlexDirection } from '../style.js';

export interface LayoutCacheKey {
  availableWidth: number;
  widthMode: MeasureMode;
  availableHeight: number;
  heightMode: MeasureMode;
  parentDirection: FlexDirection;   // documented as "may prove redundant" — see open question
}

interface CachedChildLayout {
  left: number; top: number;
  width: number; height: number;
  scrollWidth: number; scrollHeight: number;
}

export interface LayoutCacheValue {
  // node's own
  width: number; height: number;
  scrollWidth: number; scrollHeight: number;
  // direct children (parallel to node.children at cache time)
  childLayouts: ReadonlyArray<CachedChildLayout>;
}

export class LayoutCache {
  private static readonly MAX_ENTRIES = 4;
  private slots: Array<LayoutCacheKey & { value: LayoutCacheValue }> = [];

  hits = 0;       // __DEV__ only
  misses = 0;     // __DEV__ only

  lookup(key: LayoutCacheKey): LayoutCacheValue | undefined { /* linear scan, exact === */ }
  store(key: LayoutCacheKey, value: LayoutCacheValue): void { /* overwrite-or-LRU */ }
  clear(): void { this.slots.length = 0; }
}
```

### Why four slots

Internal nodes see more variance than leaves: a flex child may be laid
out at intrinsic size during ancestor flex distribution, then at flexed
size for final layout, then at a different size next pass. Four slots
covers the common patterns without committing to Yoga's 16. If
post-Phase-2 hit-rate measurement shows we're evicting hot entries, the
cap is a one-line change.

Memory cost worst case: ~200 bytes × 4 entries × 10k nodes = ~8MB.
Acceptable, bounded.

### Top-level flow (`calculateLayout`)

```ts
export function calculateLayout(root: Node, availableWidth?: number, availableHeight?: number): void {
  const widthMode = availableWidth === undefined ? MeasureMode.UNDEFINED : MeasureMode.EXACTLY;
  const heightMode = availableHeight === undefined ? MeasureMode.UNDEFINED : MeasureMode.EXACTLY;
  const aw = availableWidth ?? Infinity;
  const ah = availableHeight ?? Infinity;
  const key: LayoutCacheKey = { availableWidth: aw, widthMode, availableHeight: ah, heightMode, parentDirection: 'row' };

  if (!root._dirty && root._layoutCache) {
    const hit = root._layoutCache.lookup(key);
    if (hit) {
      root._layout.left = 0;
      root._layout.top = 0;
      restoreFromCache(root, hit);
      return;
    }
  }

  // miss path: existing algorithm
  root._layout.left = 0;
  root._layout.top = 0;
  root._layout.width = resolveRootAxisSize(root, 'row', availableWidth);
  root._layout.height = resolveRootAxisSize(root, 'column', availableHeight);
  layoutChildren(root);
  roundLayout(root);
  computeScrollSizes(root);
  markClean(root);

  root._layoutCache ??= new LayoutCache();
  root._layoutCache.store(key, snapshot(root));
}
```

### Recursive cache restore

```ts
function restoreFromCache(node: Node, entry: LayoutCacheValue): void {
  node._layout.width = entry.width;
  node._layout.height = entry.height;
  node._layout.scrollWidth = entry.scrollWidth;
  node._layout.scrollHeight = entry.scrollHeight;
  // node._layout.left/top set by caller — root is 0/0; child set by parent below

  for (let i = 0; i < node.getChildCount(); i++) {
    const c = node.getChild(i)!;
    const cl = entry.childLayouts[i]!;
    c._layout.left = cl.left;
    c._layout.top = cl.top;
    c._layout.width = cl.width;
    c._layout.height = cl.height;
    c._layout.scrollWidth = cl.scrollWidth;
    c._layout.scrollHeight = cl.scrollHeight;

    // child is also clean (parent clean ⇒ child clean); try its cache
    if (c._layoutCache) {
      const childKey = inputsForChild(node, c, /* via flex algorithm reflection */);
      const childHit = c._layoutCache.lookup(childKey);
      if (childHit) {
        restoreFromCache(c, childHit);
        continue;
      }
    }
    // child cache miss — fall back to full recompute for c's subtree
    layoutChildren(c);
  }
}
```

The fall-through is rare but handled: a node was clean and had cached
inputs; its child was clean but had different cached inputs (or no
cache). In that case we re-run flex on the child's subtree.

### Wiring inside `layoutChildren`

Same shape as the root path:

```ts
export function layoutChildren(node: Node): void {
  if (!node._dirty && node._layoutCache) {
    const key = inputsFor(node);
    const hit = node._layoutCache.lookup(key);
    if (hit) { restoreFromCache(node, hit); return; }
  }

  // existing FlexItem build, distribute, recurse...
  // (unchanged code path)

  node._layoutCache ??= new LayoutCache();
  node._layoutCache.store(inputsFor(node), snapshot(node));
}
```

### Position rounding

`roundLayout` runs once at the very end of the cold path. With caching,
child positions in cached entries are already-rounded values. On a cache
hit we skip the post-pass for that subtree; on a miss the post-pass runs
on the recomputed subtree only.

Required invariant: `roundLayout(roundLayout(t)) == roundLayout(t)`. The
function uses `Math.round`, which is idempotent on integers — formal
unit test added in `cache.test.ts` to lock this in.

### `computeScrollSizes` integration

Currently a separate post-pass. With caching, `scrollWidth`/`scrollHeight`
are part of `LayoutCacheValue` and `restoreFromCache` populates them
directly. The standalone post-pass runs only on the recomputed subtree.

### `markClean` integration

After a cold layout pass, every recomputed node gets `_dirty = false`.
On a cache hit the node was already clean, so `markClean` falls through.
No changes needed; existing recursion is correct.

---

## Validation infrastructure

### Differential mode

`PILATES_DIFFERENTIAL_LAYOUT=1` env var checked once at module load. When
set, `calculateLayout()` wraps itself:

```ts
const DIFFERENTIAL = process.env.PILATES_DIFFERENTIAL_LAYOUT === '1';

export function calculateLayout(root: Node, aw?: number, ah?: number): void {
  if (!DIFFERENTIAL) return calculateLayoutImpl(root, aw, ah);

  calculateLayoutImpl(root, aw, ah);
  const cachedSnapshot = snapshotTreeLayouts(root);

  clearAllCaches(root);
  markDirtyDeep(root);
  calculateLayoutImpl(root, aw, ah);
  const coldSnapshot = snapshotTreeLayouts(root);

  if (!deepEqual(cachedSnapshot, coldSnapshot)) {
    throw new Error(`[differential] layout cache produced different result than fresh recompute:\n${diffLayouts(cachedSnapshot, coldSnapshot)}`);
  }
}
```

`snapshotTreeLayouts`, `clearAllCaches`, `markDirtyDeep`, `diffLayouts`
all live in `cache.ts`, exported as `@internal`.

`pnpm test:differential` — new script, runs `vitest` with the env var
set. Wired into `pnpm run ci` after the regular `pnpm test`. Doubles
layout-test runtime; acceptable for the safety guarantee.

In published builds the wrapper compiles to a single early return —
verified by spot-checking `dist/algorithm/index.js` after each phase's
build.

### Property-based fuzzer

`packages/core/src/algorithm/cache.fuzz.test.ts`. Uses `fast-check` if
already in tree or addable; else hand-rolled seeded PRNG with 500 fixed
seeds.

Per CI run: 500 random tree + mutation-sequence combinations. Tree size
up to ~50 nodes; mutation sequence up to 30 ops. ~15k mutate-relayout
cycles per CI; cached vs cold compared after each mutation. fast-check's
shrinking produces minimal reproducer on failure.

### Bench scenarios

| File | Shape | Purpose |
|---|---|---|
| `bench/scenarios/big.ts` | 50 × 100 grid (5051 nodes) | Tree-build-then-layout at 5k |
| `bench/scenarios/huge.ts` | 100 × 100 grid (10101 nodes) | Tree-build-then-layout at 10k |
| `bench/scenarios/hot-relayout.ts` | 1k-node tree, mutate one leaf, relayout | The Yoga-wins workload |

`bench/index.ts` registers all six scenarios. RESULTS.md regenerated
with new sections.

### CI perf budgets

`bench/thresholds.json`:
```json
{
  "tiny":         { "@pilates/core (layout)": { "maxMeanMs": 0.005 } },
  "realistic":    { "@pilates/core (layout)": { "maxMeanMs": 0.10  } },
  "stress":       { "@pilates/core (layout)": { "maxMeanMs": 0.40  } },
  "big":          { "@pilates/core (layout)": { "maxMeanMs": 2.5   } },
  "huge":         { "@pilates/core (layout)": { "maxMeanMs": 6.0   } },
  "hot-relayout": { "@pilates/core (layout)": { "maxMeanMs": 0.05  } }
}
```

`bench/check-budgets.ts` parses `RESULTS.md`, compares latest mean
latencies to thresholds, exits non-zero on regression.

CI rollout:
- **Phase 1 PR:** `bench-check` job runs as part of CI but warn-only
  (failure prints regression notice, doesn't fail build). Two weeks of
  variance data inform real thresholds.
- **Phase 2 PR:** thresholds tightened to p99 of measured variance;
  workflow flips to fail-on-regression.

### Existing tests under cache

All 842 existing tests run `calculateLayout()` somewhere. Differential
mode validates them all by running each through both paths. No test
rewrites needed.

The yoga-oracle suite continues to validate cold-path output against
WASM Yoga cell-for-cell on 33 fixtures. Differential mode validates
cached == cold. Transitively cached == Yoga.

---

## Public API

**Zero changes.** `Node`, `calculateLayout`, `MeasureFunc`, `Style` all
unchanged. The cache is `@internal`.

`Node._measureCache` and `Node._layoutCache` are `@internal` JSDoc-tagged
and stripped from published `.d.ts` by existing tsconfig settings.

No opt-out flag, no public hit-rate metric — both deferred until someone
asks. An opt-out doubles the test surface and creates a bifurcated
correctness story; if a cache bug escapes validation, the answer is to
fix the cache, not to hand consumers an off switch.

---

## Dev-mode observability

`hits` / `misses` counters on each cache, gated on a `__DEV__` build
constant. Set true for tests/bench, false for published builds. In
published builds the counter fields and increments don't exist —
verified by inspecting `dist/algorithm/cache.js` after build during PR
review.

`pnpm bench` prints aggregate hit-rate per scenario alongside the
latency tables. Dev/debug only; not part of the published API.

---

## Error handling

**No error path inside the cache.** Lookups never fail — they hit or
miss. Stores never fail — write or evict. No I/O, no async.

**Measure-func that throws:** existing behavior preserved. The throw
escapes through `calculateLayout`; `_measureCache?.store(...)` is never
reached; the cache stays in its prior state. Documented as an invariant
(`cache.test.ts` covers it).

**Differential-mode failure:** throws an `Error` with full tree-diff
dump. Hard fail in CI; surfaces immediately in development.

---

## Open questions to resolve during implementation

1. **Is `parentDirection` actually needed in `LayoutCacheKey`?** Children
   see `availableWidth`/`availableHeight` already reoriented for them by
   the parent's flex algorithm, so the parent direction may be implicit
   in those values. Resolution: include in key for safety; add a
   targeted unit test that constructs two trees with the same
   absolute-axis sizes but different parent directions and asserts they
   produce different layouts. If they do, the key is correct as-is. If
   they don't, the field can be dropped in a follow-up.
2. **`fast-check` devDep policy.** Check `pnpm-lock.yaml` first. If
   not present and the policy resists adding it, fall back to a
   hand-rolled seeded PRNG fuzzer (500 fixed seeds). Decide during
   Phase 1 implementation, not now.
3. **Absolutely-positioned children.** Pilates supports
   `position: absolute`. They lay out independently of siblings. Verify
   they're snapshotted correctly into `childLayouts` (likely yes — they
   are regular children in the tree) and add a targeted differential
   test that mutates an absolutely-positioned child without dirtying
   its siblings.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Sibling-effect invalidation bug | Medium | High | Differential mode + 500-run fuzzer per CI; specifically engineered to catch this class |
| Numeric instability in cache key (Infinity / NaN comparison) | Low | Medium | All key values are integers, `Infinity`, or enum constants. No `NaN` ever produced. Unit tests assert key behavior. |
| Memory growth at 10k+ nodes | Low | Low | Lazy `_layoutCache` allocation; ~200 bytes × 4 entries × 10k = ~8MB cap |
| `roundLayout` non-idempotency causing 1-cell drift on cache hit | Low | Medium | Unit test asserts `roundLayout(roundLayout(t)) == roundLayout(t)`. Round before caching; cached values are integer-clean. |
| Phase 2 turning out larger than estimated | Medium | Low | Phase 1 ships independently, valuable on its own. Phase 2 can be split further if needed. |

---

## Realistic effort

- Phase 1 (measure cache + validation infra + 5k/10k bench scenarios):
  ~12hr core + ~5hr validation = **~17hr**
- Phase 2 (layout cache + hot-relayout scenario + threshold tightening):
  **~16hr**
- Total: **~33hr**

The original ~16hr Track 1 P2 estimate was undersized. Phase 1 alone
gets us close to the original budget; Phase 2 doubles it for the
remaining win.

---

## Phase delivery sequence

1. **Phase 1 PR (`perf-measure-cache`):**
   - `cache.ts` — `MeasureCache` only; `LayoutCache` left as a stub
   - Wire measure cache into all measure-func call sites
   - Differential-mode wrapper + `pnpm test:differential` script
   - Fuzzer scaffolding (validates measure cache only at this point)
   - `bench/scenarios/big.ts`, `bench/scenarios/huge.ts`
   - Update `bench/index.ts`, regenerate `RESULTS.md`
   - `bench/check-budgets.ts`, warn-only CI integration
   - CHANGELOG entry under `## Unreleased`
2. **Phase 2 PR (`perf-layout-cache`):**
   - Implement `LayoutCache`, `snapshot`, `restoreFromCache`,
     `clearAllCaches`, `markDirtyDeep` in `cache.ts`
   - Wire layout cache into `calculateLayout` and `layoutChildren`
   - `bench/scenarios/hot-relayout.ts`
   - Tighten `bench/thresholds.json`; flip CI to fail-on-regression
   - Resolve Open Questions 1 and 3 with targeted tests
   - Update `bench/RESULTS.md`, `docs/STRATEGY.md` (hot-relayout note),
     `CHANGELOG.md` `## Unreleased`

Both PRs squash-merge to `main`. After Phase 2 merges, `@pilates/core`
gets a minor bump and ships in the next promotion bundle.
