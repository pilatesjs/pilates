# Phase 17 — Fold default-valued style inputs out of the grammar

## Mission

For simple-regime fixed-size cells, stop emitting grammar input fields for style properties that are at their **default value** (margins all 0, min 0, max ∞, flexBasis 'auto'). Inline the constant into the consuming rules instead. This cuts ~15 fields/node → ~6-7 fields/node — roughly **halving** the per-structural-mutation grammar emission + order-maintenance integration cost.

Projected: `hot-structural` ~120µs → **~70-90µs** — parity-to-slight-win vs Yoga's ~93µs. This is the *general* fix (helps append-only growing-list workloads, not just the alternating bench) that, on top of Phase 16's linear recurrence, closes the last ~1.3× gap to a clean **9/9 vs Yoga in pure TypeScript**.

## Context

Phase 16 (linear-recurrence positions) took `hot-structural` from ~250µs to ~120µs by killing the O(N) *dependency-edge* cost. The remaining ~120µs is the O(169-field) grammar *emission + OM integration* per structural mutation — building a dependency-graph fragment Yoga never builds.

A code exploration confirmed: of the ~15 fields a simple-regime cell emits, ~8 are input fields for properties at their **default value** (`margin` 0, `minWidth/Height` 0, `maxWidth/Height` ∞). They exist only so a future `setMargin`/`setMinWidth` has a field to dirty. When the property is at its default, the field's value is a constant, and the rule that reads it degenerates: `clampMinMax(x, 0, ∞)` ≡ `x`, `padCrossStart + 0` ≡ `padCrossStart`.

Eliminate those fields. Inline the constant. Rebuild the grammar if the property ever leaves its default.

## The foldable inputs

For a simple-regime cell (numeric `width`/`height`, in-flow, `nowrap`/`flex-start`/non-distributing parent), fold when the property is at default:

| Input | Default | Foldable when | Consuming rules |
|---|---|---|---|
| `style:minWidth` | `0` | `style.minWidth === 0` | `mainSizeField` / `crossSizeField` clamp |
| `style:minHeight` | `0` | `style.minHeight === 0` | same |
| `style:maxWidth` | `undefined` → ∞ | `style.maxWidth === undefined` | same |
| `style:maxHeight` | `undefined` → ∞ | `style.maxHeight === undefined` | same |
| `style:margin:0..3` | `0` each | `style.margin[edge] === 0` | `crossPosField`, `mainPosField` recurrence, stretch `crossSizeField` |
| `style:flexBasis` | `'auto'` | `style.flexBasis === 'auto'` | `mainSizeField` |

**Not folded:** `style:width` / `style:height` (carry the live user value), `style:flexGrow` / `style:flexShrink` (in the simple regime they are not emitted at default-zero anyway — only present when non-zero, and `nodeSig` already captures the boundary).

## Architecture

### 1. The fold mechanism — inline, don't emit

Today the emitter helpers (`minMaxInput`, `marginInput` in `flex-grammar.ts`) idempotently register a `Field` + `FieldRule`. Phase 17 introduces a `FoldedInput` abstraction at the *call sites* in `visit`:

```ts
type FoldedInput =
  | { kind: 'field'; field: Field<number> }
  | { kind: 'const'; value: number };
```

A helper resolves each foldable property:
```ts
function foldMinMax(node, prop, defaultVal): FoldedInput {
  const v = node.style[prop];  // raw style value
  if (<v is the default>) return { kind: 'const', value: defaultVal };
  return { kind: 'field', field: minMaxInput(node, prop) };  // emit as today
}
```

The output-field rule (`mainSizeField`, `crossSizeField`, `crossPosField`, `mainPosField`) is then constructed from its `FoldedInput`s: `deps` collects only the `kind: 'field'` ones; `compute` reads fields via `read(...)` and uses constants inline.

**When every foldable input of a rule is `const`, the rule degenerates** — e.g. `mainSizeField` with folded flexBasis+min+max becomes `deps: [mainInput], compute: (read) => read(mainInput)`. No `Field` object is created for the folded properties at all — that is where the field-count reduction comes from.

This applies in `makeEmitter`'s `visit`, which is the single emission path for BOTH cold builds (`buildFlexGrammar`) and incremental structural fast-paths (`buildAppendFragment`) — so one change covers every build path.

### 2. The correctness mechanism — `nodeSig` extension

The hazard: if `minWidth` is folded (was 0), and a consumer calls `setMinWidth(node, 50)`, the folded `mainSizeField` rule has no `minWidth` dep — incremental relayout would silently ignore the new value.

The fix: the classifier's per-node structural signature `nodeSig` (`layout.ts:128-155`) must incorporate the **fold predicate** of every folded property. Then `setMinWidth(node, 50)` changes `style.minWidth` from `0` to `50` → `nodeSig` changes → the classifier sees `snap.sig !== nodeSig(n)` → triggers `fullBuild` → the grammar is rebuilt with `minWidth` *not* folded → correct output.

`nodeSig` gains 8 boolean bits (one per folded property):
```
minWidth === 0,  minHeight === 0,
maxWidth === undefined,  maxHeight === undefined,
margin[0] === 0,  margin[1] === 0,  margin[2] === 0,  margin[3] === 0
```
(`flexBasis === 'auto'` is already captured by the existing `typeof s.flexBasis` bit — no extension needed.)

The rebuild path itself is **already correct** once a sig change is detected: `fullBuild` → `buildFlexGrammar` → `makeEmitter` re-evaluates every fold predicate against current style. No rebuild-path changes needed.

`nodeSig` runs only in the classifier dirty-walk, not per-field — 8 extra string parts is negligible overhead.

### 3. Folded forms of the output rules

| Rule | Unfolded | Fully-folded (all foldable inputs default) |
|---|---|---|
| `mainSizeField` (no-distribution) | `deps:[flexBasis,main,minMain,maxMain]`, clamp | `deps:[main]`, `read(main)` |
| `crossSizeField` (stretch, explicit) | `deps:[crossSize,minCross,maxCross]`, clamp | `deps:[crossSize]`, `read(crossSize)` |
| `crossPosField` (flex-start align) | `deps:[padCrossStart,myMarginCrossStart]`, sum | `deps:[padCrossStart]`, `read(padCrossStart)` |
| `mainPosField` (phase-16 recurrence) | `deps:[prevPos,prevSize,prevMarginEnd,myMarginStart,gap]` | `deps:[prevPos,prevSize,gap]` (margins folded) |

Partial folds (some inputs default, some not) produce intermediate dep lists. The `FoldedInput`-driven rule construction handles all combinations uniformly.

### Files touched

```
packages/core/src/algorithm/spineless/layout.ts        MODIFY — nodeSig: +8 fold-predicate bits
packages/core/src/algorithm/spineless/flex-grammar.ts  MODIFY — FoldedInput helpers; fold-aware output-rule construction
bench/RESULTS.md                                       REGEN
bench/thresholds.json                                  UPDATE — hotstructural threshold
```

## Risk model

This is a grammar-core change — the third of the Phase 16/17 grammar work. Highest-risk class.

| Risk | Likelihood | Mitigation |
|---|:-:|---|
| A folded property is mutated but `nodeSig` doesn't capture its fold predicate → silent wrong layout | Medium | `nodeSig` extension must cover **every** folded property — the spec lists all 8. The structural-differential fuzzer MUST exercise `setMinWidth`/`setMaxWidth`/`setMargin` mutations after a fold; verify the fuzzer's mutation set includes them, and if not, that gap must be closed (a fuzzer enhancement) before Phase 17 is considered safe. |
| A folded output rule computes the wrong value (clamp degeneration is subtly wrong) | Low-Medium | `clampMinMax(x,0,∞) ≡ max(0,min(x,∞)) ≡ max(0,x)` — for non-negative sizes this is `x`. Layout sizes are non-negative. The Yoga oracle (33 absolute-position fixtures) + differential mode catch any arithmetic error. |
| `markDriftedInputs` / `buildRemoveFragment` trip over absent (folded) fields | Low | Exploration confirmed both already guard with `if (f !== undefined)` / `if (prev.grammar.has(f))` — folded (never-emitted) fields are naturally skipped. |
| A grammar regression hurts one of the 8 winning scenarios | Low-Medium | Differential mode + Yoga oracle + the full bench. Folded rules are *smaller* — cold builds get cheaper, not slower. |

**Controlling gate: the structural-differential fuzzer.** It must be green at numRuns=300 and once at 3000 — AND it must be confirmed to mutate min/max/margin properties (the fold-then-mutate path). If it doesn't, Phase 17 adds that coverage first.

## Validation plan

1. `pnpm typecheck` + `pnpm lint` — clean.
2. `pnpm test` — 1466 pass.
3. `pnpm test:differential` ×3 — 830 / 6 skipped.
4. Structural-differential fuzzer numRuns=300, then once at 3000 — green. **Confirm its mutation set includes setMinWidth/setMaxWidth/setMargin** (the fold-then-mutate correctness path). If absent, add it.
5. Yoga oracle (33) — green.
6. A targeted unit test: build a tree with a default-margin node, lay out, `setMargin(node, Edge.Top, 5)`, lay out again, assert the result matches a cold rebuild — the explicit fold-then-mutate → rebuild path.
7. `pnpm bench` — `hot-structural` drops toward ~70-90µs; no other scenario regresses.

## Projected impact

| Scenario | Pre-17 | Projected post-17 | Yoga | Result |
|---|---:|---:|---:|---|
| hot-structural | ~120µs | **~70-90µs** | ~93µs | **parity → win** |
| 8 others | unchanged | unchanged or slightly faster (smaller cold-build grammar) | — | 2-11× win held |

If `hot-structural` lands ≤ 93µs, Phase 15+16+17 delivers the outright goal: **a pure-TypeScript layout engine that beats Yoga's C++ on all 9 benchmarked workloads.** If it lands ~95-100µs (just over), it is statistical parity — an honest "matches or beats Yoga everywhere" claim, with 8 scenarios at 2-11×.

## Why this is the right final phase

Phase 16 fixed the *complexity* (O(N) → O(1) dep edges). Phase 17 fixes the *constant* (fewer fields to emit + integrate). Together they attack both factors of the structural-mutation cost. Field-folding is the genuine, general fix — it makes every simple-regime structural mutation cheaper, in every workload, by doing strictly less work. It is not benchmark-specific. After Phase 17, the Spineless engine emits a grammar fragment for an appended row that is ~half the size — closing most of the distance to Yoga's "splice a pointer" while keeping the full incremental-relayout power that wins the other 8 scenarios by 2-11×.
