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

Full `packages/core` suite: 475 tests pass (up from 460).
`spineless/` overall coverage: 95.47% lines, 93.66% branches.
`runtime.ts`: 100% across all metrics.

## What's next

1. **Style-mutation wiring.** Hook `node.setWidth(...)` etc. into the runtime's `markDirty`. The trick: figure out which fields a given style mutation actually invalidates. For the v1-v8 flex grammar, this is mostly mechanical — `style.width` invalidates the node's `width` field (and any field that captured it inline, but we may decide to read style lazily inside `compute` to keep this clean).
2. **Differential mode harness.** Adapt the 100 flex-grammar differential tests to also run the layout through `SpinelessRuntime` and assert the same byte-identical output.
3. **Behind a feature flag.** A `PILATES_SPINELESS_LAYOUT=1` env flag lets the runtime opt into shipping to early users while the imperative path stays the default.
4. **Bench.** A new `hot-relayout-text` scenario that mutates leaf text each frame, compared against the imperative algorithm. Expected wins: the smaller the dirty fragment per frame, the bigger the gap.
