# Phase 5b — Spineless Runtime v1

**Date:** 2026-05-14
**Status:** First runtime cut landed. OM-keyed incremental driver for the attribute grammar.
**Predecessor:** `2026-05-12-spineless-foundation.md` (phase 5a — OM, priority queue, grammar, flex grammar v1-v8).

## Context

Phase 5a built the four foundational pieces in dependency order:

1. Order Maintenance (Naive + Bender) — O(1)-amortized totally-ordered timestamps.
2. OM-keyed binary min-heap priority queue.
3. Attribute-grammar type system + topological interpreter (`TopoInterpreter`).
4. Flex grammar — eight slices (v1 row → v8 absolute) bringing CSS Flexbox to byte-identical parity with the imperative algorithm.

What was missing: the **incremental driver** that actually uses the OM and the PQ. The `TopoInterpreter` is a from-scratch evaluator — it walks the full DAG every call. That's the correctness oracle. Spineless Traversal's whole point is to avoid that re-evaluation when little has changed.

This sub-phase lands the runtime that does the saving.

## What landed

### `packages/core/src/algorithm/spineless/runtime.ts`

**`SpinelessRuntime` class** — wraps a `Grammar` + an optional `OrderMaintenance` (defaults to `BenderOrderMaintenance`) + an internally-allocated `OmPriorityQueue<Field>`. Stores three per-field maps:

- `values`: cached compute output
- `omNodes`: each field's allocated OM timestamp
- `dependents`: reverse-deps, populated at init from `rule.deps`

### Phase 1: `init()`

DFS from the supplied root fields. For each field in topological order:

1. Allocate an OM node via `om.insertAfter(prevOmNode)`, chaining off the previously visited field. The first field uses `om.init()`. Since DFS post-order is topological order, OM timestamps end up monotonically increasing along dependency edges — which is what the priority queue relies on for OM-min = topo-next semantics.
2. Record the reverse-deps edge: for every `dep` of this field's rule, append `field` to `dependents[dep]`.
3. Run the rule's `compute` (every dep is already in `values` by induction) and cache the result.

Cycles throw with the offending field's name; missing rules throw with a clear "register it or remove the dep edge" hint.

### Phase 2: `markDirty(field)` + `recompute()`

Callers signal that a field's inputs have changed by calling `markDirty`. The runtime pushes `(field, omNode)` into the priority queue. Duplicate calls dedupe via the queue's internal `members` set.

`recompute()` loops:

1. Pop the OM-minimum field.
2. Re-run its rule against the current `values` cache.
3. **If the new value differs from the cached one**, persist it and push every dependent into the queue.
4. **If the value is unchanged**, do nothing (the "skip work" property — the whole reason for the runtime).

Termination is guaranteed because dependents always have strictly greater OM timestamps than their inputs (allocation order during init is topological), so the queue can't pump indefinitely.

### `packages/core/src/algorithm/spineless/runtime.test.ts`

**15 tests, all passing, 100% coverage on `runtime.ts`** (lines / branches / functions / statements).

Coverage breakdown:

- 4 init tests: full topo evaluation, unreachable-field error, cycle detection, missing-rule error.
- 5 markDirty + recompute tests: leaf change propagates through chain, no-op recompute skips dependents, multiple-dirty processes in OM order, dedupe, empty-queue no-op.
- 2 flex-grammar end-to-end tests: runtime's initial layout matches `TopoInterpreter` on a fixed-width row tree and on a flex-grow tree.
- 4 defensive-error tests: markDirty / recompute before init, markDirty on out-of-runtime field, compute reading an undeclared dep.

## Where the runtime currently can't go

These are deliberate hold-outs for the next slice, not bugs:

- **Style mutation does not auto-dirty fields.** The runtime exposes `markDirty(field)` as a manual API. Wiring it up to `node.setWidth(...)` (and figuring out exactly which fields a style mutation invalidates) lands in the next slice.
- **Grammar mutation is unsupported.** Adding / removing nodes between layouts, or changing what fields a rule depends on, means a fresh `SpinelessRuntime` instance. The grammar is fixed at init time.
- **Differential mode harness — landed.** A second commit on this PR series (`runtime-differential.test.ts`) drives the `SpinelessRuntime` across a one-per-slice corpus (v1 fixed row → v8 absolute, plus a nested column-of-rows). Each tree's runtime output (after the same integer-cell rounding pass) is asserted equal to the imperative `root.calculateLayout()` output. A separate test exercises `init + markDirty(*) + recompute()` and asserts the result matches a fresh init — the core "incremental == from-scratch" invariant.

## Test coverage

`spineless/` overall coverage: 96.03% lines, 96.45% branches.
`runtime.ts`: 100% across all metrics. `runtime-mutation.test.ts`
grew to 29 end-to-end style-mutation tests.

## What's next

1. **Style-mutation live-read — landed.** Every compute callback in `flex-grammar.ts` now live-reads `node.style` at evaluate time. The first slice did the **size** props (`width` / `height` / `flexBasis`); the follow-up extended it to **padding / margin / gap** and the **flex-distribution / wrap** sibling data — captured numeric values became thunks, and the per-sibling arrays feeding `distributeMainAxis` / the wrap line packer are rebuilt live inside compute. The end-to-end loop now works for any numeric style value within a fixed structural regime: build runtime → mutate (`setPadding` / `setMargin` / `setGap` / `setFlexGrow` / `setFlexShrink` / `setWidth` / …) → `markDirty(field)` (or `markAllDirty()`) → `recompute()` → layout matches a fresh build. **Structural** mutations — flex-direction, flex-wrap on/off, the justify / align category, `positionType`, or toggling a flex weight across the zero boundary (which flips whether the parent flex-distributes) — still reshape the dependency graph and need a fresh `buildFlexGrammar()`.
2. **Behind a feature flag.** A `PILATES_SPINELESS_LAYOUT=1` env flag lets the runtime opt into shipping to early users while the imperative path stays the default.
3. **Bench — landed.** The `hotrelayouttext` scenario (`bench/scenarios/hot-relayout-text.ts`) builds a 1k-node fixed-size table once, then mutates a single leaf cell's width per pass. It adds a fourth engine column, `@pilates/core (spineless)`, alongside the imperative and Yoga paths. First numbers (Node v22.21, win32/x64): Spineless **6.0µs** vs imperative `calculateLayout()` **9.2µs** vs Yoga WASM **76.1µs** — the incremental runtime is ~1.5× faster than the already-fast imperative path and ~13× faster than Yoga. The win scales with how small the dirty fragment is: here only the mutated cell and its in-row downstream `left` positions recompute.
4. **Fine-grained dirtying via style input Fields — size + gap + padding + margin landed.** The live-read thunks were a stepping stone: their reads aren't declared deps, so the runtime's auto-propagation was incomplete and callers fell back to `markAllDirty()`. The fix is to model each style prop the grammar reads as a **leaf input `Field`**, so declared deps become complete and `markDirty(inputField)` propagates exactly. So far the **size** props (`width` / `height` / `flexBasis`), **`gap`** (`gapRow` / `gapColumn`), **`padding`** (per-edge), and **`margin`** (per-edge) are converted: they're emitted as `style:*` input fields, every layout field that reads one declares the matching input as a dep, and `buildFlexGrammar` returns a `styleInputs: Map<Node, StyleInputs>`. A size / gap / padding / margin mutation is now driven precisely — `markDirty` the input field(s), `recompute()`, no `markAllDirty`. Only **`flex-grow` / `flex-shrink`** remain live-read thunks; converting them to input fields (and then adding a `markStyleDirty(node, prop)` convenience that resolves a mutation to its input field) is the remaining work.
