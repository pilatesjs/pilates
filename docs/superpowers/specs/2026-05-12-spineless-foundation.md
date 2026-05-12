# Phase 5 Spineless Traversal — Foundation (Phase 5a, OM data structure)

**Date:** 2026-05-12
**Status:** Both Naive and Bender impls in place. Cross-validated. Bender is 35× faster than Naive on inserts at N=10k. Phase 5a continues with priority queue, then attribute grammar refactor.
**Plan reference:** `~/.claude/plans/precious-plotting-willow.md`

## Context

Spineless Traversal (Kirisame, Wang, Panchekha — PLDI 2025) is the
state-of-the-art incremental layout algorithm. Foundational primitive:
an Order Maintenance (OM) data structure that supports `insertAfter`,
`delete`, and `compare` in O(1) amortized.

The OM is the **highest-risk component** of the Phase 5 port:
- Paper uses inline `cmov` for branchless compare (not portable in JS)
- Bender et al. 2002's two-level scheme depends on pool allocators and
  cache-friendly memory layout (JS has neither)
- If JS overhead is too high, the whole Spineless approach is dead

This commit lands the **foundation**: interface design + naive
scaffolding impl + comprehensive tests + microbench. The Bender
amortized-O(1) impl is the next step.

## What landed

### `packages/core/src/algorithm/spineless/order-maintenance.ts`

- **`OMNode` and `OrderMaintenance` interface** — what the Spineless
  runtime will consume. Designed so the impl can be swapped (naive ↔
  Bender) without ripple. Public method count: 4 (`init`,
  `insertAfter`, `delete`, `compare`).
- **`NaiveOrderMaintenance` class** — single doubly-linked list with
  sequential integer tags. `insertAfter` renumbers trailing nodes
  (O(N)). `compare` is O(1) integer subtract. `delete` is O(1).
  Stays in tree forever as a **fuzzer oracle** for the future Bender impl.

### `packages/core/src/algorithm/spineless/order-maintenance.test.ts`

- **13 tests, all passing.** Covers: init, insertAfter at all positions,
  chain of 100 inserts, mid-list insert preserving invariants, delete
  + re-insert, antisymmetry, transitivity, 1000-node correctness, mixed
  insert/delete sequences.

### `packages/core/src/algorithm/spineless/order-maintenance.bench.ts`

- **Microbenchmark.** Run with `npx tsx <path>`. Targets:
  - `compare` < 200ns at N=10k (hot path — Spineless priority queue)
  - `insertAfter` < 5µs amortized at N=10k (Bender target; naive
    exceeds it by design)

## Kill-switch viability check — RESULTS

Run on Windows, Node 22, single-threaded JS:

| Operation | N=100 | N=1000 | N=10000 | Target | Pass? |
|---|---:|---:|---:|---:|---|
| `compare` | 45ns | 24ns | 15ns | <200ns | ✅ **PASS** (3-13× under) |
| `insertAfter` (naive) | 0.4µs | 0.9µs | 7.0µs | <5µs amortized | ⚠️ Naive exceeds at 10k by design |

**Verdict: OM is viable in pure JS.** The hot-path compare is extremely
fast (V8 lowers integer subtract to native instructions, giving us
~67M ops/sec at N=10k). The insertAfter overshoot is the expected
O(N) renumber cost of the naive impl, which the Bender amortized-O(1)
impl removes.

**Phase 5 proceeds.** If `compare` had been >1µs, the Spineless priority
queue would be too slow to justify the architectural complexity — we
would have aborted Phase 5 here and stuck with imperative layout. It
wasn't, so we continue.

## What landed (Bender impl, second commit on this PR)

`BenderOrderMaintenance` — Algorithm 1 from Bender, Cole, Demaine,
Farach-Colton, Zito (2002): "Two simplified algorithms for maintaining
order in a list."

**List-labeling with windowed relabel:**
- 30-bit integer labels in `[0, 2^30)` — fits V8's SMI representation
- Insert: midpoint of predecessor and successor labels
- On collision (no room): walk exponentially-growing windows around
  the insertion point until a window satisfies `count * 2 ≤ span`,
  then redistribute labels uniformly across that window
- Global rebalance fallback when no window short of full label space
  satisfies the bound

**Complexity:**
- `compare`: O(1) integer subtract
- `insertAfter`: amortized O(log N) (looser than the paper's O(1) with
  density bound (3/2)^d; we use a stricter integer bound for V8-
  friendly speed)
- `delete`: O(1)

**Cross-validation:** A 500-run property-based fuzzer (fast-check) runs
random insert/delete sequences on both Naive and Bender impls in
parallel, asserting `sign(compare(a, b))` matches across both for
every pair after every operation. Caught the initial threshold bug in
the redistribution logic (count*2 ≤ span condition); fixed.

**Microbench results** (Windows, Node 22):

| Op | Impl | N=100 | N=1000 | N=10000 |
|---|---|---:|---:|---:|
| compare | Naive | 45ns | 21ns | 13ns |
| compare | Bender | 21ns | 29ns | 13ns |
| insertAfter | Naive | 0.4µs | 0.9µs | **7.0µs** |
| insertAfter | Bender | 0.4µs | 0.13µs | **0.2µs** |

Bender is **35× faster than Naive at N=10k inserts**. Both impls have
identical compare costs (~13-29ns at scale).

## What's next (Phase 5a continuation)

1. **Priority queue keyed on OM nodes** (~1 week)
   - Min-heap with OM `compare` as ordering
   - Operations: push, peek, extract-min, delete
   - The Spineless runtime's hot data structure

2. **Attribute grammar definition for flexbox** (~2-3 weeks)
   - Express the imperative flex algorithm (`packages/core/src/algorithm/main-axis.ts`)
     as a set of attribute-level dependencies
   - Each layout field (width, height, mainPos, finalMain, etc.) has
     a rule that computes it from other fields
   - Output: `packages/core/src/algorithm/spineless/grammar.ts`
   - Validation: a "grammar interpreter" produces byte-identical
     results to imperative algorithm across the existing 891-test
     suite + 500-run fuzzer

3. **Spineless runtime** (~3-4 weeks)
   - `recompute(field)` driver: pop from priority queue, run the
     field's rule from the grammar, push dependents if value changed
   - The priority queue is keyed on OM timestamps, so traversal
     follows topological order without explicit DAG walks
   - Behind a `PILATES_SPINELESS_LAYOUT=1` env flag
   - Differential mode validates byte-identical results to imperative

4. **Bench + ship** (~2 weeks)
   - New `hot-relayout-text` bench scenario (mutates leaf text content
     every frame, the realistic TUI workload)
   - Compare against current imperative + Yoga
   - Document and ship as `@pilates/core@1.1.0` if perf gain materializes

**Total Phase 5a remaining: ~10-12 weeks of focused work after this
foundation.**

## Why this matters

After 23 rounds of literature survey (documented in the plan file),
Spineless Traversal remains the most advanced published incremental
layout algorithm. **No production engine has implemented it.** Chrome
LayoutNG, Firefox Stylo, Yoga, Taffy, Flutter, RN Fabric, SwiftUI,
Compose — all use last-decade's Double Dirty Bit or Flutter-style
relayout boundaries. Flexily (direct production competitor, pure-JS
Yoga replacement) uses a simpler fingerprint cache.

Pilates implementing Spineless first creates:
- The first production datapoint at TUI scale
- A defensible academic-engineering contribution (basis for a follow-on
  paper or blog post on industrial implementation lessons)
- Decisive performance differentiation in the TUI layout space

The user's framing: "we are making something cutting edge and could
change the world." This is the path.
