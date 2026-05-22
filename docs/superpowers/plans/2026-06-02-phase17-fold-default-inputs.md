# Phase 17 — Fold default-valued style inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Stop emitting grammar input fields for default-valued style properties (margin 0, min 0, max ∞, flexBasis 'auto'). Inline the constants. ~15 → ~6-7 fields/node → `hot-structural` ~120µs → ~70-90µs (parity-to-win vs Yoga).

**Architecture:** A `FoldedInput` abstraction in `flex-grammar.ts`'s `visit` — each foldable input resolves to either a `Field` (non-default) or a constant (default). Output rules build `deps`/`compute` from the mix. `nodeSig` (`layout.ts`) gains 8 fold-predicate bits so mutating a folded property triggers a rebuild.

**Tech Stack:** TypeScript NodeNext ESM. Vitest. The structural-differential fuzzer + Yoga oracle + differential mode gate this grammar-core change.

---

## File Structure

```
packages/core/src/algorithm/spineless/layout.ts        MODIFY — nodeSig +8 fold-predicate bits
packages/core/src/algorithm/spineless/flex-grammar.ts  MODIFY — FoldedInput; fold-aware output-rule construction
packages/core/src/algorithm/spineless/<a test file>    MODIFY — add a fold-then-mutate unit test
bench/RESULTS.md / bench/thresholds.json               UPDATE
```

---

### Task 1: Extend `nodeSig` with fold-predicate bits

**File:** `packages/core/src/algorithm/spineless/layout.ts`

`nodeSig` (around `layout.ts:128-155`) builds a per-node structural-signature string. It must capture the default-ness of every property Phase 17 will fold, so that mutating a folded property changes the sig → classifier rebuilds.

- [ ] **Step 1: Read `nodeSig`**

Confirm its current shape (a `[...].join('|')` over style fields). Note it already has `typeof s.flexBasis` (so flexBasis 'auto' is covered — no new bit needed for it).

- [ ] **Step 2: Append 8 fold-predicate bits**

Add to the `nodeSig` array (exact property access per `node.style`'s shape — read `style.ts` to confirm `margin` is an array `[top,right,bottom,left]` and min/max are `number`/`number|undefined`):

```ts
    s.minWidth === 0 ? '_' : 'mw',
    s.minHeight === 0 ? '_' : 'mh',
    s.maxWidth === undefined ? '_' : 'xw',
    s.maxHeight === undefined ? '_' : 'xh',
    s.margin[0] === 0 ? '_' : 'm0',
    s.margin[1] === 0 ? '_' : 'm1',
    s.margin[2] === 0 ? '_' : 'm2',
    s.margin[3] === 0 ? '_' : 'm3',
```

(Match the actual default checks to `style.ts` — `minWidth` default may be `0` or `undefined`; `maxWidth` default `undefined`. Use the *exact* default sentinel. The bit must flip iff the property crosses the fold boundary.)

- [ ] **Step 3: Validate (no behavior change yet)**

Run: `pnpm --filter @pilates/core test` + `pnpm test:differential` + `pnpm typecheck && pnpm lint`.
Expected: all green, 1466 / 830-6. `nodeSig` extension alone changes nothing observable — it only makes the sig finer-grained (a few mutations that were "value-only" might now classify as "sig change → rebuild", which is correct and harmless, just slightly more conservative until Task 2 makes it load-bearing).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/algorithm/spineless/layout.ts
git commit -m "$(cat <<'EOF'
phase 17: nodeSig captures fold-predicate of min/max/margin

Extends the classifier's per-node structural signature with 8 bits:
the default-ness of minWidth/minHeight/maxWidth/maxHeight and the 4
margin edges. Prerequisite for Phase 17's input-field folding —
once those properties are folded out of the grammar, mutating one
must change nodeSig so the classifier triggers a rebuild.

No behavior change yet (folding lands in the next commit). At worst
a min/max/margin mutation now classifies as a rebuild instead of an
incremental relayout — correct, slightly conservative.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Fold default-valued inputs in the emitter

**File:** `packages/core/src/algorithm/spineless/flex-grammar.ts`

- [ ] **Step 1: Read the emitter**

Read `makeEmitter` / `visit` and the input-emitting helpers `minMaxInput` (~line 471), `marginInput` (~line 545), `styleSizeInput` (~line 453). Read the output-field rule construction for `mainSizeField` (~924-939), `crossSizeField` (~726-731), `crossPosField` (~1268-1271), `mainPosField` (the phase-16 recurrence ~1123-1137 and first-child ~1073-1076). Understand exactly how each output rule currently lists `minMaxInput`/`marginInput` results in its `deps` and `compute`.

- [ ] **Step 2: Add the `FoldedInput` abstraction**

Near the top of the emitter section:

```ts
/** A grammar input that is either a tracked Field or a folded constant. */
type FoldedInput =
  | { readonly kind: 'field'; readonly field: Field<number> }
  | { readonly kind: 'const'; readonly value: number };
```

Resolver helpers — fold when the property is at default, else emit the field as today:

```ts
function foldMinMax(node: Node, prop: 'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight'): FoldedInput {
  const raw = node.style[prop];
  const isMax = prop === 'maxWidth' || prop === 'maxHeight';
  if (isMax ? raw === undefined : raw === 0) {
    return { kind: 'const', value: isMax ? Number.POSITIVE_INFINITY : 0 };
  }
  return { kind: 'field', field: minMaxInput(node, prop) };
}

function foldMargin(node: Node, edge: number, ...emit args): FoldedInput {
  if (node.style.margin[edge] === 0) return { kind: 'const', value: 0 };
  return { kind: 'field', field: marginInput(node, edge) };
}
```

(Adjust signatures to the real `minMaxInput`/`marginInput` parameter shapes.)

- [ ] **Step 3: Make output-rule construction fold-aware**

For each output rule that reads foldable inputs (`mainSizeField`, `crossSizeField`, `crossPosField`, `mainPosField`), build its `deps` + `compute` from `FoldedInput`s:
- `deps`: collect only `kind: 'field'` entries.
- `compute`: for a `field` input, `read(f)`; for a `const` input, the literal value.

Concretely — a clamp rule `clampMinMax(preferred, min, max)` where `min` and `max` are `FoldedInput`:
- both const → `compute: (read) => clamp(read(preferred), 0, ∞)` ≡ `(read) => Math.max(0, read(preferred))` — and since preferred is a non-negative size, ≡ `(read) => read(preferred)`. Emit the degenerate form.
- mixed → include the field dep(s), inline the const(s).

A small helper keeps this uniform, e.g.:
```ts
function readFolded(fi: FoldedInput, read: ReadFn): number {
  return fi.kind === 'field' ? read(fi.field) : fi.value;
}
```
and `deps` built by `[...inputs.filter(i => i.kind === 'field').map(i => i.field)]`.

Apply to:
- `mainSizeField` — folds `flexBasis` ('auto'), `minMain`, `maxMain`.
- `crossSizeField` — folds `minCross`, `maxCross`.
- `crossPosField` — folds `myMarginCrossStart`.
- `mainPosField` (phase-16 recurrence) — folds `prevMarginEnd`, `myMarginMainStart`.
- `mainPosField` first-child base case — folds `myMarginMainStart`.

When ALL of a rule's foldable inputs are `const`, the rule is the degenerate form (fewest deps). The folded properties' `Field` objects are never created — that is the field-count win.

- [ ] **Step 4: Yoga oracle — positional ground truth**

Run: `pnpm --filter @pilates/core test -- yoga-oracle` — 33 pass. A wrong fold (clamp degeneration error, margin drop) fails here.

- [ ] **Step 5: Differential mode**

Run: `pnpm test:differential` — 830 / 6 skipped. Every layout cached-vs-cold byte-identical.

- [ ] **Step 6: Structural fuzzer + the fold-then-mutate path**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz` — green at numRuns=300.

**Then verify the fuzzer exercises fold-then-mutate:** open `spineless-structural.fuzz.test.ts`, check its mutation set includes `setMinWidth`/`setMaxWidth`/`setMinHeight`/`setMaxHeight`/`setMargin`. If it does NOT, the fuzzer cannot catch a missed `nodeSig` bit — add those mutations to the fuzzer's operation set (this is a required correctness-coverage addition for Phase 17). Re-run.

- [ ] **Step 7: Add an explicit fold-then-mutate unit test**

In an appropriate spineless test file, add: build a tree with a node at default margin/min/max, `calculateLayout`, then `setMinWidth(node, 50)` (and separately `setMargin`), `calculateLayout` again, assert the result is byte-identical to a cold rebuild of the final tree. This is the direct regression test for the fold-correctness mechanism.

- [ ] **Step 8: Full core suite + typecheck + lint**

Run: `pnpm --filter @pilates/core test` (1466+), `pnpm typecheck && pnpm lint` (clean).

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts <test file>
git commit -m "$(cat <<'EOF'
phase 17: fold default-valued style inputs out of the grammar

A simple-regime cell emitted ~15 grammar fields; ~8 were input
fields for properties at their default (margin 0, min 0, max inf,
flexBasis auto) — emitted only so a future mutation has a field to
dirty. When the property is at default the consuming rule
degenerates (clampMinMax(x,0,inf) == x; padStart+0 == padStart).

Phase 17 folds them: the FoldedInput resolver returns a tracked
Field for a non-default property, a constant for a default one.
Output rules (mainSize/crossSize/crossPos/mainPos) build deps +
compute from the mix; a fully-default rule emits the degenerate
form and creates no Field for the folded properties.

~15 -> ~6-7 fields/node. A structural append of an 11-node row
emits ~half the grammar fragment — roughly halving graft + OM
integration.

Correctness: nodeSig (prev commit) captures each folded property's
fold predicate, so mutating a folded property changes the sig ->
classifier rebuilds the grammar un-folded. Validated by the
structural fuzzer (now exercising setMinWidth/setMargin) + an
explicit fold-then-mutate unit test + the Yoga oracle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Validation sweep + bench + thresholds

- [ ] **Step 1: Lint + typecheck** — clean.
- [ ] **Step 2: Full workspace test** — `pnpm test` — 1466+ pass.
- [ ] **Step 3: Differential ×3** — `pnpm test:differential` — 830/6 each.
- [ ] **Step 4: Structural fuzzer — 300, then once at 3000** — green both.
- [ ] **Step 5: Yoga oracle** — 33 pass.
- [ ] **Step 6: Bench** — `pnpm bench`. Inspect `hot-structural` `@pilates/core (layout)`: expect ~70-95µs (was ~120µs). Check ALL 9 — no regression; the 8 wins hold. Compute each ratio vs the same run's Yoga.
- [ ] **Step 7: Update `bench/thresholds.json`** — `hotstructural` entry to the new range.
- [ ] **Step 8: `pnpm bench:budgets`** — "all within threshold".
- [ ] **Step 9: Commit `bench/RESULTS.md` + `thresholds.json`** — message records the final 9-scenario ratios and whether 9/9 was achieved.

---

## Self-Review

**Spec coverage:**
- nodeSig +8 bits: Task 1. ✓
- FoldedInput + resolvers: Task 2 Steps 2. ✓
- Fold-aware output rules (mainSize/crossSize/crossPos/mainPos): Task 2 Step 3. ✓
- Single emission path covers cold + append: inherent (`makeEmitter`/`visit`). ✓
- Fuzzer must exercise fold-then-mutate: Task 2 Step 6 (with a "add it if missing" requirement). ✓
- Explicit fold-then-mutate unit test: Task 2 Step 7. ✓
- Yoga oracle + differential gates: Tasks 2, 3. ✓
- Fuzzer at 3000: Task 3 Step 4. ✓
- thresholds update: Task 3 Step 7. ✓

**Placeholder scan:** `<test file>` / `<a test file>` — the implementer picks the appropriate existing spineless test file (Task 2 Step 7 / Step 1 reading). Not a TBD — a deliberate "use the right existing file" instruction. Task 3 Step 9 message content filled from measurement. No "TODO".

**Type/name consistency:** `FoldedInput` (`kind: 'field' | 'const'`), `foldMinMax`, `foldMargin`, `readFolded` — defined in Task 2, used consistently. `nodeSig` extension (Task 1) and the fold predicates (Task 2) must use the *same* default sentinels — the spec calls this out; Task 1 Step 2 and Task 2 Step 2 both say "match `style.ts`'s exact defaults". This is the one cross-task consistency hazard — flagged explicitly.

No gaps.
