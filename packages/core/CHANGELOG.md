# Changelog

All notable changes to `@pilates/core` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Performance hardening — Phase 1

- **Internal** measure-func result cache on leaves with a `MeasureFunc`
  installed. 8-slot LRU per leaf, matching Yoga's
  `LayoutResults::MaxCachedMeasurements`. Halves text-measurement cost
  in workloads that re-lay out the same tree. Cache is `@internal`; no
  public API change. Lazy-allocated; nodes without a measure function
  pay zero memory.
- **Internal** all five measure-func call sites in `algorithm/main-axis.ts`
  routed through a single `callMeasureFunc` helper. The helper is the
  only chokepoint that talks to `_measureCache`.
- **Internal** differential-mode validation harness
  (`PILATES_DIFFERENTIAL_LAYOUT=1`) runs every `calculateLayout` twice
  (cached + cold) and asserts byte-identical layouts. Wired into
  `pnpm test:differential` and the workspace `ci` script.
- **Internal** property-based fuzzer (`packages/core/src/algorithm/cache.fuzz.test.ts`,
  500 runs / CI) using `fast-check`. Random tree shapes + random
  mutation sequences; asserts cached layout equals fresh-recompute
  layout after every mutation.
- **Bench** new `big` (5k nodes) and `huge` (10k nodes) scenarios. Pilates
  retains its substantial lead over WASM Yoga at both sizes (~9× at
  5k, ~6.6× at 10k on tree-build-then-layout).
- **CI** new `bench/check-budgets.ts` script + warn-only
  `perf-budgets.yml` workflow. Phase 2 will tighten thresholds and
  flip to fail-on-regression.

### Performance hardening — Phase 2

- **Internal** per-node `LayoutCache` (1 slot per node, matching Yoga
  `LayoutResults::cachedLayout` and Taffy's 1-slot layout cache). Wired
  into the root `calculateLayout` path; cache stores happen post-order
  in `computeScrollSizes` (so all `_layout` fields including
  `scrollWidth`/`scrollHeight` are populated before capture). Lazy-
  allocated; only nodes that have been laid out at least once carry it.
  Public API unchanged.
- **Internal** `snapshotForCache` + `restoreFromCache` helpers in
  `algorithm/cache.ts`. The Phase 1 `clearAllCaches` helper now clears
  both `_measureCache` AND `_layoutCache`.
- **Internal correctness fix** the layout cache fast-path inside
  `layoutChildren` is gated by a `useCache: boolean` parameter (default
  `false`). The root cache-hit path passes `useCache=true` (it skips
  `roundLayout` entirely); the cold path leaves the default `false`.
  This avoids a subtle rounding-after-restore bug where re-running
  `roundLayout` over a tree containing restored deep-descendant
  positions would produce wrong integer cells if ancestor coordinates
  shifted between passes. The fuzzer surfaced this at run 116 during
  development; a deterministic regression test now pins it.
- **Bench** new `hotrelayout` scenario — 1k-node persistent tree, single
  leaf mutated per iteration. The workload Yoga still wins on
  (markDirty propagates to root every frame, so no inner-cache hits).
  Tracked as a baseline for Phase 3+ relayout-boundary work.
- **CI** perf-budget thresholds tightened (~1.5–2× measured numbers,
  down from Phase 1's 3× headroom). `bench:budgets` script now exits
  non-zero on violations; `perf-budgets.yml` workflow fails CI on
  regression.
- **Tests** fuzzer mutation set expanded from 4 to 7 types (added
  `setFlexShrink`, `setMargin`, `setFlexDirection`). New
  `cache.invariants.test.ts` covers spec open questions:
  `parentDirection` redundancy, absolute-position child round-trip,
  margin invalidation correctness.

## [1.0.0-rc.2] — 2026-05-07

### Overflow (Track 1 P2 prep)

- **Added** `Style.overflow` / `overflowX` / `overflowY` (`'visible' | 'hidden' | 'scroll' | 'auto'`). Default `'visible'`.
- **Added** `Node.setOverflow` / `setOverflowX` / `setOverflowY` setters.
- **Added** `Node.scrollLeft` / `scrollTop` mutable fields (paint-time, no markDirty).
- **Added** `ComputedLayout.scrollWidth` / `scrollHeight` and `Node.scrollWidth` / `scrollHeight` getters.
- **Verified** `overflow: scroll/hidden` preserves children's natural (unconstrained) size.
