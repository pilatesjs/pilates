# Spineless flex-distribution grammar refactor — phase 12

## Problem

Phase 8 wired the Spineless incremental engine into the public
`calculateLayout` as the default path for second-and-later layouts of
a persistent tree. That swap regressed the long-standing
`hotrelayoutboundary` headline benchmark — the workload README,
STRATEGY, RESULTS, and the launch announcement all use as the proof
that Pilates is faster than WASM Yoga on *every* benchmarked
workload.

Measured today on the same `hotrelayoutboundary` tree (1k-node,
50 rows × 20 cells, explicit-sized rows + flex cells), in one Node
process, win32/x64 Node 22, 500 iterations:

| Path | Median |
|---|---:|
| `Node.calculateLayout` (router → `SpinelessLayout`) | **125.1µs** |
| `SpinelessLayout.layout()` direct (no router) | 117.0µs |
| `calculateLayoutImperative` (imperative + `_layoutCache`) | **14.9µs** |
| `yoga-layout` (WASM) | 83.1µs |

The router path *loses* to Yoga ~1.5× on a benchmark it used to win
~5–7×. The dormant imperative engine still wins the same benchmark
**5.6× over Yoga today** — phase 8 swapped the engine for a
general-purpose incremental driver and that driver happens to be much
slower on this scenario.

A `LayoutTrace` and short profile probe localize the cost. Per
iteration the Spineless engine recomputes 40 fields × ~3.5µs each.
`finishIncremental` (write-back + round + scroll for the moved
subtrees) is ~5µs — *not* the bottleneck. The cost lives inside
`runtime.recompute()`, and inspecting the grammar explains why: each
in-flow child's `mainSizeField` declares dependencies on every
sibling's flex inputs and its `compute` calls
`distributeMainAxis(siblings, …)[myIndex]`. One cell's `flexGrow`
change invalidates all N siblings; each one's recompute redoes the
*full* distribution. The row's work is **O(N²)**.

## Approach

Fix the O(N²) in the grammar by hoisting the distribution into a
single intermediate Field per flex-distributing parent. Each
in-flow child's main-axis size and position become trivial array
reads.

For every parent that flex-distributes (any in-flow child with a
positive `flexGrow` or `flexShrink`), the grammar emits one
`mainDistribution` Field:

```ts
interface MainAxisDistribution {
  readonly sizes: readonly number[];     // sizes[i]     = i-th in-flow child's main size
  readonly positions: readonly number[]; // positions[i] = i-th in-flow child's main offset
}
```

Its `compute` runs `distributeMainAxis(siblings, innerMain, gap)`
once, then folds margins/gaps into the `positions` array. Its `deps`
are exactly what each cell's `mainSize` rule declares today (parent
main, gap, padding-start/end, and per in-flow sibling: flexBasis,
mainInput, flexGrow, flexShrink, margins, min, max) — hoisted from N
copies to one.

Each in-flow child's `mainSize` rule, currently:

```ts
{ deps: [parent main, gap, paddings, sibling[0]·8, …, sibling[N-1]·8],
  compute: (read) => distributeMainAxis(liveSiblings(read), …)[myIndex] }
```

collapses to:

```ts
{ deps: [parent.mainDistribution],
  compute: (read) => read(parent.mainDistribution).sizes[myIndex] }
```

The analogous `mainPos` rule (in the default `justify-content:
flex-start` regime; non-default justify is out of scope, see below)
becomes `read(parent.mainDistribution).positions[myIndex]`.

**Total work per row on one flex mutation** drops from
N × O(N) = O(N²) (today: 40 cell-fields × O(N) each) to one
parent-field at O(N) + 2N child-fields at O(1) — total O(N).

### Why this approach

Two alternatives were considered and rejected:

- **Router boundary fast-path.** Detect explicit-sized container
  subtrees in `calculateLayout` and route them to the imperative
  engine + `_layoutCache` (which today hits the 14.9µs ceiling
  measured above). Pros: lowest risk, reuses validated code, ships in
  days. Cons: reintroduces an engine split that phases 8–10
  deliberately removed (`spinelessSupports` deleted, the router's
  unsupported branch deleted); fixes `hotrelayoutboundary` but
  **not `hotrelayout`** (the no-boundary scenario), which the grammar
  refactor *does* fix; permanently maintains two engines.
- **Full grammar redesign.** Restructure the dependency model so flex
  propagates fundamentally differently. High blast radius, weeks of
  work, speculative gain over the targeted refactor.

The intermediate-Field refactor is the minimal change that addresses
the *root cause* in the architecturally correct place. Single
engine, generalizes to both regressed benches, fuzzer-validated
risk, ~1 week of work. Phase 13 candidates (non-default justify,
wrap, cross-axis) layer cleanly on the same pattern if benches later
say they matter.

If after a serious implementation pass the target isn't met, the
router boundary fast-path remains available as a clean 3–5 day
follow-up. Phase 12 is not burning that bridge.

## Goal & success criteria

1. **`hotrelayoutboundary`**: median ≤ Yoga's `83µs` on the bench
   machine. Stretch: within ~2× of imperative's 14.9µs ceiling.
2. **`hotrelayout` (no boundaries)**: median ≤ Yoga's `92µs`.
3. **No regression on `hotrelayouttext`, `hotstructural`, or any
   build-then-layout scenario** (`tiny`, `realistic`, `stress`,
   `big`, `huge`).
4. **No correctness regression** — value-differential and structural-
   differential fuzzers stay green; Yoga oracle fixtures stay green.
5. **Single-engine architecture preserved.** `calculateLayout` router
   stays exactly as it is; the fix lives entirely in the grammar.
6. **Bench budgets tightened.** `bench/thresholds.json` drops the
   `hotrelayoutboundary: 1.5ms` and `hotrelayout: 1.5ms` floors that
   phase 8 loosened, back to values that fail CI on future regressions.

## The grammar change in detail

Files touched:

- Modified: `packages/core/src/algorithm/spineless/flex-grammar.ts`
  (~2780 lines today) — the only source change.
- New: `packages/core/src/algorithm/spineless/flex-grammar.distribution.test.ts`
  — targeted unit tests for the intermediate Field.
- New: `bench/scenarios/hot-relayout-flex-distribution.ts` — a
  micro-bench locking in the perf result with a budget threshold.
- Modified: `bench/thresholds.json` — tighten the loosened
  `hotrelayoutboundary` / `hotrelayout` floors.

### Regime gating

`mainDistribution` is emitted only for parents that **flex-distribute**
in the current build — at least one in-flow child has
`flexGrow > 0` *or* `flexShrink > 0`. Parents in the "no flex
distribution" regime keep today's cheap rule shape; their child main
sizes are already O(1) reads.

The boundary `flexGrow > 0 ? 'g' : '_'` / `flexShrink > 0 ? 's' : '_'`
is the same structural signature the dirty-walk classifier already
uses for `nodeSig` — so a positive ↔ zero weight transition correctly
forces a rebuild via the existing `tryGraftAppend` /
`tryDetachRemove` / structural fallback chain. No new classifier work
is needed.

Wrapped layouts (`flexWrap: 'wrap'` or `'wrap-reverse'`) and
non-default `justifyContent` are explicitly *out of scope* and
continue on today's per-cell path. The intermediate-Field is emitted
only for **single-line** flex-distributing parents with `justify-
content: flex-start`. The structural classifier already separates
these regimes; the gating is a single check.

### Dependency edges and dirty propagation

The `deps` of `mainDistribution` are exactly what one cell's
`mainSizeField` declares today, lifted to the parent. The
`buildAppendFragment` / `buildRemoveFragment` / `buildReorderFragment`
helpers must learn one new patch shape: when an in-flow child is
appended/removed/reordered, the parent's `mainDistribution` rule's
`deps` change (sibling input fields appear or disappear), and its
`compute` closure's captured `flexSibs` list rebuilds. This is the
same mechanic these fragment builders already use for the per-cell
rules — they touch one Field instead of N.

Runtime-side: no changes. The intermediate Field is a normal Field
typed `Field<MainAxisDistribution>`. The priority-queue propagation,
`markDirty`, `evaluate`, `recompute` are generic over field types.

Value-equality semantics: `mainDistribution.compute` returns a fresh
object each call. The runtime's `!==` check always sees it as
"changed" when the rule fires, so all N child `mainSize` /
`mainPos` reads run. Each child compares its extracted scalar to the
old value; downstream propagation stops where the scalar is
unchanged. We do not need a runtime structural-equality feature.

### `myIndex` and in-flow ordering

Each child's `mainSize` / `mainPos` closure captures `myIndex` at
grammar-build time, exactly as today. The in-flow ordering used to
build `flexSibs` is preserved by every fragment builder, so a
`mainDistribution` array index always matches the child closure's
captured `myIndex`. `display: 'none'` siblings are skipped from
`flexSibs` (today and after), so their indices don't appear in
either array.

## Validation

### Correctness gates (must pass unchanged)

1. **Yoga oracle fixtures** — 33 fixtures in
   `packages/core/test/yoga-oracle.test.ts` assert cell-for-cell
   equality with WASM Yoga across flex distributions, padding,
   margins, gap, min/max, justify, align, wrap.
2. **Value-differential fuzzer** —
   `runtime-incremental.fuzz.test.ts`: random mutation sequences,
   incremental result byte-identical to a cold full layout.
3. **Structural-differential fuzzer** —
   `spineless-structural.fuzz.test.ts`: random
   insert/remove/move/value sequences, incremental output
   byte-identical to a cold full layout. Validates that
   `buildAppendFragment` / `buildRemoveFragment` /
   `buildReorderFragment` correctly patch the new `mainDistribution`
   Field through structural mutations.
4. **`pnpm test:differential`** — every `calculateLayout` in the
   core suite runs twice (cached + cold) and asserts byte-identical.
5. **`fast-check` 200-run fuzz** over layout invariants in
   `cache.fuzz.test.ts`.

If any of these go red after the refactor, the change is wrong.

### Performance gates (must show measurable wins)

Run `pnpm -w run bench` on the same machine in the same session:

- `hotrelayoutboundary` median ≤ **83µs** (Yoga win threshold);
  target ≤ 30µs.
- `hotrelayout` median ≤ **92µs**.
- `hotrelayouttext`, `hotstructural`, `tiny`, `realistic`,
  `stress`, `big`, `huge`: all medians ≤ today's median.

`bench/thresholds.json` is then tightened so a future regression
fails CI. Suggested new floors:

- `hotrelayoutboundary: 0.1ms` (back to the pre-phase-8 floor).
- `hotrelayout: 0.15ms`.

### New tests

- `flex-grammar.distribution.test.ts` — unit coverage of the
  intermediate Field:
  - `mainDistribution` is emitted iff the parent flex-distributes.
  - Cell `mainSize` / `mainPos` deps reference only the parent
    `mainDistribution` (not sibling inputs).
  - One flex mutation triggers exactly one `mainDistribution`
    recompute and N trivial cell-field recomputes (assert via
    `runtime.stats.recomputeVisited`).
  - `display: 'none'` siblings are skipped from indices.
  - Reverse-direction parents produce mirror-correct positions.
  - Single-child parents short-circuit (or trivially produce the
    expected array).

- `bench/scenarios/hot-relayout-flex-distribution.ts` — micro-bench
  that mutates one cell's flex on a 1k tree, asserts median ≤
  target. Mirrors how phase 8 added `hot-relayout-text.ts` to lock
  in a new perf result.

## Risks and rollback

**Performance estimate risk.** The `O(N²) → O(N)` refactor *guarantees*
asymptotic improvement; the *constant factor* is what determines
whether we land at 5µs or 40µs. Most likely outcome: 15–40µs —
comfortably beats Yoga, may not beat the imperative engine's 14.9µs
ceiling. That still satisfies success criteria.

**Correctness risk.** A wrong dependency edge or a stale closure
capture produces divergent layouts. The fuzzer suite catches this
loudly. Mitigation: the existing differential infrastructure was
deliberately built for exactly this class of change.

**Scope creep.** `flex-grammar.ts` has more O(N²) candidates: `mainPos`
in non-default-`justifyContent` regimes, cross-axis distribution in
wrapped layouts, single-line cross-axis when align-content distributes.
Phase 12 *defers* these — they aren't on the regressed benches. If
during implementation a shared helper makes one of them nearly free
to extend, fine; if it tempts a wider refactor, stop and ship phase 12
first, file phase 13.

**Rollback / fallback.** If the optimized number doesn't clear the
success criteria, the **router boundary fast-path (option 1) remains
a 3–5 day follow-up.** It would route explicit-sized container
subtrees through `calculateLayoutImperative` (validated today at
14.9µs) and is a self-contained addition to the router. Phase 12 does
*not* commit to abandoning that path; it just defers it as the
non-default path.

## Out of scope (phase 13 candidates)

- `mainPos` rule under non-`flex-start` `justifyContent` (extracts
  the same `positions` array but with different leftover-distribution
  math).
- Cross-axis distribution under `flex-wrap: wrap` (each line
  independently distributes; the intermediate Field becomes a
  per-line distribution).
- Single-line cross-axis distribution under non-default `alignContent`.

Each is a follow-up phase if benches surface a workload it dominates.

## Branch and PR

One branch (`phase12-spineless-flex-distribution`, already created
with this spec committed). One PR. The release (paused on this work)
unpauses when phase 12's PR merges and the bench numbers confirm the
wins. The full release prep (CHANGELOG backfill for phases 8–11,
version bumps, the demo GIF re-record) all resume after that.
