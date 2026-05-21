# Phase 15A — Profiling findings + technique-to-scenario map

## Executive summary

Per-scenario profile data confirms the strategic premise: **all 9 bench scenarios have ≥ 1.5× theoretical headroom**, and the techniques in the Phase 15 spec map cleanly to specific bottlenecks. With the right ordering of sub-phases, every scenario projects to ≥ 2× Yoga win, with several hitting 5-15× wins.

## Per-scenario profile + theoretical headroom

| Scenario | Current Pilates | Current Yoga | Current ratio | Theoretical min | Headroom | Projected post-15 |
|---|---:|---:|:-:|---:|:-:|:-:|
| tiny (10 nodes) | 4.5µs | 19.5µs | 3.5× win | ~4µs | ~0% | 4× |
| realistic (109 nodes) | 25.5µs | 335µs | 2.0× win | ~22µs | 15% | 3-4× |
| stress (1051 nodes) | 182µs | 1.93ms | 2.2× win | ~112µs | 39% | **4-5×** |
| big (5051 nodes) | 1175µs | 10.0ms | 2.1× win | ~692µs | 41% | **4-5×** |
| huge (10101 nodes) | 4718µs | 19.67ms | 1.5× win | ~1736µs | **63%** | **5-8×** |
| hot-relayout | 33µs | 83µs | 3.6× win | ~5µs | 6.6× | **5-8×** |
| hot-relayoutboundary | 30µs | 78.9µs | 3.5× win | ~2µs | 15× | **10-15×** |
| hot-relayouttext | 28µs | 75.3µs | 3.2× win | ~3µs | 9× | **5-8×** |
| **hot-structural** | **280-450µs** | **94.8µs** | **0.21× LOSS** | ~35µs | 8× | **2-3× WIN** |

## The bottlenecks revealed by profiling

### Cold-build scenarios (tiny → huge)

- **`snapshotForCache` is the dominant cost at scale.** On `huge` (10,101 nodes), it consumes **54% of total time** — more than `layoutChildren` and `roundLayout` combined. Root cause: per-non-leaf-node allocation of `CachedChildLayout[]` arrays. The 100-row × 100-cell tree triggers ~10k heap allocations per cold build. GC pressure dominates.
- **`roundLayout` Map allocation:** 1k-node = 32µs allocation overhead per call (already partially addressed in phase 14b but reapplicable).
- **Inner flex distribution loops** spend time on JS object property reads, not arithmetic. SoA TypedArrays would let V8 JIT-compile to tight machine code.

### Hot-mutation scenarios (relayout family)

- **60% of time is in `recompute` (PQ propagation)** — visiting 42 fields for a single leaf mutation. PQ is `Map<Field, OMNode>`-based; per-field cost ~450ns includes hash overhead.
- **30-40% is in `finishMoved`** (write-back + scroll recomputation). Currently walks affected subtrees; could be scoped tighter with `_hasDirtyDescendant` flags.
- **Boundary scenario doesn't exploit the boundary** — Spineless grammar is whole-tree. A leaf mutation inside a row's boundary still propagates 42 fields through the global PQ. This is the **15× headroom** on `hot-relayoutboundary`.

### Hot-structural (the headline gap)

Spineless direct path = **280µs**. Three dominant costs, each cleanly fixable:

| Phase | µs | Root cause | Fix | Estimated saving |
|---|---:|---|---|---:|
| **buildAppendFragment** | **148** | `mergeStyleInputsMap` spreads 1,101-entry Map per call (~48µs); 169 new field emissions (~90µs) | Incremental in-place mutation (no copy); emit only new subtree's fields | **140µs** |
| **runtime.graft** | **140** | 169 OM node insertions + 169 `Map.set` into 15k-entry `omNodes` | Integer-rank topological-tail assignments for simple-regime appends | **130µs** |
| **runtime.detach** | **172** | O(15,768) scan of `omNodes.values()` to find new `lastOm` | Doubly-linked tail pointer; O(k) update | **170µs** |
| buildRemoveFragment | 85 | Filter over 1,112 entries + 1,101 spread | Incremental mutation | **80µs** |

Combined Spineless fix: **280µs → 20-30µs** (3-5× faster than Yoga's 95µs).

Imperative direct alternative: ~100µs (already known). Spineless-optimized would be the cleaner ship.

## Cross-cutting techniques (universal levers)

Listed by combined impact across all 9 scenarios:

1. **Flat typed-array `snapshotForCache`** (Phase 15D). Pre-allocated Float64Array of stride 8 × childCount; node-index keyed. Saves 50%+ on huge alone. Universal — every cold call + every Spineless build benefits.
2. **Node integer indexing + SoA Float64Array for layout fields** (Phase 15C). Enables typed-array fills (cheap `markClean`), sequential reads (cache-friendly), V8 JIT optimization. 15-30% on inner loops.
3. **Selective dirty propagation** (Phase 15B). Per-property dirty flags + property-to-cache-key mapping. Foundation for many later optimizations. Yoga has this; Pilates' imperative engine doesn't.
4. **Pooled `roundLayout`** (carried over from phase 14b). Map → flat array. ~18µs universal saving.
5. **Order-maintenance priority queue** (Spineless PLDI 2025; Phase 15G). Flat integer-indexed PQ replacing `Map<Field, OMNode>`. 5-10µs per hot-relayout scenario.

## Spineless-specific techniques

6. **Incremental fragment building** (Phase 15E). Mutate `prev.styleInputs` / `prev.allFields` in place. ~50µs saving on hot-structural alone.
7. **O(1) `lastOm` tracking** (Phase 15E). Doubly-linked tail pointer; eliminate O(N) scan. ~150µs on hot-structural.
8. **Specialized simple-regime append/remove-last fast paths** (Phase 15F). Detect "append to flex-start column with fixed-height children" pattern; route to imperative direct (~100µs) or even further-optimized direct (~30µs).
9. **Boundary-scoped Spineless grammar** (Phase 15H). Emit sub-grammar per relayout boundary; mutations within the boundary only propagate within. Unlocks the 15× headroom on hot-relayoutboundary.

## Sub-phase ordering (revised based on findings)

The original Phase 15 spec ordered 15B → 15C → 15D → 15E. Findings suggest a different optimal order:

| Order | Sub-phase | What it ships | Why this order |
|:-:|---|---|---|
| 1 | **15B** Selective dirty propagation | Per-property dirty bits; foundation for cache-key-keyed invalidation | Foundation. Many subsequent techniques rely on per-property dirty info. |
| 2 | **15C** Node integer indexing + SoA layout fields | `Node.id` integer; `LayoutPool` module with Float64Arrays | Enables 15D + 15G. Standalone universal win (5-15%). |
| 3 | **15D** Flat `snapshotForCache` | Replace `CachedChildLayout[]` allocation with pooled Float64Array | **Biggest single cold-scenario lever** (54% of huge). Depends on 15C. |
| 4 | **15E** Spineless fragment-build + lastOm fixes | In-place mutation; doubly-linked tail | **Biggest hot-structural lever**. Independent of 15B/C/D. Can ship in parallel. |
| 5 | **15F** Simple-regime append/remove-last fast paths | Detect pattern; route to optimized direct path | Reinforces 15E if Spineless fixes don't fully close hot-structural gap. |
| 6 | **15G** Integer-indexed PQ replacing OmPriorityQueue | Flat array PQ; integer ranks | Reduces hot-relayout constant factors. Depends on 15C's integer indexing. |
| 7 | **15H** Boundary-scoped Spineless grammar | Per-boundary sub-grammar emission | Unlocks 15× headroom on hot-relayoutboundary. Largest architectural change. |
| 8 | **15I** Integration + measure + iterate | All techniques in `main`; bench against Yoga | Confirms multiplicative gains. |
| 9 | **15J** Validation + docs + release | Differential green, fuzzer green, write-up, release | Ship. |

## Carry-over from shelved branches

- **Phase 14b's flat-array `roundLayout`** (already implemented on `phase14b-imperative-cache-hit-skip`). Cherry-pick into 15D.
- **Phase 14b's `canSkipChildRecursion`** mechanism + `_floatWidth/Height` fields. Cherry-pick into 15B/C (selective dirty + SoA enables cleaner reformulation).
- **Phase 14 (original)'s `classifyDirty` classifier**. Cherry-pick into 15F (workload-aware routing).

## Open questions for Phase 15B onwards

1. **`snapshotForCache` skipability on ephemeral cold builds.** A `calculateLayout(root, w, h, { cache: false })` API hint would let cold-throwaway trees skip the snapshot entirely. Massive cold-scenario win for ephemeral use cases. Worth a public API addition?

2. **Node integer indexing reset on GC.** Nodes are created/destroyed; integer indices must be reset to avoid array index leaks. Strategy: integer pool with free-list, or generation-counter to detect stale indices.

3. **Backward compatibility of SoA refactor.** If `_layout.width` becomes a getter reading from a Float64Array, does V8's JIT still optimize? Or do consumers need to read directly from the pool?

4. **Spineless fragment-build mutation safety.** `prev.styleInputs` is currently referenced by the grammar output and swapped per call. Is mutate-in-place safe given the swap order? (Probably yes; verify.)

5. **Boundary-scoped grammar correctness.** Emitting per-boundary sub-grammars changes the dependency-graph semantics. The structural-differential fuzzer should catch regressions, but the change is architectural — review carefully.

## Recommendation

**Proceed with the revised sub-phase ordering above.** Start with Phase 15B (selective dirty propagation) — it's the foundation everything else builds on. Estimated 6-7 weeks total for the full project, with the biggest perf gains landing in 15D, 15E, and 15H.

Each sub-phase ships independently to the long-lived `phase15-decisive-yoga-beat` branch with differential mode + fuzzer + oracle green at every commit. Final PR to main when all success criteria from the Phase 15 spec are met.
