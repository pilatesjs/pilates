# Phase 15E — Skip wasted cache population on the imperative first-layout path

## Context

Phase 15D re-profiling produced a precise breakdown of `huge`'s 2.67ms cold layout (`calculateLayoutImpl`):

| Phase | µs | % |
|---|---:|---:|
| `layoutChildren` (flex layout) | 1367.7 | 51.1% |
| `computeScrollSizes` | 1084.2 | 40.5% |
| `roundLayout` | 174.2 | 6.5% |
| `markClean` | 48.0 | 1.8% |

`computeScrollSizes` decomposes:

| Sub-cost | µs | % of computeScrollSizes |
|---|---:|---:|
| Tree walk + scroll math (**essential output**) | 77.4 | 7.1% |
| `snapshotForCache` (Float64Array fill) | 258.2 | 23.8% |
| `LayoutCache.store()` slot spread | 357.5 | 33.0% |
| Lazy `new LayoutCache()` × 10,100 | 391.1 | 36.1% |

**The decisive realization:** the public `calculateLayout` router runs the imperative engine (`calculateLayoutImpl`) *exactly once* per root — on the first layout. From the second layout onward, the router switches to the `SpinelessLayout` engine (`algorithm/index.ts:106-109`). The Spineless engine has its own independent grammar-based state; **it never reads the imperative engine's `LayoutCache`.**

Therefore the ~1007µs that `computeScrollSizes` spends populating per-node `LayoutCache`s on the first layout is **pure waste in the normal router flow** — it caches results no subsequent layout will ever read.

## Goal

**Thread a `populateCache: boolean` parameter through `calculateLayoutImpl`. The router's first-call path passes `false` — skipping `snapshotForCache`, `LayoutCache.store()`, and lazy `LayoutCache` allocation entirely. Scroll-size computation (essential layout output) still runs.**

Projected: `huge` layout 2.67ms → ~1.67ms (−37%); bench `huge` 11.66ms → ~10.6ms. `big`/`stress`/`realistic` benefit proportionally — all cross the 2× Yoga decisive-win bar.

**Success criteria:**

1. `calculateLayoutImpl` gains a `populateCache: boolean` parameter.
2. Router first-call path (`engine === undefined`) passes `populateCache = false`.
3. `calculateLayoutImperative` (the `@internal` direct entry) passes `populateCache = true` — consumers calling it directly may do repeated imperative layouts that benefit from caching.
4. Differential mode passes `populateCache = true` — preserves exact current behavior; zero risk to the cached-vs-cold comparison.
5. When `populateCache = false`: `scrollWidth`/`scrollHeight` are still computed and written to `_layout` (they are layout *output*, not cache). Only `snapshotForCache` + `LayoutCache.store()` + lazy `LayoutCache` allocation are skipped.
6. `pnpm test:differential` (820 / 6 skipped) green — differential mode unaffected.
7. Structural-differential fuzzer + Yoga oracle green.
8. `pnpm bench`: `huge` ≥ 8% faster; `big`/`stress`/`realistic` measurably faster; hot-* unchanged (they route through Spineless).

**Non-goals:**
- Slot-spread elimination in `LayoutCache.store()`. Once first-layout skips population, the slot-spread only runs for `calculateLayoutImperative` direct calls + differential mode — neither a bench-hot path. Deferred; revisit only if a profile shows it matters.
- Optimizing tree *construction* (`Node.create()` + setters). The bench times build + layout together; `huge`'s ~9ms build is a separate optimization domain — a future Phase 15F target.
- Touching the Spineless engine. Unchanged.

## Architecture

### Why this is safe

The imperative `LayoutCache` is read in exactly two places:
1. `calculateLayoutImpl`'s root cache-hit fast path (`index.ts:183`) — `if (!root.isDirty() && root._layoutCache !== undefined)`.
2. The phase-3 relayout-boundary fast path in `layoutChildren` (`main-axis.ts:145`) — `if (useCache && !node.isDirty() && node._layoutCache !== undefined)`.

Both are guarded on `_layoutCache !== undefined`. If population is skipped, `_layoutCache` stays `undefined`, both fast paths are simply not taken, and a full cold layout runs instead. **Correctness is unaffected — the cache is a pure speed optimization.**

In the router flow, neither fast path is ever reachable after a skipped population, because:
- The router never calls `calculateLayoutImpl` a second time for the same root (it switches to Spineless).
- Within a single `calculateLayoutImpl` call on a fresh tree, every node is dirty, so the fast paths don't fire mid-pass anyway.

So `populateCache = false` on the router's first-call path discards a cache that provably has no reader.

### The parameter thread

`calculateLayoutImpl` signature:

```ts
function calculateLayoutImpl(
  root: Node,
  availableWidth: number | undefined,
  availableHeight: number | undefined,
  populateCache: boolean,
): void
```

Call sites:
- Router first-call (`index.ts` ~line 104): `calculateLayoutImpl(root, availableWidth, availableHeight, false)`.
- `calculateLayoutImperative` (~line 162): `calculateLayoutImpl(root, availableWidth, availableHeight, true)`.
- Differential mode (~lines 133, 139): `calculateLayoutImpl(root, ..., true)` both passes.

### `computeScrollSizes` split

`computeScrollSizes` currently does (per node, in one tree walk):
1. Compute `scrollWidth` / `scrollHeight`, write to `_layout`. — **essential, always runs.**
2. `snapshotForCache(node)` → build a `LayoutCacheValue`. — **cache, conditional.**
3. Lazily `new LayoutCache()` if `node._layoutCache === undefined`. — **cache, conditional.**
4. `node._layoutCache.store(key, value)`. — **cache, conditional.**

`computeScrollSizes` gains a `populateCache` parameter. When `false`, steps 2-4 are skipped; step 1 still runs. The `innerKey` object literal (only needed for step 4's `store`) is also skipped when `false`.

The implementer locates `computeScrollSizes` (in `algorithm/index.ts` or a scroll module) and applies the gate. The exact structure — whether scroll computation and cache population share a walk or are separable — is determined by reading the code; the gate goes wherever steps 2-4 happen.

### Files touched

```
packages/core/src/algorithm/index.ts        MODIFY — calculateLayoutImpl + computeScrollSizes gain populateCache; 3 call sites
bench/RESULTS.md                            REGEN  — confirms huge improvement
```

(If `computeScrollSizes` lives in a separate file, that file is also modified.)

## Risk model

| Risk | Likelihood | Mitigation |
|---|:-:|---|
| A consumer relies on the imperative `LayoutCache` being populated after a router-driven layout | Very Low | The router switches to Spineless on layout 2; the imperative cache has no reader. Phase 15E only skips population on the router path; `calculateLayoutImperative` direct still populates. |
| `scrollWidth`/`scrollHeight` accidentally skipped along with cache population | Medium | The spec explicitly separates step 1 (essential) from steps 2-4 (cache). Differential mode + Yoga oracle assert scroll values; any miss fails immediately. |
| Differential mode behavior changes | Very Low | Differential mode passes `populateCache = true` — byte-identical to current behavior. |
| Phase-3 relayout boundary perf relies on first-layout cache population | Low | The boundary path needs caches, but in the router flow layout 2+ uses Spineless (which has its own boundary handling). The imperative boundary path is only reachable via `calculateLayoutImperative` direct, which still populates. |
| Hot-* bench scenarios regress | Very Low | Hot scenarios route through Spineless from layout 2 onward; the imperative first-layout cache skip doesn't touch their measured path. |

## Validation plan

1. `pnpm typecheck`: clean.
2. `pnpm test`: 1456 pass.
3. `pnpm test:differential` ×3: 820 / 6 skipped. Differential mode passes `populateCache = true` — must be byte-identical.
4. Structural-differential fuzzer numRuns=300: green.
5. Yoga oracle (33 fixtures): green — asserts scroll values among others.
6. `pnpm bench`: `huge` ≥ 8% faster (~10.6ms target from 11.66ms); `big` ~3.7ms; `stress` ~600µs; `realistic` ~110µs. Hot-* within variance.

## Projected impact

| Scenario | Pre-15E | Projected | Yoga | vs Yoga |
|---|---:|---:|---:|---|
| tiny | 5.2µs | ~5.0µs | 19.0µs | ~3.8× win |
| realistic | 144.9µs | ~110µs | 332.9µs | ~3.0× win |
| stress | 711.6µs | ~600µs | 1.98ms | ~3.3× win |
| big | 4.10ms | ~3.7ms | 9.30ms | ~2.5× win |
| huge | 11.66ms | ~10.6ms | 18.67ms | ~1.76× win |
| hot-* | ~21µs | ~21µs | 73-83µs | ~3.5× win |
| hot-structural | 388µs | ~388µs | 91µs | 0.23× loss |

After Phase 15E: 7 of 9 scenarios decisively beat Yoga (≥ 2×). `huge` reaches 1.76× — close but short of 2×; closing it fully requires a tree-construction optimization phase (Phase 15F). `hot-structural` remains the headline gap, addressed by 15F-H.

## Why this matters beyond the bench

Skipping speculative cache population on a layout whose cache has no reader is not benchmark-gaming — it's removing genuine waste. Real consumers who do a one-shot layout (server-side render, snapshot, test) pay the same ~1007µs/10k-nodes of pointless allocation today. Phase 15E makes one-shot layout ~37% faster for everyone. The cache still populates for the genuine repeat-layout case (`calculateLayoutImperative` direct, or — when a future phase routes repeat imperative layouts — the second call onward).
