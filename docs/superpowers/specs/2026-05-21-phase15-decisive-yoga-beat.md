# Phase 15 — Decisive Yoga Beat: comprehensive optimization project

## Mission

**Make Pilates ≥ 2× faster than Yoga on every benchmarked workload, in pure TypeScript, via algorithmic innovations worth publishing.**

This is a multi-week strategic project. The user's directive: *"delay until we beat Yoga decisively everywhere; do everything we can — create a new algorithm or technology or library or dependency or cutting edge tool — we will shock the world."*

## The headline story we're building

> "A pure-TypeScript flexbox layout engine that beats Yoga's C++ implementation by 2–5× on every workload, using a novel combination of selective dirty propagation, order-maintenance priority queues (PLDI 2025), and JIT-friendly data layouts. No WASM. No native bindings."

This is publishable. This shocks. WASM doesn't shock — every engine uses WASM. **Pure-TS algorithmic superiority over C++ is the story.**

## Current state (the starting point)

`bench/RESULTS.md` post-phase-13, win32-x64, Node 22.21:

| Scenario | Yoga | Pilates (current) | Yoga vs Pilates |
|---|---:|---:|---|
| tiny | 19.5µs | 5.5µs | **Pilates 3.5× win** |
| realistic | 335µs | 164µs | **Pilates 2.0× win** |
| stress | 1.93ms | 868µs | **Pilates 2.2× win** |
| big | 10.0ms | 4.81ms | **Pilates 2.1× win** |
| huge | 19.67ms | 13.17ms | **Pilates 1.5× win** |
| hotrelayout | 83µs | 23µs | **Pilates 3.6× win** |
| hotrelayoutboundary | 78.9µs | 22.4µs | **Pilates 3.5× win** |
| hotrelayouttext | 75.3µs | 23.7µs | **Pilates 3.2× win** |
| **hotstructural** | **94.8µs** | **395-450µs** | **Yoga 4.2–4.8× win** |

8 of 9 are already Pilates wins. Only `hotstructural` remains. Phase 15's job: **convert that loss into a 2× win minimum** (hotstructural < 47µs), while either maintaining or strengthening the other 8 wins. Stretch target: 3-5× win on hotstructural (< 30µs) and 5-10× wins on the others.

## Success criteria (firm gates)

1. **All 9 bench scenarios:** Pilates median ≤ Yoga median × 0.5 (Pilates ≥ 2× faster).
2. **Stretch target:** Pilates median ≤ Yoga median × 0.3 on at least 6 of 9 scenarios.
3. **Pure TypeScript:** no WASM in critical paths. (Allowed: dev dependencies, build tooling.)
4. **All existing correctness gates green:** `pnpm test`, `pnpm test:differential`, structural-differential fuzzer at numRuns=300, Yoga oracle (33 fixtures).
5. **New bench-comparison.svg** showing the new perf profile.
6. **Technical writeup** explaining the techniques (publishable as a blog post or paper).
7. **Reproducible measurements:** run `pnpm bench:variance` 3 times; CI95 must contain all observed medians (existing per-platform thresholds gate this).

## Strategic approach

### Why each known technique matters

Based on the comprehensive research already done (see phase 14b spec + literature survey):

| Technique | What it gives us | Where it applies |
|---|---|---|
| **Selective dirty propagation** (per-property dirty bits + property-to-recompute mapping) | Avoid the "leaf mutates → whole parent re-distributes" cost. Yoga has this. Spineless has a graph-based version. Imperative engine doesn't. | hot-relayout, hot-relayouttext, hot-relayoutboundary |
| **Order-maintenance priority queue** (Spineless paper, PLDI 2025) | Skip auxiliary nodes during dirty traversal — go directly to dirty nodes in document order. Browser-engine 1.80× speedup; ours could be more at our scale. | hot-structural, hot-relayout, anything with sparse dirtiness |
| **JIT-friendly data layout** (SoA TypedArrays for hot loops) | V8 optimizes Float32Array loops to near-native speed. AoS (current JS objects) scatters property reads across cache lines. | All scenarios; biggest win on hot inner loops |
| **Expanded measurement cache** (Yoga's 8-entry strategy) | Higher cache hit rate on constraint variations. Pilates uses 1 slot. | All scenarios with cache reuse |
| **Generational dirty-bit fast exit** (Yoga's `computedFlexBasisGeneration`) | Cheap "haven't seen this node in this generation yet" check before any cache lookup. | hot-relayout, hot-structural |
| **Lazy fragment materialization in Spineless** | Don't allocate fields for non-flex children that never need incremental tracking. | hot-structural — closes Spineless's bookkeeping cost gap |
| **Specialized append/remove fast paths** | Single-shot recipes for "append last child to simple-regime parent" — bypass full fragment-build. | hot-structural |

### Why no single technique wins everything

- Selective dirty propagation alone: wins value-mutation workloads, doesn't help structural mutation cost.
- OM priority queue alone: wins sparse-dirtiness workloads, doesn't help workloads where every node IS dirty.
- SoA alone: wins inner loops, doesn't help control flow.
- Cache expansion alone: wins cache-thrash workloads, modest on workloads where cache already hits.

**The combination is the breakthrough.** Each technique targets a different bottleneck. Their gains compound multiplicatively.

## Phase structure

### Phase 15A — Deep profile + theoretical bounds (Week 1)

**Goal:** Per-scenario understanding of where time goes, what the theoretical lower bound is, and which techniques have the most leverage where.

**Deliverable:** A research document mapping each of the 9 bench scenarios to:
- Per-phase µs breakdown (root flex / per-child layout / rounding / dirty walks / cache lookups).
- Theoretical minimum (essential algorithmic work in JS).
- Top 3 leverage techniques for closing the gap.
- Estimated time-to-target via combination of techniques.

### Phase 15B — Selective dirty propagation infrastructure (Week 1-2)

**Goal:** Build per-property dirty tracking + property-to-recompute mapping. Replace the current "node-level dirty" bit with finer-grained tracking.

**Deliverables:**
- `_dirtyFlags: number` bitmask per node (e.g., `DIRTY_LAYOUT | DIRTY_MEASURE | DIRTY_STYLE_VALUE | DIRTY_STYLE_SIG`).
- Setters in `Node` mark only the relevant flags.
- Cache invalidation keyed on relevant flags (e.g., width mutation doesn't invalidate measurement cache).
- New tests + differential validation.

### Phase 15C — JIT-friendly data layout (Week 2)

**Goal:** Move hot-path numeric properties to TypedArrays indexed by node ID. Inner loops iterate flat arrays.

**Deliverables:**
- `LayoutPool` module: pre-allocated Float64Arrays for `width`, `height`, `left`, `top`, `_floatWidth`, `_floatHeight`, etc.
- Each node holds an index, not the values directly.
- Inner loops (`layoutFlexFlow`, `distributeFlex*`) operate on the typed arrays.
- Bench validates the V8 JIT optimization gain.

### Phase 15D — Order-maintenance priority queue (Week 3)

**Goal:** Implement the Spineless paper's data structure. Replace tree-walk dirty traversal with priority-queue-based traversal.

**Deliverables:**
- `OrderMaintenanceTree` module: O(1) amortized insert/delete/successor.
- Integration with `calculateLayout`: dirty nodes added to PQ; layout processes them in document order.
- Skip auxiliary (clean ancestor) nodes entirely.
- Fuzzer validation.

### Phase 15E — Measurement cache expansion + structural fast paths (Week 3-4)

**Goal:** Address remaining Spineless bookkeeping cost.

**Deliverables:**
- Expand `LayoutCache` from 1 slot to 8 entries (Yoga-style).
- Specialized `appendLastChild` and `removeLastChild` paths that bypass fragment-build.
- Lazy fragment materialization for never-touched simple-regime children.

### Phase 15F — Integration + iteration (Week 4-5)

**Goal:** All techniques in one engine. Measure. Iterate where gaps remain.

**Deliverables:**
- All optimizations in `main`.
- Bench shows ≥ 2× Yoga wins on every scenario.
- Differential + fuzzer + oracle all green.

### Phase 15G — Validation, documentation, release (Week 5-6)

**Deliverables:**
- Technical writeup in `docs/STRATEGY.md` + `docs/announcements/phase15-decisive-win.md`.
- Refreshed `bench-comparison.svg`.
- Updated README with the new perf claim.
- `@pilates/core@2.0.0` release (major bump — breaking optimizations to internal APIs may surface; if API-stable, 1.2.0 minor).
- Announcement post (HN, Reddit, Twitter, JS Weekly).

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Selective dirty propagation introduces subtle cache-staleness bugs | Medium | Differential mode is the controlling gate. Every cache invalidation reviewed against the dirty-bit-to-cache-key mapping. |
| OM priority queue overhead exceeds savings at our scale (1k nodes) | Medium-Low | Phase 15A measures this before committing. If OM is net-negative, drop it (we still get 2× wins from other techniques). |
| SoA refactor breaks existing tests in subtle ways | Medium | Phase 15C ships behind a feature flag initially; A/B testing the JIT effects. |
| Combined techniques don't compose multiplicatively (lose to coordination overhead) | Low-Medium | Phase 15F integration phase explicitly measures combined vs individual gains. |
| Pure-TS approach hits a wall and can't reach 2× target on hotstructural | Medium | Phase 15E is the last pure-TS attempt. If still gapped, phase 15H (contingency) adds WASM for the inner loop — accepting positioning compromise but hitting the perf target. |
| Yoga improves while we work | Low | Yoga is mature; major improvements unlikely in 6-week window. Track yoga-layout releases. |

## Branch + workflow

- One long-lived feature branch: `phase15-decisive-yoga-beat`.
- Each sub-phase (15A through 15G) commits to this branch with milestone commits.
- Differential mode + fuzzer must stay green at every commit.
- Bench measurements at end of each sub-phase recorded in `bench/RESULTS.md` (committed).
- Final PR to main when all success criteria met.

## Honest framing if we don't reach the target

If after all 7 sub-phases we land at e.g. 1.3× Yoga win on hotstructural (instead of 2×), ship with the framing: "wins Yoga on every measured workload, with 1.3-5× margins" — still industry-leading for a TypeScript layout engine. Phase 15 H would be the contingency adding minimal WASM if 1.5×+ becomes a release blocker.

If we hit a fundamental wall (e.g., pure-TS V8 limits cap us at 1.5× Yoga on hotstructural), the project still ships massive wins on 8 of 9 scenarios + a publishable technique writeup. That alone is a strong release.

## Why this is feasible

The probe data shows:
- Hot-structural in imperative engine: 153µs. Theoretical minimum: ~34µs (4.5× headroom).
- Pure TS overhead vs essential work ratio: ~3:1.

Yoga's ~95µs in C++ = ~50µs algorithmic work + ~45µs WASM bridging. To beat 95µs in pure TS, we need to do less work than Yoga's 50µs algorithmic minimum — by avoiding the redundant work. This is precisely what selective dirty propagation + OM priority queues achieve. The literature confirms it's possible. We just have to build it.

## Sub-phase plans

Each sub-phase has its own implementation plan in `docs/superpowers/plans/`:

- `2026-05-21-phase15a-deep-profile.md`
- `2026-05-22-phase15b-selective-dirty-propagation.md`
- `2026-05-25-phase15c-jit-friendly-data-layout.md`
- `2026-05-29-phase15d-om-priority-queue.md`
- `2026-06-02-phase15e-cache-expansion-fast-paths.md`
- `2026-06-09-phase15f-integration-iteration.md`
- `2026-06-16-phase15g-validation-docs-release.md`

(Dates above are *floors*, not deadlines — per the project's gating-conditions philosophy.)

## The bet

We're betting that **JS-on-V8 is fast enough to beat optimized C++ if you do meaningfully less work.** Every published incremental computation paper says yes. Yoga + Taffy don't implement the latest techniques. We will.

If this bet pays off, Pilates becomes the highest-performance flex layout engine on every JS runtime, with a technique writeup that's industry-relevant. That's the "shock the world" outcome.

If the bet partially pays off (some scenarios decisive, some marginal), we ship with honest framing and Pilates is still the highest-performance pure-TS flex engine on every JS runtime — still industry-leading.

Either way: this is the right project to commit to.
