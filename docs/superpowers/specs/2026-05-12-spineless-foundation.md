# Phase 5 Spineless Traversal — Foundation (Phase 5a, OM data structure)

**Date:** 2026-05-12
**Status:** OM (Naive + Bender) ✅. OM-keyed priority queue ✅. Attribute grammar type system + topological interpreter ✅. Flex grammar v1 (row, fixed-width) ✅. Flex grammar v2 (column joins row) ✅. Flex grammar v3 (flex-grow distribution) ✅. Flex grammar v4 (flex-shrink + flexBasis) ✅. Flex grammar v5 (margin / padding / gap) ✅. Next slice: alignment (v6).
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

## What landed (priority queue, third commit on this PR)

`OmPriorityQueue<T>` — min-heap with OM-comparator. Generic over the
value type so the Spineless runtime can key on `(Node, fieldName)`
pairs (or whatever shape the runtime uses).

**Implementation:**
- Binary min-heap over parallel arrays (`heapValue`, `heapOmNode`)
  to avoid per-push pair-object allocation. Matters at Spineless
  scale (1k-10k pushes per layout pass).
- Membership tracking via internal `Set` for O(1) `has(value)` —
  enables runtime-side dedup of "already-queued" fields.
- O(log N) push / popMin, O(1) peek / size.

**Correctness under OM relabel:** The Bender impl relabels OM tags
on insert (windowed redistribute). The heap invariant is "parent
precedes all descendants by OM compare". Relabel preserves the
RELATIVE order of all live OM nodes, so `sign(compare(a, b))` is
unchanged — the heap invariant holds without explicit reshuffling.

**Cross-validation:** A 500-run property-based fuzzer compares
the heap's extraction order against a sorted-array oracle. Each push
uses a fresh OM node (mirroring the runtime's "one OM node per
(Node, field)" invariant) so the oracle has unambiguous tie-breaking.

**Microbench** (Bender OM under, Windows, Node 22):

| Op | N=100 | N=1000 | N=10000 |
|---|---:|---:|---:|
| push | 141ns | 71ns | 100ns |
| popMin | 143ns | 148ns | 152ns |

Both ops stay flat-to-decreasing as N grows. **13-28× under the 2µs
target.** Spineless runtime overhead at TUI scale (~10-100 dirty
fields propagated per leaf mutation) will be ~30µs per layout pass.

## What landed (grammar foundation, fourth commit on this PR)

Type system + naive interpreter for the attribute grammar. The
architectural skeleton that the full flexbox grammar (next sub-phase)
and Spineless runtime (the one after) build on.

**`packages/core/src/algorithm/spineless/grammar.ts`:**

- **`Field<T>`** — `(Node, name)` pair identifying a single attribute.
  Identity-stable via the `field(node, name)` helper backed by a
  per-node `WeakMap`. Two `field()` calls with the same args return
  the same object → usable as `Map`/`Set` keys without custom hashing.
- **`FieldRule<T>`** — `{ deps, compute(read) }`. The unit of
  declarative layout: each rule reads its declared dependencies and
  produces a value. Pure-function contract (interpreter enforces:
  `compute` callback throws if a rule reads outside its `deps`).
- **`Grammar`** — `Map<Field, FieldRule>`. The whole layout
  algorithm, expressed as a static map.
- **`TopoInterpreter`** — naive evaluator. DFS over the dependency
  DAG, evaluates each reachable field exactly once per `evaluate()`
  call, caches by field identity, throws on cycles. **Not
  incremental** — that's what the Spineless runtime adds in the next
  sub-phase. The interpreter serves two roles:
  1. Correctness oracle (Spineless runtime asserts byte-identical
     output via differential mode).
  2. Bootstrap path — grammar correctness can be developed and
     validated independently of the runtime.

**Tests (13):** identity invariants, basic evaluation, dep chains,
caching, reset, cycle detection, undeclared-dep enforcement, demo
grammar (2-element fixed-width row with butt-joint invariant).

Coverage: 93.19% on `spineless/` overall, 90.74% on `packages/core/src/**`.

## What landed (flex grammar v1, fifth commit on this PR)

**First flex slice expressed as an attribute grammar** —
`packages/core/src/algorithm/spineless/flex-grammar.ts`.

This is the SMALLEST useful slice. Future slices expand the feature
set one chunk at a time, each gated by a differential test against
the imperative algorithm.

| Feature | Status | Roadmap |
|---|---|---|
| flex-direction: row | ✅ v1 | |
| Explicit width / height | ✅ v1 | |
| flex-direction: column | ✅ v2 | |
| flex-grow | ✅ v3 | |
| flex-shrink | ✅ v4 | |
| flex-basis (separate property) | ✅ v4 | |
| Margin / padding / gap | ✅ v5 | |
| Alignment (justify, align-items) | ❌ | v6 |
| flex-wrap | ❌ | v7 |
| Absolute positioning | ❌ | v8 |
| flex-direction: row-reverse / column-reverse | ❌ | later |
| min/max width/height (multi-pass freeze loop) | ❌ | later |
| Integer-cell rounding folded into the grammar | ❌ (post-pass for now) | later |

**Differential validation (9 tests, all pass):** every fixed-width-row
tree in the test corpus produces byte-identical layouts from the
grammar via `TopoInterpreter` and from the imperative algorithm via
`calculateLayout()`. The `evaluateGrammar()` and `evaluateImperative()`
helpers are the gate every future slice must keep green.

**Fields emitted per node:** `width`, `height`, `left`, `top`. Rules
wire deps explicitly: a child's `left` reads all prior siblings'
`width` (sparse-and-explicit dependency DAG, optimal for Spineless).

Coverage: 94.69% on `spineless/`, 90.86% overall.

## What landed (column direction, v2 — sixth commit on this PR series)

The second flex slice: `flex-direction: column` joins `row` as a
supported parent direction. Row-reverse and column-reverse are
explicitly rejected for now — they need the main-axis accumulator to
walk backwards, which is its own slice.

**Implementation change:** `buildFlexGrammar` no longer hard-codes
`left` and `top` to their row meanings. Instead, the parent's
`flexDirection` selects which of `{left, top}` is the main axis vs
the cross axis, and which child size (`width` vs `height`) gets
summed across prior siblings. The cross-axis offset stays 0 (no
alignment in this slice). The dependency DAG remains sparse-and-
explicit: a child's main-axis offset depends on every prior
sibling's main-axis size, mirroring the row case but in the
flipped dimension.

**Differential validation (8 new tests, 18 total, all pass):**
column-only trees (single, two, five, overflow), butt-joint
invariant, plus mixed-direction nesting (column-of-rows and
row-of-columns). Two negative tests confirm `row-reverse` and
`column-reverse` throw at build time.

Coverage: 100% on `flex-grammar.ts`, 94.83% on `spineless/` overall.

## What landed (flex-grow, v3 — seventh commit on this PR series)

The third flex slice: positive `flexGrow` values now redistribute
leftover main-axis space across siblings, proportionally to their
weights. With Pilates's default `flexShrink: 0`, overflow cases leave
basis values intact (matching the imperative algorithm exactly), so
shrink is deferred to its own slice.

**Implementation change:** A child's main-axis size used to read
`style.{width|height}` directly. Now it splits in two:
- If the parent has zero children with `flexGrow > 0` → unchanged
  (basis-equals-style, v1/v2 behaviour).
- Otherwise → the child's main-axis size depends on the parent's
  main-axis size (the budget) and runs CSS flex-grow distribution
  with all sibling bases & grow weights captured inline. Since this
  slice intentionally has no min/max clamps, the freeze loop reduces
  to a single pass.

Position rules (`left`, `top`) are unchanged: they continue to sum
prior siblings' main-axis sizes, which now resolve to grown values
through the dep graph.

**Rounding — out-of-scope for v3:** Floating-point widths arise as
soon as a flex-grow ratio doesn't divide cleanly into the budget. The
imperative pipeline applies `roundLayout` at the end (round absolute
corners, derive sizes from rounded edges). For v3 the differential
test helper applies the same rule to the grammar's float output,
keeping comparisons byte-identical. Folding rounding into the field
graph as derived fields is reserved for a later slice.

**Differential validation (12 new tests, 30 total, all pass):**
single grow child in a row, two equal-grow siblings, weighted grow
(1:2), fixed + grow mix, exact-fit case (no growth), overflow case
(no shrink), column-direction single grow, column fixed + grow,
column weighted grow (1:3), a precondition test for non-numeric
sibling basis under flex-grow, plus regression tests confirming v1
and v2 trees still match.

Coverage: 100% on `flex-grammar.ts` (all branches), 95.39% on
`spineless/` overall.

## What landed (flex-shrink + flexBasis, v4 — eighth commit on this PR series)

The fourth flex slice closes out CSS flex distribution by adding the
shrink half plus the `flexBasis` property:

- **flex-shrink:** when sum of bases > budget and any sibling has
  `flexShrink > 0`, each shrink-positive sibling loses
  `(overflow * shrink * basis) / sum(shrink * basis)` — the CSS
  scaled-shrink rule. Mirrors the imperative `distributeShrink` in
  `main-axis.ts`, minus the freeze loop (no min/max clamping in this
  slice, so distribution still terminates in one pass).
- **flexBasis as a separate property:** a numeric `style.flexBasis`
  overrides `style.{width|height}` as the hypothetical main size used
  by distribution. Falls back to the style size when basis is `'auto'`.
  Mirrors `resolveHypotheticalMainSize`.

The "needs flex distribution?" predicate generalised from
"any child has grow > 0" to "any child has grow > 0, shrink > 0, or
numeric flexBasis". Outside that predicate the main size collapses to
the resolved basis (the v1/v2 fast path is preserved exactly).

**Differential validation (10 new tests, 40 total, all pass):**
two equal-shrink children (overflow split proportionally to basis),
asymmetric shrink weights (1 vs 2), shrink=0 + shrink=1 mix (only
the shrink-positive sibling absorbs overflow), different bases with
equal shrink (larger child shrinks more), column-direction shrink,
flexBasis overrides style.width, flexBasis + flexGrow, flexBasis +
flexShrink, a precondition test for non-numeric basis under shrink,
and a v3 regression check.

Coverage: 100% on `flex-grammar.ts` (all branches), 95.66% on
`spineless/` overall.

## What landed (margin + padding + gap, v5 — ninth commit on this PR series)

The fifth flex slice — spacing. Three CSS properties land together
because they share the same mechanic: each shifts positions and
contributes to the flex-distribution hypothetical sum without itself
being a distributable quantity.

**Implementation change:** The visit function gains axis-aware
spacing readers. Per child:
- `mainPos = padMainStart + myMarginMainStart + sum_priors(marginMainStart + mainSize + marginMainEnd) + indexInParent * gapMain`
- `crossPos = padCrossStart + myMarginCrossStart` (was 0)
- `mainSize`: when flex-distributing, the budget becomes
  `containerMain - padMainStart - padMainEnd`, and the hypothetical
  sum picks up `sum(basis + marginStart + marginEnd) + (n-1)*gap`.
  Both grow and shrink continue to redistribute on the basis part
  only — margins and gaps are fixed-width spacers.

Margin, padding, and gap default to 0 across the codebase, so the
v1–v4 fast paths reduce to the same constant offsets they did before
the change (no behavioural regression — the 42 prior tests stay
green untouched).

The previous "main pos depends on the sum of prior siblings'
mainSizes" dep graph is preserved: only the SIZES vary
incrementally; margins, padding, and gaps fold into a constant
offset captured at grammar-build time.

**Differential validation (13 new tests, 55 total, all pass):**
padding on row + column (shifts main and cross axes), padding
shrinks the grow budget, column-gap spaces row items, row-gap
spaces column items, gap subtracts from the grow budget,
per-child margins on both axes, margins in grow + shrink budgets,
combined padding+gap+margin trees in row and column, plus two
regression tests for prior slices.

Coverage: 100% on `flex-grammar.ts`, 96.09% on `spineless/` overall.

## What's next (Phase 5a continuation)

1. **Expand flex grammar coverage** (~2-3 weeks total, in slices)
   - Each new feature lands as a separate PR with its own differential
     tests against the imperative algorithm
   - Slices: column direction → flex grow/shrink → margin/padding/gap →
     alignment → wrap → absolute positioning
   - Output: `packages/core/src/algorithm/spineless/flex-grammar.ts`
     grows incrementally
   - Validation: `TopoInterpreter` produces byte-identical layouts
     to imperative algorithm across the 33 oracle fixtures + 500-run
     fuzzer

2. **Spineless runtime** (~3-4 weeks)
   - `recompute(field)` driver: pop from priority queue, run the
     field's rule from the grammar, push dependents if value changed
   - The priority queue is keyed on OM timestamps, so traversal
     follows topological order without explicit DAG walks
   - Behind a `PILATES_SPINELESS_LAYOUT=1` env flag
   - Differential mode validates byte-identical results to imperative

3. **Bench + ship** (~2 weeks)
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
