# Phase 15G — O(removed) built.inputs cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` for tracking.

**Goal:** Eliminate the O(11,210) `built.inputs.filter(isTracked)` scan in `tryDetachRemove` (~185µs/remove iter). `runtime.detach` returns the set of fields it dropped; `built.inputs` becomes a `Set` so removal is O(|dropped|).

**Architecture:** `detach`'s `drop` closure already removes every dropped field (explicit removals + orphan-cleaned survivors). Collect into a `Set` and return it. `built.inputs` (write-only today — never iterated/indexed) becomes a `Set<Field>`; cleanup is `for (f of dropped) built.inputs.delete(f)`.

**Tech Stack:** TypeScript NodeNext ESM. Vitest. Structural-differential fuzzer (numRuns=300) is the controlling gate.

---

## File Structure

```
packages/core/src/algorithm/spineless/runtime.ts     MODIFY — detach returns Set<Field>
packages/core/src/algorithm/spineless/layout.ts      MODIFY — built.inputs → Set; collectInputs returns Set; tryDetachRemove uses detach return; .push→.add; reorder filter→delete
bench/RESULTS.md                                     REGEN
```

---

### Task 1: `runtime.detach` returns its dropped set

**Files:**
- Modify: `packages/core/src/algorithm/spineless/runtime.ts`

- [ ] **Step 1: Inventory `detach` callers**

Run: `grep -rn "\.detach(" packages/core/src/algorithm/spineless/`
Catalogue every call site. Expected: `layout.ts` (`tryDetachRemove`), possibly tests. Note any that annotate the result type as `void` — those need updating.

- [ ] **Step 2: Change `detach` to collect + return dropped fields**

In `runtime.ts`, `detach`'s `drop` closure (~line 228) currently:

```ts
    const drop = (f: Field<unknown>): void => {
      const omNode = this.omNodes.get(f);
      if (omNode !== undefined) {
        this.om.delete(omNode);
        removedOmNodes.add(omNode);
      }
      this.omNodes.delete(f);
      this.values.delete(f);
      this.dependents.delete(f);
      this.grammar.delete(f);
    };
```

Add a `dropped` Set, declared before `drop`, and `dropped.add(f)` inside `drop`. Change the method's return type from `void` to `Set<Field<unknown>>` and `return dropped;` at the end.

The method signature (find the actual line) changes from:
```ts
detach(removing: ReadonlySet<Field<unknown>>): void {
```
to:
```ts
detach(removing: ReadonlySet<Field<unknown>>): Set<Field<unknown>> {
```

Add `const dropped = new Set<Field<unknown>>();` near the top of the method body (alongside the existing `removedOmNodes` / `survivingDeps` declarations). In `drop`, add `dropped.add(f);`. At the end of the method (after the incremental-lastOm block from Phase 15F), `return dropped;`.

- [ ] **Step 3: Update `detach`'s JSDoc**

The `detach` method has a doc comment. Add a line documenting the return value: the set of every field removed — both the explicit `removing` set and any orphan-cleaned surviving deps.

- [ ] **Step 4: Run the runtime + spineless tests**

Run: `pnpm --filter @pilates/core test -- runtime`
Run: `pnpm --filter @pilates/core test -- spineless`
Expected: all pass. Returning a value where `void` was expected is backward-compatible — existing callers ignore it. If a test explicitly asserted `detach(...)` returns `undefined`, update it.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean. If a caller annotated `const x: void = runtime.detach(...)`, fix it (drop the annotation or use the returned set).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/algorithm/spineless/runtime.ts
git commit -m "$(cat <<'EOF'
phase 15G: runtime.detach returns its dropped field set

detach's `drop` closure is the single choke point for all field
removal — the explicit `removing` set AND orphan-cleaned surviving
deps. Collect every dropped field into a Set and return it.

Enables tryDetachRemove (Task 2) to clean built.inputs in
O(|dropped|) instead of an O(|built.inputs|) isTracked scan.
Returning a value is backward-compatible — void-expecting callers
ignore it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `built.inputs` → `Set`; O(|dropped|) cleanup in `tryDetachRemove`

**Files:**
- Modify: `packages/core/src/algorithm/spineless/layout.ts`

- [ ] **Step 1: Confirm `built.inputs` has no readers**

Run: `grep -rn "\.inputs\b" packages/core/src/algorithm/spineless/ | grep -v styleInputs | grep -v availableInputs`

Verify every `built.inputs` (and the local `inputs` in `collectInputs`) usage is one of: declaration, `.push`, `.filter`, `= collectInputs(...)`, or the Built-interface type. There must be NO `for...of built.inputs`, no `built.inputs[i]`, no passing `built.inputs` as an argument. (The earlier grep confirmed this — re-verify, since converting to Set breaks any indexer.)

If a genuine reader exists that needs array semantics: STOP, report as NEEDS_CONTEXT with the reader's location — the plan's Set approach needs revisiting.

- [ ] **Step 2: Change the `Built` interface + `collectInputs`**

`Built.inputs` (`layout.ts:220`): `inputs: Array<Field<unknown>>` → `inputs: Set<Field<unknown>>`.

`collectInputs` (`layout.ts:82`): currently builds + returns `Array<Field<unknown>>`. Change to build + return `Set<Field<unknown>>`:
```ts
function collectInputs(grammar: Grammar, runtime: SpinelessRuntime): Set<Field<unknown>> {
  const inputs = new Set<Field<unknown>>();
  // ... existing walk, but inputs.add(f) instead of inputs.push(f) ...
  return inputs;
}
```

- [ ] **Step 3: Update the graft-path write sites**

`layout.ts:563` `built.inputs.push(f)` → `built.inputs.add(f)`.

`layout.ts:570` `built.inputs = collectInputs(...)` — unchanged (collectInputs now returns a Set).

- [ ] **Step 4: Update the reorder-path write sites**

`layout.ts:765` `built.inputs = built.inputs.filter((f) => !removedFields.has(f))` → in-place delete:
```ts
      for (const f of removedFields) built.inputs.delete(f);
```
`layout.ts:769` `built.inputs.push(f)` → `built.inputs.add(f)`.

- [ ] **Step 5: Replace the `tryDetachRemove` O(N) scan**

`layout.ts:697` currently:
```ts
    built.inputs = built.inputs.filter((f) => built.runtime.isTracked(f));
```

The `detach` call in `tryDetachRemove` (find it — `built.runtime.detach(...)`) currently discards its return. Capture it:
```ts
    const dropped = built.runtime.detach(/* existing arg */);
```

Replace line 697 with:
```ts
    // `built.inputs` — remove every field detach dropped (the removed
    // subtree's inputs + any survivor orphan-cleaned by detach).
    // O(|dropped|) — detach's returned set is complete by construction.
    for (const f of dropped) built.inputs.delete(f);
```

`Set.delete` is a no-op for absent keys, so deleting all dropped fields (layout fields, intermediates, inputs alike) removes exactly the dropped leaf inputs from `built.inputs`.

Update the stale comment at lines 692-696 (it described the old `isTracked` rationale).

- [ ] **Step 6: Run the structural-differential fuzzer — controlling gate**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Expected: green at numRuns=300. A missed orphan in `built.inputs` would surface as a stale-tracking divergence over random mutation sequences. If a seed fails, pin deterministically, debug, fix, unpin.

- [ ] **Step 7: Run differential mode + full core suite**

Run: `pnpm test:differential`
Run: `pnpm --filter @pilates/core test`
Expected: 824 / 6 skipped; 1460 pass.

- [ ] **Step 8: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/algorithm/spineless/layout.ts
git commit -m "$(cat <<'EOF'
phase 15G: built.inputs as Set; O(dropped) cleanup in tryDetachRemove

tryDetachRemove rebuilt built.inputs via built.inputs.filter(
isTracked) — an O(|built.inputs|) scan, ~11,210 fields, ~185µs per
remove iter on hot-structural.

built.inputs is write-only (never iterated/indexed) — converted
from Array to Set. tryDetachRemove now removes exactly the fields
runtime.detach reported dropping: `for (f of dropped)
built.inputs.delete(f)` — O(|dropped|) ≈ O(124), not O(11,210).

detach's returned set includes orphan-cleaned survivors, so the
correctness concern the old isTracked scan guarded against (a
survivor's now-unread input field) is still handled.

Structural-differential fuzzer (numRuns=300) validates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Validation sweep + bench

**Files:** `bench/RESULTS.md` (regenerated).

- [ ] **Step 1: Lint + typecheck** — `pnpm lint && pnpm typecheck` — clean.

- [ ] **Step 2: Full workspace test** — `pnpm test` — 1460 pass.

- [ ] **Step 3: Differential mode ×3** — `pnpm test:differential` three times — 824 / 6 skipped each.

- [ ] **Step 4: Structural-differential fuzzer numRuns=300** — `pnpm --filter @pilates/core test -- spineless-structural.fuzz` — green.

- [ ] **Step 5: Yoga oracle** — `pnpm --filter @pilates/core test -- yoga-oracle` — 33 pass.

- [ ] **Step 6: Bench**

Run: `pnpm bench`
Compare `hot-structural` `@pilates/core (layout)` to pre-15G (commit `3f4e3d1`: 275µs).
Target: ≥ 15% faster → ~230µs or better. No other scenario regresses (the change only touches the Spineless detach path).

If `hot-structural` does NOT improve ≥ 10%, investigate: confirm the bench's remove iters actually hit the new O(|dropped|) path, and that `built.inputs` is genuinely a Set now.

- [ ] **Step 7: Commit `bench/RESULTS.md`**

```bash
git add bench/RESULTS.md
git commit -m "$(cat <<'EOF'
bench: refresh RESULTS.md post phase 15G

O(removed) built.inputs cleanup — hot-structural remove iter no
longer scans all ~11k input fields:
- [actual hot-structural before/after numbers]

Phase 15H (graft field-count reduction) targets the remaining gap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Replace `[actual ...]` with measurements.)

---

## Self-Review

**Spec coverage:**
- `detach` returns `Set<Field>`: Task 1. ✓
- `built.inputs` → `Set`: Task 2 Steps 2-4. ✓
- `collectInputs` returns Set: Task 2 Step 2. ✓
- O(|dropped|) cleanup in `tryDetachRemove`: Task 2 Step 5. ✓
- Reorder path updated: Task 2 Step 4. ✓
- No-reader verification: Task 2 Step 1 (with STOP/NEEDS_CONTEXT fallback). ✓
- Structural fuzzer gate: Task 2 Step 6, Task 3 Step 4. ✓
- Bench confirms improvement: Task 3 Step 6. ✓

**Placeholder scan:**
- Task 3 Step 7 `[actual ...]` — implementer fills from measurement.
- Task 2 Step 1 has a STOP/NEEDS_CONTEXT branch — that's a real safety gate, not a placeholder.
- No "TODO" / "implement later".

**Type / name consistency:**
- `detach(): Set<Field<unknown>>` — return type consistent between Task 1 (definition) and Task 2 (`const dropped = ...detach(...)`).
- `built.inputs: Set<Field<unknown>>` — interface (Task 2 Step 2), `collectInputs` return (Step 2), `.add`/`.delete` sites (Steps 3-5) all consistent.
- `dropped` — local name in both `runtime.detach` and `tryDetachRemove`; same `Set<Field<unknown>>` type.

No gaps. The detach return type change (Task 1) and its consumption (Task 2 Step 5) are the linchpin — both specified with matching `Set<Field<unknown>>`.
