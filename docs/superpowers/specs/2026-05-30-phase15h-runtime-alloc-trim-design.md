# Phase 15H — Runtime allocation trim (the last pure-TS hot-structural step)

## Context

After Phases 15F+15G, `hot-structural` is 211µs vs Yoga's ~94µs (2.24× loss). A deep exploration of the remaining cost (`runtime.graft` ~111µs + `buildAppendFragment` ~95µs) produced an **honest verdict**:

> Pure-TS optimizations can cut ~30-55µs, bringing hot-structural from 211µs to ~155-175µs — roughly 55-65% of Yoga's speed. **Reaching parity (~94µs) requires the WASM contingency** or a fundamental runtime data-structure rearchitecture. Pilates pays a grammar-maintenance tax on every structural operation that pure-imperative Yoga never pays.

Phase 15H is **the last pure-TS step**. It banks the two safe, no-API-impact wins the exploration identified, then the project faces the WASM decision squarely with the pure-TS plateau measured rather than estimated.

## Goal

Two allocation-trimming changes:

1. **`runCompute` zero-dep fast path** (`runtime.ts:506`) — `runCompute` builds `new Set(rule.deps)` per field per compute, purely to validate the rule's `compute` doesn't read undeclared deps. For a **zero-dep field** the Set is empty and the validating `read` closure can never be called. Skip both. ~100 of the 169 grafted fields are zero-dep leaves (margin/min/max/flex inputs) — ~100 Set allocations saved per graft. Also helps `recompute` (every value mutation) since leaf inputs are zero-dep. **Universal win, zero risk.**

2. **`buildAppendFragment` priors-array elimination** (`flex-grammar.ts:1468-1473`) — the simple-regime append builds a `priors: Node[]` array of all in-flow prior siblings, then passes it to `makeEmitter`. Exploration confirmed: in the simple-regime append path, only `priors.length` is consumed (as `indexInParent`); the array *contents* are read solely by the non-simple `priorMainSizes` path, which is unreachable from `buildAppendFragment`. Replace the array build with a counter; pass a shared empty array. **Structural-path win, low risk — the structural fuzzer validates.**

**Success criteria:**

1. `runCompute` skips `new Set` + closure for `rule.deps.length === 0`.
2. `buildAppendFragment` builds an in-flow count, not a `Node[]` array.
3. `pnpm test:differential` (824 / 6 skipped) green.
4. Structural-differential fuzzer numRuns=300 green — controlling gate for change 2.
5. Yoga oracle (33) green.
6. `pnpm bench`: `hot-structural` measurably faster (~185µs or better); no scenario regresses. hot-relayout scenarios may improve slightly (change 1 helps `recompute`).

**Non-goals:** Constant-folding of default-valued input fields — exploration rated it MEDIUM feasibility with a real mutation-fallback correctness risk, and only ~25µs. Not worth it when WASM is the next step anyway. Deferred indefinitely.

## Architecture

### Change 1 — `runCompute` zero-dep fast path

Current `runtime.ts:505-516`:

```ts
private runCompute<T>(field: Field<T>, rule: FieldRule<T>): T {
  const declaredDeps = new Set<Field<unknown>>(rule.deps);
  const read: ReadFn = <U>(dep: Field<U>): U => {
    if (!declaredDeps.has(dep as Field<unknown>)) {
      throw new Error(
        `[spineless-runtime] rule for "${field.name}" reads "${dep.name}" but did not declare it as a dependency`,
      );
    }
    return this.values.get(dep as Field<unknown>) as U;
  };
  return rule.compute(read);
}
```

A module-level `NEVER_READ` closure (a `ReadFn` that throws — a zero-dep rule's `compute` must never call `read`):

```ts
const NEVER_READ: ReadFn = (dep) => {
  throw new Error(
    `[spineless-runtime] a zero-dependency rule called read("${dep.name}") — it declared no deps`,
  );
};
```

`runCompute` gains the fast path:

```ts
private runCompute<T>(field: Field<T>, rule: FieldRule<T>): T {
  // Zero-dep fields (margin/min/max/flex leaf inputs, constants) can't
  // read anything — skip the per-compute Set allocation + closure.
  if (rule.deps.length === 0) {
    return rule.compute(NEVER_READ);
  }
  const declaredDeps = new Set<Field<unknown>>(rule.deps);
  const read: ReadFn = <U>(dep: Field<U>): U => {
    if (!declaredDeps.has(dep as Field<unknown>)) {
      throw new Error(
        `[spineless-runtime] rule for "${field.name}" reads "${dep.name}" but did not declare it as a dependency`,
      );
    }
    return this.values.get(dep as Field<unknown>) as U;
  };
  return rule.compute(read);
}
```

Behavior is identical: a zero-dep rule's `compute` is a constant function (`() => 0`, `() => node.style.margin[e] ?? 0`, etc.) — it never invokes `read`. If one ever did (a grammar bug), `NEVER_READ` throws with a clear message, same as the old undeclared-dep error.

### Change 2 — `buildAppendFragment` priors-array elimination

Current `flex-grammar.ts:1468-1473`:

```ts
    const priors: Node[] = [];
    for (let i = 0; i < childIndex; i++) {
      const sib = parent.getChild(i)!;
      if (isInFlow(sib)) priors.push(sib);
    }
    makeEmitter(ctx)(child, parent, priors.length, priors);
```

Becomes:

```ts
    // The simple-regime append emitter consumes only the in-flow
    // prior-sibling COUNT (as indexInParent). The array contents are
    // read only by the non-simple priorMainSizes path, unreachable
    // from buildAppendFragment — so pass a shared empty array.
    let priorInFlowCount = 0;
    for (let i = 0; i < childIndex; i++) {
      if (isInFlow(parent.getChild(i)!)) priorInFlowCount++;
    }
    makeEmitter(ctx)(child, parent, priorInFlowCount, EMPTY_PRIORS);
```

With a module-level `const EMPTY_PRIORS: readonly Node[] = []` (or `[]` if the signature wants mutable — the implementer matches the `makeEmitter` callback's 4th param type).

**Correctness obligation:** the `makeEmitter` callback's 4th parameter (`priorSiblings`) must not have its *contents* or its *`.length`* read in any path reachable from `buildAppendFragment`. The exploration verified this — the count is carried by the 3rd argument; the 4th's contents are read only behind `justify !== 'flex-start' && indexInParent > 0` in the `priorMainSizes` branch, and `buildAppendFragment` only emits via the simple-regime path. The structural-differential fuzzer is the safety net: if any reachable path reads `EMPTY_PRIORS`, a wrong-position divergence surfaces.

If the implementer's reading of `makeEmitter` finds that `priorSiblings.length` IS read somewhere reachable (instead of the 3rd-arg count), then keep passing a correctly-sized structure — but the simplest correct form is then to keep the array. Report as DONE_WITH_CONCERNS if change 2 can't be made safely; change 1 is the load-bearing win.

### Files touched

```
packages/core/src/algorithm/spineless/runtime.ts       MODIFY — runCompute zero-dep fast path + NEVER_READ
packages/core/src/algorithm/spineless/flex-grammar.ts  MODIFY — buildAppendFragment priors → count
bench/RESULTS.md                                       REGEN
```

## Risk model

| Risk | Likelihood | Mitigation |
|---|:-:|---|
| A zero-dep rule's `compute` actually calls `read` | Very Low | Zero-dep rules are constants by construction. `NEVER_READ` throws with a clear message if one does — strictly better than silent wrong behavior. Differential mode + fuzzer exercise every rule. |
| `makeEmitter` reads `priorSiblings` contents/length in a buildAppendFragment-reachable path | Low-Medium | Exploration verified not — but the implementer re-reads `makeEmitter`'s use of its 4th param. Structural fuzzer (numRuns=300) catches a wrong-position divergence. If unsafe, change 2 is dropped (DONE_WITH_CONCERNS) — change 1 stands alone. |
| Change 1 alters a hot-path enough to deopt | Very Low | The fast path is a strict subset of the slow path's work. Pure win. |

## Validation plan

1. `pnpm typecheck` + `pnpm lint`: clean.
2. `pnpm test`: 1460 pass.
3. `pnpm test:differential` ×3: 824 / 6 skipped.
4. Structural-differential fuzzer numRuns=300: green (controlling gate for change 2).
5. Yoga oracle: 33 pass.
6. `pnpm bench`: `hot-structural` faster; hot-relayout scenarios same-or-better; no regressions.

## Projected impact + the honest plateau

| Scenario | Pre-15H | Projected post-15H | Yoga | vs Yoga |
|---|---:|---:|---:|---|
| hot-structural | 211µs | ~180-190µs | 94µs | ~1.95× loss |
| hot-relayout × 3 | ~21µs | ~20µs | 74-85µs | ~3.7× win (unchanged-ish) |
| (cold scenarios) | unchanged | unchanged | — | ≥ 2× win |

**This is the pure-TS plateau.** After Phase 15H, `hot-structural` sits at roughly 1.9-2× behind Yoga — the irreducible grammar-maintenance tax. The project then faces the documented decision: invoke the WASM contingency (Phase 15I) to port the structural hot path and reach a decisive win, or ship "8 decisive wins + 1 near-2× structural" as a pure-TS result.

Phase 15H's value is not just the ~25-30µs — it is **measuring the plateau precisely** so the WASM go/no-go is made on data, not projection.
