# Phase 16 — Linear-recurrence main-axis positions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` for tracking.

**Goal:** Replace the O(N) cumulative-sum `mainPos` grammar rule with an O(1) linear recurrence. Take `hot-structural` from ~250µs (2.4× Yoga loss) to ~28-35µs (3-4× Yoga win) → clean 9/9.

**Architecture:** `mainPos[N] = mainPos[N-1] + mainSize[N-1] + marginEnd[N-1] + myMarginStart[N] + gap`. Each position field gets 5 deps instead of O(N). Mid-list structural mutation rebinds exactly one successor instead of O(N).

**Tech Stack:** TypeScript NodeNext ESM. Vitest. The structural-differential fuzzer (numRuns=300, then 3000) + `pnpm test:differential` + the Yoga oracle are the controlling correctness gates.

---

## File Structure

```
packages/core/src/algorithm/spineless/flex-grammar.ts   MODIFY — cumulative-sum mainPos rule → linear recurrence; fragment-builder successor-rebind
bench/RESULTS.md                                        REGEN
bench/thresholds.json                                   UPDATE — hotstructural threshold
```

---

### Task 1: Replace the cumulative-sum `mainPos` rule with a linear recurrence

**File:** `packages/core/src/algorithm/spineless/flex-grammar.ts`

The target is the `else` block at `flex-grammar.ts:1107-1131` — the `justify === 'flex-start'`, non-first-child (`indexInParent > 0`), non-`mainDistribution` regime. (The first-child base case at 1073-1076 — `padMainStart + myMarginStart` — is already the O(1) recurrence base; leave it.)

- [ ] **Step 1: Read the surrounding context**

Read `flex-grammar.ts` lines ~560-660 (the `visit` function signature + where `mainSizeName`, `mainPosField`, `parentDirection`, `myMarginMainStartF`, `padMainStartF` are bound) and 1044-1142 (the full main-pos emission). Confirm:
- The name of the main-SIZE field variable (`mainSizeName`) and whether a main-POS field NAME variable exists. If only `mainSizeName` exists, the main-pos field name is derived the same way — `parentDirection === 'column' ? 'top' : 'left'`. Bind a `mainPosName` const alongside `mainSizeName`.
- `mainEndEdge`, `marginInput`, `gapInput`, `field` are in scope (they are — the current cumulative block uses them).
- `priorSiblings` is the in-flow predecessors array.

- [ ] **Step 2: Replace lines 1107-1131**

Replace the cumulative-sum `else` block:

```ts
      } else {
        // Non-qualifying regime (wrap): keep today's prior-siblings-sum
        // rule ...
        const priorMainSizes = priorSiblings.map((s) => field<number>(s, mainSizeName));
        ... O(N) cumulative sum ...
      }
```

with the linear recurrence:

```ts
      } else {
        // Phase 16: linear recurrence. This child's main position is the
        // immediate predecessor's position + its box + one gap. O(1) deps
        // regardless of sibling count (was O(N) cumulative-sum). Unrolls
        // to the same total — see the Phase 16 design doc.
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

(`mainPosName` is the const from Step 1. If the existing code already has a main-pos field-name variable, use it; do not introduce a duplicate.)

- [ ] **Step 3: Run the Yoga oracle — positional ground truth**

Run: `pnpm --filter @pilates/core test -- yoga-oracle`
Expected: 33 fixtures pass. The oracle asserts absolute positions against Yoga's reference output — a wrong recurrence formula fails here immediately.

- [ ] **Step 4: Run differential mode — every layout, cached vs cold, byte-identical**

Run: `pnpm test:differential`
Expected: 830 / 6 skipped. This is the primary positional-correctness gate. If it fails, the recurrence formula is wrong — re-derive against the design doc's unrolling.

- [ ] **Step 5: Run the structural-differential fuzzer**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Expected: green at numRuns=300. The fuzzer does random insert/remove/move — if the fragment builders mis-handle the recurrence's successor dependency, this diverges. (Task 2 may be needed before this is fully green — see Task 2 Step 1.)

- [ ] **Step 6: Run the full core suite**

Run: `pnpm --filter @pilates/core test`
Expected: 1466 pass.

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 8: If Steps 3-6 all pass, commit. If the structural fuzzer fails, do Task 2 first, then commit both together.**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts
git commit -m "$(cat <<'EOF'
phase 16: linear-recurrence main-axis positions

A flex child's main-axis position was encoded as a cumulative sum
over ALL prior siblings — the 101st row's `top` field carried 303
dependencies. Appending a row meant integrating an O(N)-edge field;
the fresh profile attributed ~150µs of hot-structural's ~250µs to
this single rule.

Replaced with a linear recurrence: mainPos[N] = mainPos[N-1] +
mainSize[N-1] + marginEnd[N-1] + myMarginStart[N] + gap. Every
position field now has 5 deps regardless of sibling count — O(1).
Structural mutation at the list end needs zero rebinds; mid-list
needs one.

The recurrence unrolls to exactly the old cumulative sum (verified
against the Yoga oracle's 33 absolute-position fixtures + the
byte-identical differential mode). It is strictly better: O(1)
graft AND O(N) value-mutation recompute (the cumulative form was
O(N^2) for a mid-list main-size change).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Fragment-builder successor-rebind for mid-list structural mutation

**File:** `packages/core/src/algorithm/spineless/flex-grammar.ts` (`buildAppendFragment`, `buildRemoveFragment`)

The recurrence chains each position field to its predecessor. End-of-list append/remove (the `hot-structural` bench) needs **zero** rebinds. Mid-list insert/remove needs the **immediate successor's** `mainPos` rule rebound to its new predecessor.

- [ ] **Step 1: Determine whether this task is needed**

After Task 1, run the structural fuzzer (`pnpm --filter @pilates/core test -- spineless-structural.fuzz` at numRuns=300):
- **If it is GREEN**, the current `buildAppendFragment`/`buildRemoveFragment` already handle mid-list correctly (likely via a full-rebuild fallback for non-end mutations). Task 2's O(1) refinement is then OPTIONAL — the bench (end-append) already has its win. Skip to Task 3, note Task 2 deferred.
- **If it FAILS** on a mid-list seed, Task 2 is required — proceed.

- [ ] **Step 2: Read `buildAppendFragment` + `buildRemoveFragment`**

Find how each currently handles a structural mutation that is NOT at the list end. Locate the `rebinds: [Field, FieldRule][]` mechanism. Understand: when a child is inserted/removed mid-list, which existing fields' rules become stale.

With the recurrence, exactly one field goes stale: the immediate successor's `mainPos`. Before: it read predecessor P. After an insert of new child C between P and it: it must read C. After a remove of its predecessor R: it must read R's predecessor.

- [ ] **Step 3: Emit the successor-rebind**

In `buildAppendFragment`: if the insert index is not the last position, the child formerly at that index (now shifted to index+1) needs its `mainPos` rule re-emitted with the newly-inserted child as `prevSibling`. Add `[successorMainPosField, newRecurrenceRule]` to the fragment's `rebinds`.

In `buildRemoveFragment`: if the removed child is not last, the child formerly after it needs its `mainPos` rule re-emitted with the removed child's predecessor as `prevSibling`. Add the rebind.

The re-emitted rule is the exact recurrence rule shape from Task 1 Step 2 — factor that rule construction into a small helper (`emitRecurrenceMainPos(...)` or inline) so Task 1's grammar code and Task 2's rebind share one implementation.

- [ ] **Step 4: Structural fuzzer — numRuns 300**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Expected: green. If a seed fails, pin it deterministically, debug, fix, unpin.

- [ ] **Step 5: Differential + full suite + typecheck + lint**

Run: `pnpm test:differential` (830/6), `pnpm --filter @pilates/core test` (1466), `pnpm typecheck && pnpm lint`.
Expected: all green.

- [ ] **Step 6: Commit** (or fold into Task 1's commit if done together)

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts
git commit -m "$(cat <<'EOF'
phase 16: O(1) successor-rebind for mid-list structural mutation

The linear-recurrence position chain means a mid-list insert/remove
invalidates exactly ONE field — the immediate successor's mainPos.
buildAppendFragment / buildRemoveFragment now emit that single
successor-rebind instead of falling back to an O(N) re-sum / full
rebuild. End-of-list mutations need zero rebinds.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Validation sweep + bench + thresholds

- [ ] **Step 1: Lint + typecheck** — `pnpm lint && pnpm typecheck` — clean.

- [ ] **Step 2: Full workspace test** — `pnpm test` — 1466 pass.

- [ ] **Step 3: Differential mode ×3** — `pnpm test:differential` three times — 830 / 6 skipped each.

- [ ] **Step 4: Structural-differential fuzzer — numRuns 300, then once at 3000**

Run at default (300): `pnpm --filter @pilates/core test -- spineless-structural.fuzz`.
Then once at 3000 (set the numRuns env/param the fuzzer supports — check the test file for how numRuns is configured) to bank extra confidence on a grammar-core change.
Expected: green both.

- [ ] **Step 5: Yoga oracle** — `pnpm --filter @pilates/core test -- yoga-oracle` — 33 pass.

- [ ] **Step 6: Bench**

Run: `pnpm bench`
Inspect `hot-structural` `@pilates/core (layout)`. Expectation: a large drop — toward ~30-50µs (the profiler's floor was ~28µs; allow for bench machine state). Compare ALL 9 scenarios to pre-16 — **no scenario may regress**; the 8 existing wins must hold.

If `hot-structural` does NOT drop dramatically (still >100µs), STOP — the recurrence didn't take effect on the bench path; investigate (is hot-structural's parent actually hitting the `justify==='flex-start'` non-distribution branch? confirm with a trace).

- [ ] **Step 7: Update `bench/thresholds.json`**

Set the `hotstructural` `@pilates/core (layout)` `win32-x64` entry to the new range (run `pnpm bench` 2-3× or `bench:variance` for a stable median; `expectedMedianUs` ≈ observed median, `ci95Us` widened per the existing calibration convention).

- [ ] **Step 8: Run `pnpm bench:budgets`** — expect "all bench budgets within threshold".

- [ ] **Step 9: Commit**

```bash
git add bench/RESULTS.md bench/thresholds.json
git commit -m "$(cat <<'EOF'
bench: refresh RESULTS.md post phase 16 — clean 9/9 vs Yoga

Linear-recurrence positions collapse hot-structural's O(N) graft:
- hot-structural: ~250µs -> [ACTUAL]µs  ([ACTUAL]x Yoga WIN)

Pilates now beats Yoga on all 9 benchmarked workloads, in pure
TypeScript — several by 3-9x. The "TypeScript beats C++" result
is complete.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Fill `[ACTUAL]` from the measurement.)

---

## Self-Review

**Spec coverage:**
- Cumulative-sum → recurrence: Task 1. ✓
- First-child base case left intact: Task 1 Step 1 note. ✓
- Fragment-builder successor-rebind: Task 2 (with a "needed?" gate at Step 1). ✓
- Yoga oracle + differential + structural fuzzer as gates: Tasks 1, 2, 3. ✓
- Fuzzer at 3000 once for the grammar-core change: Task 3 Step 4. ✓
- No-regression check on all 9: Task 3 Step 6. ✓
- thresholds.json update: Task 3 Step 7. ✓

**Placeholder scan:**
- Task 3 Step 9 `[ACTUAL]` — filled from measurement.
- Task 2 Step 1 is a genuine conditional gate (is the task needed?), not a placeholder.
- Task 1 Step 8 conditionally defers commit to Task 2 — intentional sequencing, not a gap.
- No "TODO" / "implement later".

**Type / name consistency:**
- `mainPosName` — introduced in Task 1 Step 1 (or reuse an existing main-pos-name var), used in Task 1 Step 2 + Task 2 Step 3's shared rule helper.
- `prevSibling`, `prevMainPos`, `prevMainSize`, `prevMarginEnd`, `mainGapInput` — local to the recurrence rule; the same 5-dep shape is reused by Task 2's rebind via a shared helper.
- The recurrence rule construction is factored into one helper (Task 2 Step 3) so Task 1's emission and Task 2's rebind cannot drift.

No gaps. The controlling correctness gate (structural-differential fuzzer) is run after Task 1, after Task 2, and at 3000 in Task 3 — three independent checkpoints on the engine's most-sensitive change.
