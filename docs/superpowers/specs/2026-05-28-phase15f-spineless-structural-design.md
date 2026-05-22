# Phase 15F — Spineless structural-mutation optimization (hot-structural)

## Context

After Phase 15E, 8 of 9 bench scenarios decisively beat Yoga (≥ 2×). The sole gap is `hot-structural` (append/remove a table row): ~400µs vs Yoga's ~93µs.

`hot-structural` routes through the Spineless engine. A code-exploration of the 280µs Spineless direct path (`packages/core/src/algorithm/spineless/`) found two clean, high-leverage, low-risk fixes:

| Bottleneck | Cost | Root cause | Fix |
|---|---:|---|---|
| `runtime.detach`'s `lastOm` scan | ~172µs | After removing tail fields, `detach` scans **all** `omNodes.values()` (~1,100 entries) to find the new OM tail — `runtime.ts:265-271` | Walk the doubly-linked OM predecessors of the removed nodes; O(removed) not O(total) |
| Fragment-build Map copy-on-write | ~50µs | `mergeStyleInputsMap` does `new Map(base)` cloning ~1,100 entries per append; `buildRemoveFragment` spreads + filters the same Map | Mutate `prev.styleInputs` / `prev.allFields` in place — they are provably single-use (the caller swaps `built.output` immediately after) |

Combined: ~190-220µs saving → `hot-structural` ~400µs → ~200µs.

## Goal

**Cut `hot-structural` from ~400µs to ~200µs** by eliminating the O(N) `lastOm` scan in `detach` and the redundant Map clones in the fragment builders.

This brings `hot-structural` from ~4.3× Yoga loss to ~2.2× Yoga loss. Not yet a win — Phases 15G/H continue — but it's the largest single step on the remaining gap, and both fixes are surgical (<25 lines each).

**Success criteria:**

1. `OrderMaintenance` interface gains `predecessor(node: OMNode): OMNode | null`. Implemented in both `BenderOrderMaintenance` and `NaiveOrderMaintenance` (both already have a `prev` pointer per node).
2. `runtime.detach` replaces the O(N) `omNodes.values()` scan with a predecessor-walk seeded from the removed nodes. For tail removals (the bench case) this is O(1).
3. `mergeStyleInputsMap` gains a `mutateBase: boolean` parameter; the simple-regime `buildAppendFragment` caller passes `true`, skipping `new Map(base)`.
4. `buildRemoveFragment`'s simple path mutates `prev.styleInputs` + `prev.mainDistributionByParent` in place (via `.delete(node)`) instead of spread-filter-reconstruct.
5. `pnpm test:differential` (820 / 6 skipped) green.
6. Structural-differential fuzzer at numRuns=300 green — this is the controlling correctness gate for structural mutations.
7. Yoga oracle (33 fixtures) green.
8. `pnpm bench`: `hot-structural` ≥ 35% faster (~250µs or better); no other scenario regresses.

**Non-goals (deferred to 15G/H):**
- `makeEmitter`'s ~90µs field-emission cost (the other half of `buildAppendFragment`). A different optimization domain (closure/Map-set reduction).
- `graft`'s OM-insertion constant factors (~exploration found these are already O(1) amortized with a small constant; skipping OM for monotone-append saves < 10µs — not worth the complexity).
- Boundary-scoped Spineless grammar (Phase 15H).
- Integer-indexed PQ (Phase 15G).

## Architecture

### Fix 1 — Incremental `lastOm` tracking

The OM (order-maintenance) structure `BenderOrderMaintenance` is a doubly-linked list: each node has `{ _omTag, prev, next }`. `compare(a,b)` is `a._omTag - b._omTag` (O(1)). `lastOm` (a `runtime.ts` field) tracks the topological tail — new grafted fields are appended after it via `om.insertAfter(lastOm)`.

Today, `detach` recomputes `lastOm` from scratch:

```ts
// runtime.ts:265-271 — current
this.lastOm = null;
for (const omNode of this.omNodes.values()) {
  if (this.lastOm === null || this.om.compare(omNode, this.lastOm) > 0) {
    this.lastOm = omNode;
  }
}
```

The fix uses the OM's existing `prev` links. After `detach` removes a set of fields:
- If `lastOm` was NOT among the removed OM nodes, it's unchanged — no work.
- If `lastOm` WAS removed, walk `predecessor(lastOm)` until reaching a node still in `omNodes` (or `null` if the runtime is now empty).

This requires surfacing `prev` through the `OrderMaintenance` interface — a new method `predecessor(node): OMNode | null`.

```ts
// OrderMaintenance interface — add:
predecessor(node: OMNode): OMNode | null;

// BenderOrderMaintenance — implement:
predecessor(node: OMNode): OMNode | null {
  return (node as BenderNode).prev;
}

// NaiveOrderMaintenance — implement:
predecessor(node: OMNode): OMNode | null {
  return (node as NaiveNode).prev;
}
```

```ts
// runtime.detach — replacement for the O(N) scan
// (after the removal loop, `removedOmNodes` is the set of OM nodes just dropped)
if (this.lastOm !== null && removedOmNodes.has(this.lastOm)) {
  let candidate: OMNode | null = this.lastOm;
  while (candidate !== null && !this.omNodes.has(<field for candidate>)) {
    candidate = this.om.predecessor(candidate);
  }
  this.lastOm = candidate;
}
```

The implementer determines the exact bookkeeping — `detach` already iterates the removed fields; it can collect their OM nodes into a `Set` and check membership. The "is candidate still live" test is "does some surviving field still map to it" — the cleanest form is to track removed OM nodes in a Set and walk `prev` until finding one NOT in that set (and still within the original order). The implementer picks the precise formulation; the differential fuzzer validates it.

### Fix 2 — In-place fragment-build mutation

Exploration confirmed `prev` (the previous `FlexGrammarOutput`) is single-use: the caller (`layout.ts`) swaps `built.output = fragment.next` immediately after the fragment builder returns, orphaning `prev.styleInputs` / `prev.allFields`. Mutating them in place is safe.

`mergeStyleInputsMap` (`flex-grammar.ts:1365`):

```ts
// current
function mergeStyleInputsMap(base, extra) {
  const merged = new Map(base);   // clones ~1,100 entries
  for (const [node, entry] of extra) { ... merged.set(...) }
  return merged;
}

// fix — add mutateBase param
function mergeStyleInputsMap(base, extra, mutateBase: boolean) {
  const merged = mutateBase ? base : new Map(base);
  for (const [node, entry] of extra) { ... merged.set(...) }
  return merged;
}
```

The simple-regime `buildAppendFragment` caller passes `mutateBase: true`. Non-simple callers (full rebuild) pass `false` — they may share `prev`.

`buildRemoveFragment` simple path (`flex-grammar.ts:1706-1710`): replace
```ts
styleInputs: new Map([...prev.styleInputs].filter(([n]) => !removedNodes.has(n))),
```
with an in-place delete:
```ts
for (const n of removedNodes) prev.styleInputs.delete(n);
// ...use prev.styleInputs directly as next.styleInputs
```
Same for `prev.mainDistributionByParent`. `prev.allFields.filter(...)` can become `prev.allFields = prev.allFields.filter(...)` (still O(N) but saves the extra array) — OR the implementer leaves it if the filter cost is small; the styleInputs spread is the measured ~48µs item.

### Files touched

```
packages/core/src/algorithm/spineless/order-maintenance.ts   MODIFY — add predecessor() to interface + 2 impls
packages/core/src/algorithm/spineless/runtime.ts             MODIFY — detach: incremental lastOm
packages/core/src/algorithm/spineless/flex-grammar.ts        MODIFY — mergeStyleInputsMap mutateBase; buildRemoveFragment in-place
bench/RESULTS.md                                             REGEN  — confirms hot-structural improvement
```

## Risk model

| Risk | Likelihood | Mitigation |
|---|:-:|---|
| Incremental `lastOm` finds the wrong tail (interior removal, multi-row) | Medium | The structural-differential fuzzer mutates randomly (insert/remove/move) and asserts cold-rebuild equivalence at numRuns=300. A wrong `lastOm` → next graft inserts at wrong position → divergence caught. |
| In-place mutation of `prev.styleInputs` corrupts a retained reference | Low | Exploration traced ownership: `prev` = `built.output`, swapped immediately after the builder returns. The `mutateBase` param confines mutation to the simple-regime path that owns `prev` exclusively. Non-simple paths pass `false`. |
| `predecessor()` interface addition breaks a mock/test OM implementation | Low | Grep for `OrderMaintenance` implementers; only Bender + Naive exist. Both have `prev`. |
| `buildRemoveFragment` in-place delete breaks when `removedNodes` overlaps shared state | Low | Same single-use ownership; differential + structural fuzzer validate. |

## Validation plan

1. `pnpm typecheck` + `pnpm lint`: clean.
2. `pnpm test`: 1456 pass.
3. `pnpm test:differential` ×3: 820 / 6 skipped.
4. **Structural-differential fuzzer at numRuns=300** — the controlling gate. It exercises exactly the append/remove/move paths Phase 15F changes. Must be green. If a seed fails, pin it deterministically (per project convention), fix, then unpin.
5. Yoga oracle: 33 pass.
6. `pnpm bench`: `hot-structural` ≥ 35% faster.

## Projected impact

| Scenario | Pre-15F | Projected post-15F | Yoga | vs Yoga |
|---|---:|---:|---:|---|
| hot-structural | ~400µs | ~200-250µs | 92.6µs | ~2.2-2.7× loss |
| (all others) | unchanged | unchanged | — | unchanged (≥ 2× win) |

Phase 15F does not yet make `hot-structural` a win — it cuts the loss roughly in half. Phases 15G (integer-indexed PQ — reduces `graft`/`recompute` constant factors) and 15H (boundary-scoped grammar) continue closing the gap. The realistic end-state for `hot-structural` after 15F-H is parity-to-modest-win; if pure-TS plateaus above Yoga, the honest framing (8-9 decisive wins, structural at parity) is still a category-leading result.

## Why these two fixes first

Of the four `hot-structural` bottlenecks, these two are the highest leverage-to-risk ratio:
- The `lastOm` scan is the single largest traced cost (172µs) and the fix is mechanical — surface an existing `prev` pointer through the interface.
- The Map clone is pure redundant allocation; the fix is invisible to callers (mutation of a dead object).

`makeEmitter`'s 90µs and `graft`'s constant factors are real but need deeper refactoring with more risk — deferred to 15G after the cheap wins are banked.
