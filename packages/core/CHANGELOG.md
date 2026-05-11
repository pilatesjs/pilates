# Changelog

All notable changes to `@pilates/core` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## [1.0.1] — 2026-05-11

### Fixed

- Exported `VERSION` constant was stuck at `'1.0.0-rc.1'` in the 1.0.0
  publish. Now reports `'1.0.1'` matching `package.json`. No other
  changes; consumers can upgrade transparently.

## [1.0.0] — 2026-05-09

The `@pilates/core` 1.0.0 milestone. Three rounds of performance
hardening on top of `1.0.0-rc.2` brought Pilates from "fast on
tree-build" to faster than WASM Yoga on every benchmarked workload
(7–12× across tree-build-then-layout, ~9× on the hot-relayout pattern
Yoga had been winning on). Public API is unchanged from `rc.2`.

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

### Performance hardening — Phase 3 (relayout boundaries)

- **Internal** Flutter-style relayout boundaries: a node with explicit
  `width` AND explicit `height` AND `flexGrow <= 0` AND `flexShrink <= 0`
  acts as a layout boundary. Descendant mutations dirty the boundary
  but stop propagating to ancestors, so root `_layoutCache` stays
  valid and hits on subsequent `calculateLayout` calls. The strict
  flexGrow/flexShrink check is empirically required: the fuzzer
  surfaced a `cached=17 vs cold=16` width drift when grow>0 boundaries
  were considered eligible, since the parent's flex distribution can
  produce slightly different post-grow widths under sibling-style
  interactions.
- **Internal** new `Node._forceDirty()` `@internal` method bypasses
  the boundary check; used only by `markDirtyDeep` in
  `algorithm/cache.ts` for differential-mode and fuzzer validation.
- **Internal** new `Node._hasDirtyDescendant` flag propagates
  upward through boundaries (without marking ancestors dirty). The
  root cache-hit path uses this to skip subtrees with no mutations
  at all — turning the boundary-scenario path from O(N) iteration of
  root's children to O(dirty subtree).
- **Internal** `markDirty()` split into two paths:
  `markDirty()` (called by setters) always propagates upward;
  `markDirtyFromChild()` (called only from descendant propagation)
  applies the boundary check. Necessary because the boundary's own
  setter changes its preferred size, which the parent's flex still
  needs to react to.
- **Internal** when a dirty boundary runs the cold path inside a root
  cache-hit pass, `roundLayout` and `computeScrollSizes` are skipped
  by `calculateLayoutImpl`. `layoutChildren` now inlines per-subtree
  versions (`roundLayoutSubtree` exported from `algorithm/round.ts`,
  `computeAndCacheScrollSizes` local to `main-axis.ts`) so the
  boundary's subtree gets correctly rounded and scroll-sized in that
  scenario. The `useCache` parameter on `layoutChildren` gained
  `parentAbsX`/`parentAbsY` parameters so subtree rounding uses the
  correct absolute coordinates.
- **Bench** new `hotrelayoutboundary` scenario — same shape as
  `hotrelayout` but with explicit-sized row containers that act as
  boundaries. Demonstrates the Phase 3 win:
  - Pilates `hotrelayoutboundary`: ~10.8µs (~92.5k ops/s)
  - Pilates `hotrelayout`: ~199µs
  - Yoga `hotrelayoutboundary`: ~95.4µs
  - Pilates is **~18× faster than the boundary-less Pilates path**
    and **~9× faster than WASM Yoga** on this workload — the workload
    Yoga traditionally wins.
- **Public API unchanged.** Boundaries auto-detected from existing
  style; no new setters or getters exposed.

## [1.0.0-rc.2] — 2026-05-07

### Overflow (Track 1 P2 prep)

- **Added** `Style.overflow` / `overflowX` / `overflowY` (`'visible' | 'hidden' | 'scroll' | 'auto'`). Default `'visible'`.
- **Added** `Node.setOverflow` / `setOverflowX` / `setOverflowY` setters.
- **Added** `Node.scrollLeft` / `scrollTop` mutable fields (paint-time, no markDirty).
- **Added** `ComputedLayout.scrollWidth` / `scrollHeight` and `Node.scrollWidth` / `scrollHeight` getters.
- **Verified** `overflow: scroll/hidden` preserves children's natural (unconstrained) size.
