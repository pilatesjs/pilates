# Phase 15H — Runtime allocation trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` for tracking.

**Goal:** Two safe pure-TS allocation-trim wins. (1) `runCompute` skips `new Set(rule.deps)` + closure for zero-dep fields. (2) `buildAppendFragment` builds an in-flow count instead of a `priors: Node[]` array. Projected: hot-structural 211µs → ~185µs. This is the measured pure-TS plateau before the WASM decision.

**Tech Stack:** TypeScript NodeNext ESM. Vitest. Structural-differential fuzzer (numRuns=300) is the controlling gate for change 2.

---

## File Structure

```
packages/core/src/algorithm/spineless/runtime.ts       MODIFY — runCompute zero-dep fast path + NEVER_READ const
packages/core/src/algorithm/spineless/flex-grammar.ts  MODIFY — buildAppendFragment priors-array → count
bench/RESULTS.md                                       REGEN
```

---

### Task 1: `runCompute` zero-dep fast path

**File:** `packages/core/src/algorithm/spineless/runtime.ts`

`runCompute` (lines 505-516) builds `new Set(rule.deps)` per field per compute — purely to validate the rule doesn't read undeclared deps. Zero-dep fields (margin/min/max/flex leaf inputs — ~100 of the 169 grafted per hot-structural append) get an empty Set and a closure that can never be called.

- [ ] **Step 1: Add the `NEVER_READ` module-level constant**

Near the top of `runtime.ts` (after imports, with other module-level consts), add:

```ts
/**
 * A `ReadFn` for zero-dependency rules — they declare no deps, so their
 * `compute` must never call `read`. If one does, this throws (a grammar
 * bug), mirroring the undeclared-dependency error in the normal path.
 */
const NEVER_READ: ReadFn = (dep) => {
  throw new Error(
    `[spineless-runtime] a zero-dependency rule called read("${dep.name}") — it declared no deps`,
  );
};
```

(`ReadFn` is already a type in this file / imported — confirm and reuse it.)

- [ ] **Step 2: Add the fast path to `runCompute`**

Change `runCompute` (line 505) from:

```ts
  private runCompute<T>(field: Field<T>, rule: FieldRule<T>): T {
    const declaredDeps = new Set<Field<unknown>>(rule.deps);
    const read: ReadFn = <U>(dep: Field<U>): U => {
```

to:

```ts
  private runCompute<T>(field: Field<T>, rule: FieldRule<T>): T {
    // Zero-dep fields (leaf inputs, constants) can't read anything —
    // skip the per-compute Set allocation + validating closure.
    if (rule.deps.length === 0) {
      return rule.compute(NEVER_READ);
    }
    const declaredDeps = new Set<Field<unknown>>(rule.deps);
    const read: ReadFn = <U>(dep: Field<U>): U => {
```

(The rest of the method body — the `read` closure and `return rule.compute(read)` — is unchanged.)

- [ ] **Step 3: Run runtime + spineless tests**

Run: `pnpm --filter @pilates/core test -- runtime`
Run: `pnpm --filter @pilates/core test -- spineless`
Expected: all pass. Zero-dep rules are constant functions; behavior is identical.

- [ ] **Step 4: Run differential mode + structural fuzzer**

Run: `pnpm test:differential`
Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Expected: 824 / 6 skipped; fuzzer green at numRuns=300. `runCompute` runs on every field of every layout — any behavior change surfaces here.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/algorithm/spineless/runtime.ts
git commit -m "$(cat <<'EOF'
phase 15H: runCompute zero-dep fast path

runCompute built `new Set(rule.deps)` + a validating `read` closure
per field per compute — purely to catch a rule reading an
undeclared dependency. Zero-dependency fields (margin/min/max/flex
leaf inputs — ~100 of the 169 fields grafted per hot-structural
append) get an empty Set and a closure that can never fire.

Added a `rule.deps.length === 0` fast path: call compute with a
shared NEVER_READ closure (throws if a zero-dep rule ever calls
read — a grammar bug). Skips ~100 Set allocations per graft, and
helps recompute on every value mutation too (leaf inputs are
zero-dep).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `buildAppendFragment` priors-array → count

**File:** `packages/core/src/algorithm/spineless/flex-grammar.ts`

`buildAppendFragment` (lines 1468-1473) builds a `priors: Node[]` array of in-flow prior siblings, then passes it to `makeEmitter`. Only `priors.length` is consumed in the simple-regime path; the array contents are read solely by a non-simple path unreachable here.

- [ ] **Step 1: Verify `makeEmitter`'s use of its 4th parameter**

Read `makeEmitter` (in `flex-grammar.ts`) — specifically how its returned `visit` callback uses its 4th parameter (the `priorSiblings` array). Confirm:
- The COUNT it needs is the 3rd argument (`indexInParent` / `priors.length`), not `priorSiblings.length`.
- The 4th-arg array CONTENTS are read only in a path guarded by conditions false in the simple-regime append (per the exploration: `justify !== 'flex-start' && indexInParent > 0`, the `priorMainSizes` branch).

If this holds — proceed to Step 2. If `priorSiblings.length` or contents ARE read in a buildAppendFragment-reachable path, STOP: keep the array, report DONE_WITH_CONCERNS noting change 2 isn't safe (Task 1 still stands).

- [ ] **Step 2: Add the `EMPTY_PRIORS` constant**

Near the top of `flex-grammar.ts` module scope, add:

```ts
/** Shared empty prior-siblings array for buildAppendFragment — the
 *  simple-regime emitter consumes only the in-flow count, never the
 *  array contents. */
const EMPTY_PRIORS: Node[] = [];
```

(Match the exact element type the `makeEmitter` callback's 4th param expects — `Node[]` or `readonly Node[]`.)

- [ ] **Step 3: Replace the priors loop**

Change `flex-grammar.ts:1468-1473` from:

```ts
    const priors: Node[] = [];
    for (let i = 0; i < childIndex; i++) {
      const sib = parent.getChild(i)!;
      if (isInFlow(sib)) priors.push(sib);
    }
    makeEmitter(ctx)(child, parent, priors.length, priors);
```

to:

```ts
    let priorInFlowCount = 0;
    for (let i = 0; i < childIndex; i++) {
      if (isInFlow(parent.getChild(i)!)) priorInFlowCount++;
    }
    makeEmitter(ctx)(child, parent, priorInFlowCount, EMPTY_PRIORS);
```

- [ ] **Step 4: Run the structural-differential fuzzer — controlling gate**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Expected: green at numRuns=300. If any reachable path reads `EMPTY_PRIORS`, an appended node lands at the wrong position → cold-rebuild divergence. If a seed fails, the change-2 assumption is wrong — revert change 2, report DONE_WITH_CONCERNS.

- [ ] **Step 5: Run differential mode + full core suite**

Run: `pnpm test:differential`
Run: `pnpm --filter @pilates/core test`
Expected: 824 / 6 skipped; 1460 pass.

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts
git commit -m "$(cat <<'EOF'
phase 15H: buildAppendFragment builds in-flow count, not priors array

The simple-regime append built a priors: Node[] array of all in-flow
prior siblings, then passed it to makeEmitter. Only the COUNT is
consumed (as indexInParent, the 3rd arg); the 4th-arg array contents
are read solely by the non-simple priorMainSizes path, unreachable
from buildAppendFragment.

Replaced the array build with a counter; pass a shared empty array.
Saves ~100 array pushes + the allocation per hot-structural append.

Structural-differential fuzzer (numRuns=300) validates: a wrong
prior count or a read of the empty array would misplace the
appended node.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Validation sweep + bench

**Files:** `bench/RESULTS.md` (regenerated).

- [ ] **Step 1: Lint + typecheck** — `pnpm lint && pnpm typecheck` — clean.

- [ ] **Step 2: Full workspace test** — `pnpm test` — 1460 pass.

- [ ] **Step 3: Differential mode ×3** — `pnpm test:differential` ×3 — 824 / 6 skipped each.

- [ ] **Step 4: Structural fuzzer numRuns=300** — `pnpm --filter @pilates/core test -- spineless-structural.fuzz` — green.

- [ ] **Step 5: Yoga oracle** — `pnpm --filter @pilates/core test -- yoga-oracle` — 33 pass.

- [ ] **Step 6: Bench**

Run: `pnpm bench`
Compare `hot-structural` `@pilates/core (layout)` to pre-15H (commit `d62fcbd`: 211.7µs).
Expectation: ~185-195µs (modest — this is the documented pure-TS plateau). hot-relayout × 3 may improve a touch (change 1 helps `recompute`). No regressions.

Record the exact `hot-structural` number — it is the **measured pure-TS plateau** that the WASM go/no-go decision depends on.

- [ ] **Step 7: Commit `bench/RESULTS.md`**

```bash
git add bench/RESULTS.md
git commit -m "$(cat <<'EOF'
bench: refresh RESULTS.md post phase 15H — pure-TS plateau measured

Runtime allocation trim (runCompute zero-dep fast path +
buildAppendFragment priors-count):
- [actual hot-structural before/after numbers]

This is the pure-TS plateau for hot-structural. The remaining gap
to Yoga is the irreducible grammar-maintenance tax. The project
now faces the WASM-contingency decision (phase 15I) with the
plateau measured, not estimated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Replace `[actual ...]` with measurements.)

---

## Self-Review

**Spec coverage:**
- `runCompute` zero-dep fast path + `NEVER_READ`: Task 1. ✓
- `buildAppendFragment` priors → count: Task 2. ✓
- `makeEmitter` 4th-param verification with STOP fallback: Task 2 Step 1. ✓
- Structural fuzzer as change-2 gate: Task 2 Step 4, Task 3 Step 4. ✓
- Bench measures the plateau: Task 3 Step 6. ✓

**Placeholder scan:**
- Task 3 Step 7 `[actual ...]` — implementer fills from measurement.
- Task 2 Step 1 STOP/DONE_WITH_CONCERNS branch — a real safety gate, not a placeholder.
- No "TODO" / "implement later".

**Type / name consistency:**
- `NEVER_READ: ReadFn` — defined Task 1 Step 1, used Task 1 Step 2. `ReadFn` is the existing type.
- `EMPTY_PRIORS: Node[]` — defined Task 2 Step 2, used Step 3. Element type matched to `makeEmitter`'s 4th param.
- `priorInFlowCount` — local in `buildAppendFragment`, replaces `priors.length` as the 3rd `makeEmitter` arg.

No gaps. Change 1 (Task 1) is independent and load-bearing; change 2 (Task 2) has an explicit safety-abort path if the `makeEmitter` verification fails.
