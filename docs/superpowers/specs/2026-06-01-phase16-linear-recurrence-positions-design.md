# Phase 16 — Linear-recurrence main-axis positions

## Mission

Replace the Spineless grammar's **cumulative-sum** encoding of main-axis child positions with a **linear recurrence**. This converts the structural-mutation cost from O(N) to O(1) per appended/removed field, taking `hot-structural` from ~250µs (2.4× Yoga loss) to a profiler-measured floor of **~28-30µs — a decisive 3-4× Yoga win**, completing a clean 9/9 in pure TypeScript.

## The discovery

A three-agent deep research investigation (fresh post-15I profile + Yoga-algorithm study + Spineless strategy analysis) overturned the earlier "hot-structural is the irreducible Spineless tax" conclusion. Phases 15F/G/H/I all attacked *constant factors* (Map ops, allocations, typed arrays). They never touched the real problem: an **O(N) algorithmic flaw in the grammar**.

Today, a flex child's main-axis position is encoded as a cumulative sum over **all** prior siblings (`flex-grammar.ts:1107-1131`):

```ts
// child N's mainPos rule — deps: [gap, padStart, myMarginStart, ...100 prior sizes, ...200 prior margins]
compute: (read) => {
  let sum = read(padMainStartF) + read(myMarginMainStartF) + indexInParent * read(mainGapInput);
  for (const m of priorMargins) sum += read(m.start) + read(m.end);   // O(N)
  for (const m of priorMainSizes) sum += read(m);                     // O(N)
  return sum;
}
```

The 101st row's `top` field carries **303 dependencies**. Appending row 101 means integrating a field with 303 dependency edges — 303 edge recordings on graft, 303 `indexOf+splice` on detach, a 303-reference closure. The fresh profile attributed ~150µs of the ~250µs append+remove cycle to this single rule.

**Yoga has no equivalent cost** — research confirmed Yoga does *zero* graph construction on structural mutation (pure imperative dirty-bit + measurement cache). The gap is algorithmic, not C++-vs-JS. (This is also why a Rust port was rejected: porting the *same* O(N) algorithm to Rust yields parity at best; the O(1) algorithmic fix wins decisively, and it works in TypeScript.)

## The fix

Encode main-axis position as a **linear recurrence** — each child's position reads only its *immediate predecessor*:

```
mainPos[0] = padMainStart + myMarginStart[0]                                    (base case — already O(1) at flex-grammar.ts:1073-1076)
mainPos[N] = mainPos[N-1] + mainSize[N-1] + marginEnd[N-1] + myMarginStart[N] + gap   (N > 0)
```

Correctness (unroll the recurrence and it equals the cumulative sum): `mainPos[N-1]` already includes padding + every prior size/margin/gap up to sibling N-1's leading edge and bakes in `marginStart[N-1]`; the step adds `mainSize[N-1]` (advance past sibling N-1's box) + `marginEnd[N-1]` (sibling N-1's trailing margin) + `myMarginStart[N]` (this child's leading margin) + one `gap`. The gap count accumulates correctly: `mainPos[N-1]` carries `(N-1)·gap`, +1 → `N·gap`.

Child N's rule now has **5 dependencies** (`prevMainPos, prevMainSize, prevMarginEnd, myMarginStart, gap`) regardless of N — O(1).

## Why this is strictly better, not a trade-off

| | cumulative-sum (now) | linear-recurrence (Phase 16) |
|---|---|---|
| Deps per position field | O(N) | **O(1)** (5) |
| Append at end — graft | O(N) edges | **O(1)** |
| Append in middle — rebinds | O(N) successors re-summed | **1** (immediate successor) |
| Remove in middle — rebinds | O(N) | **1** |
| Value mutation on a mid-list main-size | O(N) fields dirtied, each O(its-index) recompute = **O(N²)** | O(N) fields dirtied, each **O(1)** = O(N) |

The recurrence is better on *every* axis — structural mutation AND value mutation. The only structural property it adds is a dependency *chain* (`mainPos[K] → mainPos[K+1] → …`); the Spineless priority queue already processes fields in document order (OM rank), so the chain is walked in the correct order with no special handling.

## Scope

**In:** `flex-grammar.ts:1107-1131` — the `justify === 'flex-start'`, non-first-child, non-`mainDistribution` branch. Replace the cumulative-sum rule with the recurrence. Plus the `buildAppendFragment` / `buildRemoveFragment` successor-rebind logic for mid-list structural mutations.

**Out:**
- `emitJustifiedMainPos` (`justify` = center/end/space-*) — justified layouts compute position from *total* leftover space, inherently all-sibling-dependent. A separate intermediate-field collapse (like Phase 12's `mainDistribution`) could fix it later; not Phase 16, not on the `hot-structural` path.
- The `mainDistribution` path (parent flex-distributes) — already O(1) (reads one intermediate field). Untouched.
- The first-child base case (`flex-grammar.ts:1073-1076`) — already `padMainStart + myMarginStart`, the recurrence's O(1) base case. Untouched.
- Cross-axis position — already O(1) (`padCrossStart + crossMargin`). Untouched.

## Architecture

### The grammar change (`flex-grammar.ts:1107-1131`)

The branch is reached for a non-first in-flow child of a `flex-start` parent that does **not** flex-distribute. `priorSiblings` is the in-flow predecessors array; the immediate predecessor is `priorSiblings[priorSiblings.length - 1]`.

Replace the cumulative-sum block with:

```ts
} else {
  // Linear recurrence: this child's main position = the immediate
  // predecessor's position + its box + the gap. O(1) deps regardless
  // of sibling count — see Phase 16 design doc.
  const prevSibling = priorSiblings[priorSiblings.length - 1]!;
  const prevMainPos = field<number>(prevSibling, mainPosName);
  const prevMainSize = field<number>(prevSibling, mainSizeName);
  const prevMarginEnd = marginInput(prevSibling, mainEndEdge(parentDirection!));
  const mainGapInput = gapInput(parent, parentDirection === 'column' ? 'row' : 'column');
  grammar.set(mainPosField, {
    deps: [
      prevMainPos as Field<unknown>,
      prevMainSize as Field<unknown>,
      prevMarginEnd as Field<unknown>,
      myMarginMainStartF as Field<unknown>,
      mainGapInput as Field<unknown>,
    ],
    compute: (read) =>
      read(prevMainPos) +
      read(prevMainSize) +
      read(prevMarginEnd) +
      read(myMarginMainStartF!) +
      read(mainGapInput),
  } satisfies FieldRule<number>);
}
```

`mainPosName` — the field name for the main-position field (parallel to the existing `mainSizeName`). The implementer locates it; if only `mainSizeName` exists, derive `mainPosName` the same way (`parentDirection === 'column' ? 'top' : 'left'`).

`mainEndEdge` / `marginInput` / `gapInput` / `field` are all already imported + used in the current block.

### The fragment-builder change (`buildAppendFragment` / `buildRemoveFragment`)

The recurrence makes structural mutations cheaper but introduces one obligation: a **mid-list** insert/remove must rebind the *immediate successor's* `mainPos` rule.

- **Append at end** (the `hot-structural` bench): the new last child's `mainPos` reads the old last child. Nothing referenced the new child. **Zero rebinds.**
- **Append at middle index K**: new child K reads K-1. The old child at K (now K+1) previously read K-1; rebind it to read the new child K. **One rebind.**
- **Remove at end**: nothing referenced the removed child. **Zero rebinds.**
- **Remove at middle index K**: child K+1 read K; rebind it to read K-1. **One rebind.**

The fragment builders already carry a `rebinds: [Field, FieldRule][]` mechanism (used today for the flex-distribution case). Phase 16's contribution: when the structural mutation is in the flex-start non-distribution regime and **not** at the list end, compute the single successor-rebind — re-emit the successor's `mainPos` rule with the new predecessor. This is *strictly simpler* than the cumulative-sum world, where a mid-list mutation forced O(N) successor re-sums (or a full rebuild).

The implementer reads the current `buildAppendFragment` / `buildRemoveFragment` to see how they currently handle mid-list main-pos (likely a full-rebuild fallback) and wires the O(1) successor-rebind. **If the current builders already fall back to full rebuild for mid-list inserts, Phase 16 may leave that fallback intact initially** — the bench (end-append) gets the O(1) win regardless, and the structural fuzzer validates correctness either way. Closing the mid-list path to O(1) is a refinement, not a correctness requirement.

### Files touched

```
packages/core/src/algorithm/spineless/flex-grammar.ts   MODIFY — cumulative-sum mainPos rule → linear recurrence; fragment-builder successor-rebind
bench/RESULTS.md                                        REGEN  — confirms the hot-structural drop
bench/thresholds.json                                   UPDATE — hotstructural threshold tightened to the new range
```

## Risk model

This is a **grammar-level change** — the highest-risk change of the whole Phase 15/16 arc. The grammar is the engine's core; the main-pos rule fires for every flex-start container, i.e. nearly every scenario.

| Risk | Likelihood | Mitigation |
|---|:-:|---|
| The recurrence formula is subtly wrong (off-by-one gap, margin double-count) | Medium | The math is unrolled + verified in this doc. `pnpm test:differential` (every layout twice, byte-identical) + the 33-fixture Yoga oracle catch any positional error instantly. |
| A mid-list insert/remove leaves a dangling successor dep (successor still reads the removed predecessor) | Medium | Structural-differential fuzzer at numRuns=300 — it does random mid-list inserts/removes and asserts cold-rebuild equivalence. A missed rebind diverges. |
| The dependency chain reorders recompute in a way that breaks a hot-relayout scenario | Low | The PQ already processes in OM/document order; the chain is naturally ordered. Bench + differential validate. The recurrence is O(N) vs the old O(N²) for mid-list size mutations — strictly faster. |
| Cold-build scenarios (tiny…huge) regress | Low | Recurrence rules are *smaller* (5 deps vs O(N)) — cold build emits cheaper rules. Expect neutral-to-faster. Bench confirms. |
| `mainPosName` derivation wrong | Low | typecheck + the Yoga oracle (absolute positions) catch it. |

**The structural-differential fuzzer is the controlling correctness gate.** If it cannot be made green, Phase 16 does not ship — full stop.

## Validation plan

1. `pnpm typecheck` + `pnpm lint` — clean.
2. `pnpm test` — 1466 pass.
3. `pnpm test:differential` ×3 — 830 / 6 skipped. Every `calculateLayout` runs cached + cold, byte-identical. The primary positional-correctness gate.
4. **Structural-differential fuzzer numRuns=300** — green. Random insert/remove/move; the gate for the fragment-builder rebind logic. Also run once at numRuns=3000 before considering Phase 16 done.
5. Yoga oracle (33 fixtures) — green. Independent positional ground-truth.
6. `pnpm bench` — `hot-structural` drops toward ~30µs; **no other scenario regresses** (all 8 must hold their 2-9× wins).
7. `pnpm bench:variance` if the harness cooperates — a stable median for the new `hotstructural` threshold.

## Projected impact

| Scenario | Pre-16 | Projected post-16 | Yoga | Result |
|---|---:|---:|---:|---|
| hot-structural | ~250µs | **~28-35µs** | ~100-120µs | **3-4× WIN** |
| hot-relayout ×3 | 20-22µs | ~20µs or better | 74-104µs | 5-9× win (held/better) |
| tiny…huge | unchanged | unchanged or slightly better | — | 2-4× win (held) |

If the profiler's ~28µs floor is even approximately reached, `hot-structural` flips from the lone 2.4× *loss* to potentially the **largest win in the suite** — and Phase 15+16 delivers the outright goal: **a pure-TypeScript layout engine beating Yoga's C++ on every one of the 9 benchmarked workloads, several by 3-9×.**

## Why this is the right final phase

Phases 15F/G/H/I were not wasted — they were necessary constant-factor work, and 15I's typed-array runtime is what makes the recurrence's O(1) graft genuinely cheap (array-indexed field storage). But they optimized the wrong axis. Phase 16 fixes the *complexity*. It is a small change (one grammar rule + the fragment-builder rebind), it is the genuine root-cause fix, and it generalizes — append-only growing lists (chat logs, tables) get the same O(1) structural cost, not just the bench's alternating pattern. After Phase 16, the "shock the world" result is real: **TypeScript beats C++ on every workload, by doing less algorithmic work.**
