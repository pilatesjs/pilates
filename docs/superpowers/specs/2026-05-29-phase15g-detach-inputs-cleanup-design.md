# Phase 15G — O(removed) `built.inputs` cleanup in `tryDetachRemove`

## Context

A precise re-profile of `hot-structural` *after* Phase 15F found the dominant remaining cost is **not** in the earlier-profiled `detach`/`graft`/fragment-build phases — it is one line in `tryDetachRemove`:

```ts
// layout.ts:697
built.inputs = built.inputs.filter((f) => built.runtime.isTracked(f));
```

`built.inputs` is the list of every leaf input field in the grammar. For the 100×10 `hot-structural` table it holds **11,210 fields** (the phase-12 flex-distribution grammar emits ~15 fields/node). On every *remove* iteration, this line scans all 11,210 to discard the ~30 orphaned by the removal — **~185µs**, the single largest cost in the whole `hot-structural` path.

Per-iteration profile (post-15F):

| Iter | Total | of which `built.inputs.filter` |
|---|---:|---:|
| append | ~278µs | 0 (filter only runs on remove) |
| remove | ~305-350µs | **~185µs** |
| average (bench median) | ~275-314µs | ~92µs amortized |

Fixing this one line drops the remove iter from ~350µs to ~165µs and the bench average from ~275µs to **~220µs**.

## Goal

**Eliminate the O(|built.inputs|) scan.** `runtime.detach` already knows exactly which fields it dropped (its `drop` closure is invoked for both the removed set and orphan-cleaned survivors). Have `detach` return that set; have `tryDetachRemove` remove those fields from `built.inputs` in O(|dropped|) instead of rebuilding via an O(11,210) `isTracked` scan.

To make removal O(1) per field, `built.inputs` becomes a `Set<Field>` (it is currently an array that is only ever `.push`-ed, `.filter`-ed, or wholesale-reassigned — **never iterated or indexed**, confirmed by a workspace grep — so the conversion has no reader to break).

**Success criteria:**

1. `runtime.detach` returns `Set<Field<unknown>>` — every field its `drop` closure removed (the explicit `removing` set + orphan-cleaned survivors).
2. `built.inputs` type changes from `Array<Field<unknown>>` to `Set<Field<unknown>>`. All write sites (`.push` → `.add`; the two `.filter` rebuilds; `collectInputs`) updated.
3. `tryDetachRemove` (`layout.ts:697`) removes dropped fields from `built.inputs` via `for (const f of dropped) built.inputs.delete(f)` — O(|dropped|), no `isTracked` scan.
4. `pnpm test:differential` (824 / 6 skipped) green.
5. Structural-differential fuzzer numRuns=300 green — the controlling correctness gate.
6. Yoga oracle (33) green.
7. `pnpm bench`: `hot-structural` ≥ 15% faster (~230µs or better); no other scenario regresses.

**Non-goals (Phase 15H):**
- `runtime.graft`'s ~111µs (169-field OM integration). Needs grammar field-count reduction (constant-folding) — deeper, medium-confidence.
- `buildAppendFragment`'s ~95µs. Simple-regime early-exit — medium-confidence.
- These are the next phase; 15G banks the guaranteed mechanical win first.

## Architecture

### `built.inputs`: array → Set

Workspace grep confirms `built.inputs` is written at:
- `layout.ts:434` `inputs: collectInputs(...)` (initial build)
- `layout.ts:563` `built.inputs.push(f)` (graft path — new leaf inputs)
- `layout.ts:570` `built.inputs = collectInputs(...)` (graft rebuild branch)
- `layout.ts:697` `built.inputs = built.inputs.filter(isTracked)` (detach — **the target**)
- `layout.ts:765` `built.inputs = built.inputs.filter(...)` + `:769` `.push` (reorder path)

…and **read nowhere** — no `for...of built.inputs`, no `built.inputs[i]`, no pass-by-value to another function. (The line-800 comment "iterates O(dirty inputs), not O(built.inputs)" refers to a path that deliberately does *not* touch `built.inputs`.)

So `built.inputs` is effectively a write-only bookkeeping set today. Converting it to `Set<Field>` is safe and makes O(1) deletion possible:
- `Array<Field>` → `Set<Field>` in the `Built` interface (`layout.ts:220`).
- `collectInputs` returns `Set<Field>` (build it as a Set directly).
- `.push(f)` → `.add(f)`.
- `:765`'s `.filter((f) => !removedFields.has(f))` → `for (const f of removedFields) built.inputs.delete(f)`.

### `runtime.detach` returns its dropped set

`detach`'s `drop` closure (`runtime.ts` ~line 228) is the single choke point — invoked for the `removing` set AND for orphan-cleaned survivors. Collect into a `Set` and return it:

```ts
detach(removing: ReadonlySet<Field<unknown>>): Set<Field<unknown>> {
  // ... precondition checks ...
  const dropped = new Set<Field<unknown>>();
  const drop = (f: Field<unknown>): void => {
    const omNode = this.omNodes.get(f);
    if (omNode !== undefined) { this.om.delete(omNode); removedOmNodes.add(omNode); }
    this.omNodes.delete(f);
    this.values.delete(f);
    this.dependents.delete(f);
    this.grammar.delete(f);
    dropped.add(f);
  };
  // ... removal loop + orphan cleanup (both call drop) ...
  // ... incremental lastOm (phase 15F) ...
  return dropped;
}
```

(`removedOmNodes` already exists from Phase 15F's incremental-lastOm work.)

### `tryDetachRemove` consumes the return

`layout.ts` calls `built.runtime.detach(...)`. Capture the return and use it:

```ts
const dropped = built.runtime.detach(fragment.removed /* or the removing set */);
// ... existing built.fields / built.owner cleanup ...
// Replaces the O(11,210) isTracked scan:
for (const f of dropped) built.inputs.delete(f);
```

`Set.delete` is a no-op when `f` isn't present, so blindly deleting every dropped field (layout fields, intermediates, inputs alike) from `built.inputs` correctly removes exactly the dropped *leaf inputs* — O(|dropped|) ≈ O(124), not O(11,210).

The orphan-cleanup correctness the old comment worried about ("a Set-based filter over `fragment.removed` alone would miss survivor orphans") is now handled: `detach`'s returned set *includes* orphan-cleaned survivors, because `drop` is the closure that cleans them.

### Files touched

```
packages/core/src/algorithm/spineless/runtime.ts        MODIFY — detach returns Set<Field>
packages/core/src/algorithm/spineless/layout.ts         MODIFY — built.inputs → Set; tryDetachRemove uses detach's return; collectInputs returns Set; .push→.add; reorder filter→delete
bench/RESULTS.md                                        REGEN
```

Check whether any test calls `runtime.detach` directly and asserts its (previously `void`) return — update those.

## Risk model

| Risk | Likelihood | Mitigation |
|---|:-:|---|
| A `built.inputs` reader exists that the grep missed | Low | Grep was thorough (`.inputs` across the spineless dir); only writes found. The implementer re-greps `\.inputs\b` workspace-wide before converting. If a reader exists and needs array semantics, keep array + use an O(|dropped|) approach (build a Set from `dropped`, single filter pass — still better than `isTracked` per-element but not O(1)). |
| `detach`'s returned set misses an orphan-cleaned field | Low-Medium | `drop` is the *single* closure for all removals incl. orphans; collecting in `drop` is complete by construction. Structural fuzzer validates. |
| Set iteration order differs from array order and something depends on it | Very Low | `built.inputs` has no reader; order is irrelevant. |
| `runtime.detach` callers other than `tryDetachRemove` break on the new return type | Low | Returning a value is backward-compatible for `void`-expecting callers (they ignore it). Only an explicit `: void` annotation on a caller's variable would break — grep + fix. |

## Validation plan

1. `pnpm typecheck` + `pnpm lint`: clean.
2. `pnpm test`: 1460 pass.
3. `pnpm test:differential` ×3: 824 / 6 skipped.
4. **Structural-differential fuzzer numRuns=300** — controlling gate. Random insert/remove/move; a missed orphan in `built.inputs` would (eventually) surface as a stale-tracking divergence.
5. Yoga oracle: 33 pass.
6. `pnpm bench`: `hot-structural` ≥ 15% faster.

## Projected impact

| Scenario | Pre-15G | Projected post-15G | Yoga | vs Yoga |
|---|---:|---:|---:|---|
| hot-structural | ~275µs | ~220µs | 92µs | ~2.4× loss |
| (all others) | unchanged | unchanged | — | ≥ 2× win |

After 15G: `hot-structural` ~2.4× behind Yoga (was ~3×). Phase 15H (`graft` field-count reduction + `buildAppendFragment` early-exit) targets the remaining ~110µs — projected end-state ~105µs, within ~1.15× of Yoga or better.

## Why 15G is the right next step

Of the three remaining `hot-structural` costs, this is the only **very-high-confidence, purely mechanical** one: `detach` already computes the dropped set internally; we just return it instead of throwing it away, and swap an array for a Set. No algorithm change, no grammar change, no traversal change. The structural fuzzer makes the correctness trivially checkable. `graft`/`buildAppendFragment` (15H) need grammar-level changes with real correctness surface — bank the guaranteed win first.
