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

## [1.0.0-rc.2] — 2026-05-07

### Overflow (Track 1 P2 prep)

- **Added** `Style.overflow` / `overflowX` / `overflowY` (`'visible' | 'hidden' | 'scroll' | 'auto'`). Default `'visible'`.
- **Added** `Node.setOverflow` / `setOverflowX` / `setOverflowY` setters.
- **Added** `Node.scrollLeft` / `scrollTop` mutable fields (paint-time, no markDirty).
- **Added** `ComputedLayout.scrollWidth` / `scrollHeight` and `Node.scrollWidth` / `scrollHeight` getters.
- **Verified** `overflow: scroll/hidden` preserves children's natural (unconstrained) size.
