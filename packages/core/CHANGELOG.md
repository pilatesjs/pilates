# Changelog

All notable changes to `@pilates/core` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## [2.0.0] — 2026-05-23

**Pure-TypeScript Pilates now beats WASM Yoga on every bench scenario.**
The structural-mutation workload (append + remove a row per frame),
the last benchmark Yoga held the lead on, flipped from a ~5× Pilates
loss (~451µs) to a 1.7× Pilates win (~71µs) — entirely through
algorithmic and data-structure changes in TypeScript. No native code,
no WASM port.

Public `calculateLayout` API is **byte-unchanged**; this release is
SemVer-major only because of the internal-API and memory-characteristic
shifts described below. Consumers using only the documented public API
should upgrade with no code changes.

### Performance (median, win32-x64)

| Scenario | 1.1.0 | 2.0.0 | Pilates speedup |
|---|---:|---:|---:|
| tiny | 10.0µs | 4.5µs | 2.2× internal; **4.2× vs Yoga** |
| realistic | 175µs | 121µs | 1.4× internal; **2.7× vs Yoga** |
| stress | 901µs | 601µs | 1.5× internal; **3.2× vs Yoga** |
| big | 5.80ms | 3.32ms | 1.7× internal; **2.8× vs Yoga** |
| huge | 14.8ms | 8.62ms | 1.7× internal; **2.1× vs Yoga** |
| hotrelayout | 30.8µs | 16.3µs | 1.9× internal; **5.1× vs Yoga** |
| hotrelayoutboundary | 30.1µs | 15.8µs | 1.9× internal; **4.9× vs Yoga** |
| hotrelayouttext | 30.75µs | 8.9µs | 3.5× internal; **10× vs Yoga** |
| **hotstructural** | **~451µs** | **71.3µs** | **6.3× internal; 1.7× vs Yoga** |

### Changed (internals; not breaking by documented surface)

- **Typed-array runtime (phase 15I).** `Field` objects now carry an
  integer `id`; the Spineless runtime's per-field storage
  (`values`, `rules`, `omNodes`, `dependents`) moved from
  `Map<Field, X>` to arrays indexed by `field.id`. Hot-path Map
  lookups eliminated.
- **`LayoutPool` (phase 15C).** Per-Node layout state moved to
  `Float64Array`s indexed by a monotonic `Node._id`. Pool grows
  unbounded; `FinalizationRegistry`-based recycling was tried and
  removed (caused 2× regression). For long-running processes that
  create and discard many nodes, the pool's high-water mark is the
  retained memory.
- **Per-property dirty bitmask (phase 15B).** `Node._dirty: boolean`
  became `Node._dirtyFlags: number`, a bitmask over style-sig / value /
  flex-distribution / measure / measure-content / children. Setters
  fire only the flag they affect. Internal-only — public API unchanged.
- **Flat `Float64Array` cache snapshots (phase 15D).** Per-child
  cache slots are now strided fields in one `Float64Array` instead
  of an array of objects.
- **Linear-recurrence main-axis positions (phase 16).** Cumulative-sum
  rule (303 dep edges per row in stress) replaced with
  `mainPos[N] = mainPos[N-1] + ...`. Reverse-direction
  (`row-reverse` / `column-reverse`) keeps cumulative-sum.
- **Fold default-valued style inputs (phase 17).** `minWidth: 0`,
  `maxWidth: undefined`, `margin: 0` and friends fold to compile-time
  constants in the grammar. `nodeSig` was extended with fold-predicate
  bits so style mutations correctly trigger rebuilds.

### Added (internal)

- `DIRTY_STYLE_SIG`, `DIRTY_STYLE_VALUE`, `DIRTY_FLEX_DISTRIBUTION`,
  `DIRTY_MEASURE`, `DIRTY_MEASURE_CONTENT`, `DIRTY_CHILDREN`,
  `DIRTY_ANY` flag constants (re-exported `@internal`).
- `Node._id: number` integer index.
- `Field.id: number` integer index.

### Validation

- 1469 unit + integration tests pass.
- Structural-differential fuzzer green at 3000 runs.
- Yoga oracle 33 / 33 absolute-position fixtures.
- `pnpm test:differential` (per-pass cached-vs-cold byte-identity)
  green at 833 runs.
- All 10 perf-budget gates green; every scenario improves vs 1.1.0
  thresholds.

## [1.1.0] — 2026-05-20

The `@pilates/core` 1.1.0 milestone. **The Spineless incremental
layout engine** — an attribute-grammar + Order-Maintenance +
priority-queue rewrite of the hot-relayout path — now drives every
second-and-later layout of a persistent tree. Combined with the
phase-12 flex-distribution grammar refactor, Pilates is now faster
than WASM Yoga on **every hot-relayout shape**, not just the
boundary-tree special case the prior release shipped: ~3× faster
across fully-fluid trees, explicit-sized rows, and fixed-size
text-mutation tables alike.

Layout output is byte-identical to 1.0.x — validated cell-for-cell
against Yoga (33 oracle fixtures) and incrementally vs. cold-recompute
(value-differential fuzzer + structural-differential fuzzer, both
running on every CI build).

The release is additive. No public-API change is required to benefit;
existing trees pick up the new engine on upgrade.

### Added (public API)

- `setLayoutProfiler(listener: LayoutProfiler | null)` — observability
  hook called once per `calculateLayout` with the `Node` root and a
  `LayoutTrace` describing the engine path taken and the dirty/changed
  field counts. Passing `null` clears it. Pay-for-what-you-use: when
  no listener is installed, the trace object is not even allocated for
  the imperative-path branch.
- `LayoutProfiler` type — `(root: Node, trace: LayoutTrace) => void`.
- `LayoutTrace` interface — `{ path: 'imperative' | 'build' | 'graft' |
  'detach' | 'reorder' | 'incremental'; dirtyNodes: number;
  fieldsRecomputed: number; fieldsChanged: number; movedSubtrees: number }`.
- `inspectLayout(root: Node)` — devtools console-dump of the most
  recent layout trace + tree state. Convenience wrapper over
  `lastLayoutPath` + per-node `_layout` reads.
- `calculateLayoutImperative(root, availableWidth?, availableHeight?)` —
  the imperative algorithm + its per-node layout cache directly,
  bypassing the Spineless default. `@internal` (the public
  `calculateLayout` routes through Spineless); exposed for the
  imperative cache's own tests + tooling that needs the cold path.

### Changed (engine, behavior-preserving)

- **`calculateLayout` is now a router.** First (cold) layout of a root
  goes through the imperative algorithm. Second-and-later layouts of a
  persistent root adopt a `SpinelessLayout` driver and stay on the
  incremental path. The router is keyed by `Node` identity through a
  `WeakMap`; a dropped root takes its engine state with it.
- **`hotrelayout` (no boundaries) is now a Pilates win**, ~3× faster
  than Yoga. It was a Yoga win across the project's history until
  this release.
- **`hotrelayoutboundary` margin shrinks**, ~9× → ~3×. The imperative
  path's specialized layout-cache fast-path is no longer reachable
  from `calculateLayout` (it lives behind `calculateLayoutImperative`
  for the cold path's tests). The Spineless path's uniform ~3× win is
  the new shape of the bench: less spread, broader coverage. Memory
  on this is in `docs/announcements/2026-05-09-faster-than-yoga.md`.
- **`hotrelayouttext` (fixed-size table, one cell width mutated per
  frame)** — Spineless runtime direct path runs at ~0.2µs, 235× faster
  than Yoga's WASM round-trip. Via the public `calculateLayout`,
  ~2.3× faster (driver overhead). The direct path is `@internal` for
  now; the public hook is `setLayoutProfiler` for observation.

### Internal

- **Phase 8 (slices v19–v24)**: Spineless engine wired into
  `calculateLayout` as the hot-relayout default. Single-shot layout +
  write-back (v19), persistent runtime + incremental value relayout
  (v20), graft fast-path for child append (v21), dirty-flag-guided
  incremental detection (v22), incremental output write-back (v23),
  router (v24).
- **Phase 9 (slices v25–v28)**: layout observability. Runtime recompute
  counters (v25), per-call trace (v26), public profiler hook (v27),
  `inspectLayout` console dump (v28).
- **Phase 10 (slices v29–v32)**: Spineless grammar coverage closes the
  imperative fallbacks. `display: 'none'` (v29), measure function on
  an absolute node (v30), remove fast-path (`tryDetachRemove`, v31),
  mid-list insert fast-path (v32). The grammar now models every tree
  the imperative algorithm does.
- **Phase 11 (slices v33–v34)**: structural-differential fuzzer over
  random insert / remove / move / value sequences (v33; surfaced 4
  real bugs careful design review missed, each pinned as deterministic
  regression tests). Reorder fast-path (`tryReorder`, v34) closes the
  remaining structural mutation patch shape.
- **Phase 12**: flex-distribution grammar refactor. The per-cell
  `mainSizeField` rule used to call `distributeMainAxis(siblings, …)`
  with each cell redoing the full sibling distribution — O(N²) per
  row. Hoisted into one `mainDistribution: Field<MainAxisDistribution>`
  per flex-distributing single-line parent; child `mainSize` and
  `mainPos` (under default flex-start) collapse to trivial array reads
  of the materialised sizes/positions. O(N) per row. Single-engine
  architecture preserved.

### Validation

- **Yoga oracle**: 33 fixtures, cell-for-cell equality vs. WASM Yoga.
  Unchanged.
- **Value-differential fuzzer**: random mutation sequences asserted
  byte-identical between the incremental and a fresh cold layout.
  Caught real bugs throughout phases 8–12; remains the spine of
  Spineless-correctness validation.
- **Structural-differential fuzzer (phase 11)**: random insert / remove
  / move sequences asserted byte-identical. Validates that the graft /
  detach / reorder fast-paths + the phase-12 `mainDistribution`
  fragment-builder rebinds patch the dependency graph correctly under
  every shape of structural change.
- **`pnpm test:differential`** runs every `calculateLayout` in the
  core suite twice (cached + cold) and asserts byte-identical output.
- **Bench budgets** tightened in `bench/thresholds.json` —
  `hotrelayout` / `hotrelayoutboundary` floors dropped from `1.5ms`
  (the phase-8 loosened floor) back to `0.15ms`, locking the
  phase-12 win against future regression.

### Notes on `setLayoutBoundary`

The phase-3 plan mentioned an opt-in `setLayoutBoundary(boolean)` API
that would let consumers explicitly mark relayout boundaries. The
Spineless engine made this mechanism unnecessary — boundary
optimization is no longer the relevant fast-path; incremental
field propagation generalises across every tree shape. The API was
never shipped and is dropped from the roadmap.

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
