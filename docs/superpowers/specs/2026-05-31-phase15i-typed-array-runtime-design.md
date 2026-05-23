# Phase 15I — Typed-array Spineless runtime rearchitecture

## Mission

Replace the Spineless runtime's four `Map<Field, X>` dependency-graph data structures with integer-`field.id`-indexed typed arrays (and plain arrays for closure-bearing data). This is the rearchitecture that takes `hot-structural` from its pure-TS plateau (~220µs, 2.3× Yoga) to **~90-105µs — at or within 10% of Yoga parity** — making Pilates a clean 9/9 decisive win, still in pure TypeScript.

The decision to pursue this (over a WASM rewrite) was made explicitly: keep the "pure TypeScript beats C++" story intact.

## Why this works

A precision profile + a full architectural exploration established:

- `hot-structural`'s remaining cost is **Map/Set/object-graph manipulation** — `runtime.graft` does ~5 Map ops per field × 169 fields; `recompute` does `values.get` per dependency per field. JS `Map` on object keys is ~40-80ns per op (hidden-class hash + hash-table access).
- **All Spineless field values are `number`** (confirmed: every `flex-grammar.ts` field is `Field<number>`). So `values` can be a `Float64Array`.
- `Field` objects are interned by a `field(node, name)` factory (`grammar.ts:218`) — exactly one creation site. Adding an integer `id` there mirrors Phase 15C's `Node._id` precisely.
- The runtime's **public API is a stable seam**: `init` / `graft` / `detach` / `rebindRule` / `markDirty` / `markAllDirty` / `recompute` / `evaluate` / `isTracked` / `stats`. All take/return `Field` objects + `Grammar` Maps. If the typed-array storage is purely internal, **`layout.ts` needs zero changes.**

The conversion is mechanical substitution (`map.get(f)` → `arr[f.id]`), and the **differential mode + structural fuzzer validate byte-identical output** at every step.

## Scope

**In:** `SpinelessRuntime`'s four internal associative structures:
- `values: Map<Field, unknown>` → `Float64Array` + `Uint8Array` presence bitset.
- `grammar: Map<Field, FieldRule>` → `(FieldRule | undefined)[]` indexed by `field.id`.
- `omNodes: Map<Field, OMNode>` → `(OMNode | undefined)[]` indexed by `field.id`.
- `dependents: Map<Field, Field[]>` → `(Field[] | undefined)[]` indexed by `field.id`.

Plus: `Field._id` + a `FieldIdPool` module, and a bonus `runCompute` Set-allocation elimination.

**Out:**
- The runtime's PUBLIC API — signatures stay identical.
- `layout.ts` and the `Built` interface — untouched.
- The grammar builder (`flex-grammar.ts`) — untouched (it still emits a `Grammar` Map; the runtime copies it internally).
- The OM structure's own internals (BenderNode linked list) — a typed-array OM is a possible *future* phase, not 15I.
- The priority queue — already uses parallel arrays; minor, deferred.

## Success criteria

1. `hot-structural` ≤ 110µs (target ≤ 100µs — Yoga parity-or-win).
2. All 8 other scenarios non-regressing (the Map→array conversion can only help or be neutral).
3. `pnpm test:differential` (824 / 6 skipped) green at every sub-phase commit.
4. Structural-differential fuzzer numRuns=300 green at every sub-phase commit — the controlling correctness gate.
5. Yoga oracle (33) green.
6. `layout.ts` unchanged (proof the public API held).
7. Pure TypeScript — no WASM, no new runtime dependencies.

## Sub-phases (dependency order — each independently shippable + fuzzer-validated)

### 15I-a — `Field._id` + `FieldIdPool` (prerequisite)

Add `id: number` to the `Field` interface (`grammar.ts`). The `field(node, name)` factory (`grammar.ts:218`) assigns `id: allocateFieldId()`. New `field-id-pool.ts` module mirrors `layout-pool.ts` — a monotonic counter, grow-aware. No runtime changes; `Field` objects remain valid Map keys. Purely additive. Fuzzer confirms zero behavior change.

### 15I-b — `values` → `Float64Array` (highest ROI)

`SpinelessRuntime.values: Map<Field, unknown>` → `valuesArr: Float64Array` (grow-on-demand) + `valuePresent: Uint8Array` (the "has been computed" bitset, replacing `values.has`). ~8 call sites in `runtime.ts`. The `recompute` inner loop's per-dep `values.get` becomes a typed-array index. Projected: 40-50% of total hot-structural time.

### 15I-c — `grammar` → `FieldRule[]`

`SpinelessRuntime`'s internal `grammar: Map<Field, FieldRule>` → `rulesArr: (FieldRule | undefined)[]` indexed by `field.id`. The constructor + `graft` still ACCEPT a `Grammar` Map (public API) and copy it into `rulesArr`. `recompute`'s `grammar.get(f)` → `rulesArr[f.id]`. Projected: +15%.

### 15I-d — `omNodes` → `OMNode[]`

`omNodes: Map<Field, OMNode>` → `omNodesArr: (OMNode | undefined)[]`. The "is integrated" sentinel `omNodes.has(f)` → `omNodesArr[f.id] !== undefined`. Projected: +15%.

### 15I-e — `dependents` → `Field[][]`

`dependents: Map<Field, Field[]>` → `dependentsArr: (Field[] | undefined)[]` indexed by `field.id`. The `splice(indexOf(...))` removal logic is unchanged, just operating on `dependentsArr[f.id]`. Projected: +15%.

### 15I-f — `runCompute` per-rule dep-Set (bonus)

`runCompute` allocates `new Set(rule.deps)` per non-leaf compute (~1,700/full pass). Build the dep-Set once at rule-registration time, store it on the `FieldRule` (or a parallel array). Projected: +5%.

## Per-sub-phase migration pattern

Each of 15I-b through 15I-e follows the identical shape:

1. Add the typed/plain array field to `SpinelessRuntime` (grow-on-demand helper).
2. Replace every `thisMap.set(f, v)` → `arr[f.id] = v` (grow if `f.id >= capacity`).
3. Replace every `thisMap.get(f)` → `arr[f.id]`.
4. Replace every `thisMap.delete(f)` → `arr[f.id] = <empty sentinel>`.
5. Replace every `thisMap.has(f)` → `arr[f.id] !== <sentinel>` (or the presence bitset for `values`).
6. Replace every `for (const [f, v] of thisMap)` iteration with a loop over allocated IDs (the runtime tracks its own field set — e.g. via the `omNodesArr` presence, or a separate `Field[]` roster if needed).
7. Run differential + structural fuzzer. Commit.

The iteration cases (step 6) are the only non-mechanical part — `runtime.ts` iterates `grammar` (in `collectInputs` via `layout.ts` — but that reads the *grammar-builder's* Map, not the runtime's copy, so unaffected) and `omNodes` (in `markAllDirty`). The implementer handles each iteration explicitly: the runtime keeps a `Field[]` roster of all live fields if needed for iteration.

## Capacity growth

`field.id` is monotonically assigned by `FieldIdPool` (15I-a). The runtime's typed arrays size to the max `field.id` seen. `graft` adds fields → IDs climb → arrays grow (double-on-demand, copy forward — the `LayoutPool` pattern). Fields are interned and never freed at the JS level (nodes outlive fields), so the pool grows to the live-field high-water mark — same accepted tradeoff as `LayoutPool`.

## Risk model

| Risk | Likelihood | Mitigation |
|---|:-:|---|
| A Map→array substitution misses a call site → stale read | Medium | Differential mode runs every layout twice (cached + cold), asserts byte-identical. A missed site diverges immediately. Per-sub-phase commits keep blast radius small. |
| `values` presence-bitset desyncs from `valuesArr` | Low-Medium | The bitset is set/cleared in lockstep with every `valuesArr` write/delete. Structural fuzzer's 12-mutation chains exercise the set/clear/re-set cycle. |
| Iteration-order dependency broken when a Map becomes an array | Low | Exploration confirmed no correctness-relevant insertion-order reliance. `markAllDirty` order doesn't matter (the PQ re-sorts by OM rank). |
| Typed-array growth races a hot path | Low | Layout is single-threaded; growth is synchronous, same as LayoutPool. |
| `field.id` collisions across runtimes (multiple roots) | Low | IDs are globally monotonic from one `FieldIdPool` — every field across every tree gets a unique id. The runtime's arrays are sized to the global max; sparse but correct. (If memory becomes a concern with many roots, a future phase can per-runtime-renumber — out of 15I scope.) |
| The public API accidentally changes | Low | Success criterion 6: `layout.ts` must be byte-unchanged. If a sub-phase needs to touch `layout.ts`, STOP and re-evaluate. |

## Validation — every sub-phase

1. `pnpm typecheck` + `pnpm lint`: clean.
2. `pnpm test`: 1460 pass.
3. `pnpm test:differential` ×3: 824 / 6 skipped.
4. Structural-differential fuzzer numRuns=300: green. **The controlling gate.**
5. Yoga oracle: 33 pass.
6. `git diff --stat packages/core/src/algorithm/spineless/layout.ts` shows **no change** (public-API-stability proof).
7. `pnpm bench` at the end of each sub-phase: record `hot-structural`; confirm monotonic improvement, no regression elsewhere.

## Projected trajectory

| After | hot-structural | vs Yoga (~95µs) |
|---|---:|---|
| 15I-a (prerequisite, no perf) | ~220µs | 2.3× loss |
| 15I-b (`values` → Float64Array) | ~130-140µs | ~1.45× loss |
| 15I-c (`grammar` → array) | ~115-120µs | ~1.25× loss |
| 15I-d (`omNodes` → array) | ~105-110µs | ~1.15× loss |
| 15I-e (`dependents` → array) | ~95-100µs | ~parity |
| 15I-f (Set elimination) | ~88-95µs | **parity-to-win** |

**Honest estimate:** 15I-b…f brings `hot-structural` to the 88-105µs range — at or just past Yoga's ~95µs. The residual uncertainty is the BenderOM's per-`insertAfter` `BenderNode` allocation during graft; if 15I-e lands at ~100µs (just short), a follow-on typed-array OM phase (15J) closes it. If it lands ≤ 95µs, Phase 15 achieves a clean 9/9 decisive win and the project ships.

## Why the public-API seam matters

The single most important architectural property: the runtime's ten public methods are unchanged. `layout.ts` — 800+ lines of intricate Spineless driver logic, the most-fuzzer-validated code in the engine — is not touched. The rearchitecture is confined to `runtime.ts`'s private storage + the new `field-id-pool.ts`. This is what makes a multi-sub-phase refactor of the engine core tractable: each sub-phase is a small, mechanically-verifiable, fuzzer-gated diff against one file.
