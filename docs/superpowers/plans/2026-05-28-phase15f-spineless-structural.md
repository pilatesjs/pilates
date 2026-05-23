# Phase 15F — Spineless structural optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` for tracking.

**Goal:** Cut `hot-structural` ~400µs → ~200-250µs via (1) incremental `lastOm` tracking in `runtime.detach` (eliminates a ~172µs O(N) scan) and (2) in-place fragment-build mutation (eliminates ~50µs of Map copy-on-write).

**Architecture:** The OM structure is a doubly-linked list; `detach` can find the new tail by walking removed nodes' predecessors instead of scanning all `omNodes`. The fragment builders' `prev` output is single-use — mutating it in place is safe.

**Tech Stack:** TypeScript NodeNext ESM. Vitest. The structural-differential fuzzer (numRuns=300) is the controlling correctness gate.

---

## File Structure

```
packages/core/src/algorithm/spineless/order-maintenance.ts   MODIFY — add predecessor() to interface + Bender + Naive
packages/core/src/algorithm/spineless/runtime.ts             MODIFY — detach: incremental lastOm
packages/core/src/algorithm/spineless/flex-grammar.ts        MODIFY — mergeStyleInputsMap mutateBase; buildRemoveFragment in-place
bench/RESULTS.md                                             REGEN
```

---

### Task 1: `predecessor()` + incremental `lastOm` in `detach`

**Files:**
- Modify: `packages/core/src/algorithm/spineless/order-maintenance.ts`
- Modify: `packages/core/src/algorithm/spineless/runtime.ts`

- [ ] **Step 1: Add `predecessor()` to the `OrderMaintenance` interface**

In `order-maintenance.ts`, the `OrderMaintenance` interface is at line 65 with `init` / `insertAfter` / `delete` / `compare`. Add:

```ts
  /**
   * Return the node immediately before `node` in the order, or `null`
   * if `node` is the first. O(1). Used by the runtime to find the new
   * order tail after the current tail is deleted, without an O(N)
   * scan of all live nodes.
   */
  predecessor(node: OMNode): OMNode | null;
```

- [ ] **Step 2: Implement `predecessor()` in both classes**

`NaiveOrderMaintenance` (class at line 141) — `NaiveNode` has `prev: NaiveNode | null`:

```ts
  predecessor(node: OMNode): OMNode | null {
    return (node as NaiveNode).prev;
  }
```

`BenderOrderMaintenance` (class at line 257) — `BenderNode` has `prev: BenderNode | null`:

```ts
  predecessor(node: OMNode): OMNode | null {
    return (node as BenderNode).prev;
  }
```

Place each near the existing `delete` method, following the file's method ordering.

- [ ] **Step 3: Write a failing test for `predecessor()`**

Add to the order-maintenance test file (find it — likely `order-maintenance.test.ts`):

```ts
test('predecessor returns the node before, or null for the first', () => {
  const om = new BenderOrderMaintenance();
  const a = om.init();
  const b = om.insertAfter(a);
  const c = om.insertAfter(b);
  expect(om.predecessor(a)).toBe(null);
  expect(om.predecessor(b)).toBe(a);
  expect(om.predecessor(c)).toBe(b);
});

test('predecessor after delete skips the removed node', () => {
  const om = new BenderOrderMaintenance();
  const a = om.init();
  const b = om.insertAfter(a);
  const c = om.insertAfter(b);
  om.delete(b);
  // c's predecessor is now a (delete repairs the prev/next links)
  expect(om.predecessor(c)).toBe(a);
});
```

If the test file tests both implementations in a shared/parameterized way, add the `predecessor` cases there so both Bender + Naive are covered.

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm --filter @pilates/core test -- order-maintenance`
Expected: new tests pass (the implementations are trivial pointer reads).

- [ ] **Step 5: Rewrite `detach`'s `lastOm` recomputation**

In `runtime.ts`, the `detach` method currently ends (lines 264-271) with:

```ts
    // The OM tail may have been among the removed fields; recompute
    // it so a later `graft` still appends after every surviving node.
    this.lastOm = null;
    for (const omNode of this.omNodes.values()) {
      if (this.lastOm === null || this.om.compare(omNode, this.lastOm) > 0) {
        this.lastOm = omNode;
      }
    }
```

The `drop` closure (lines 228-235) deletes OM nodes. Collect the removed OM nodes into a `Set` so the tail-recompute can check membership:

In `drop`, after `this.om.delete(omNode)`:
```ts
    const removedOmNodes = new Set<OMNode>();
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

Then replace the O(N) scan with an incremental predecessor-walk:

```ts
    // The OM tail may have been among the removed fields. If so, walk
    // back through predecessors (skipping just-removed nodes) to find
    // the new tail — O(removed) instead of O(total live nodes).
    if (this.lastOm !== null && removedOmNodes.has(this.lastOm)) {
      let candidate: OMNode | null = this.lastOm;
      while (candidate !== null && removedOmNodes.has(candidate)) {
        candidate = this.om.predecessor(candidate);
      }
      this.lastOm = candidate;
    }
```

Reasoning: `om.delete()` already repairs `prev`/`next` links — but a deleted node's OWN `prev` pointer still points at its (possibly also-deleted) predecessor. Walking `predecessor` from the old `lastOm` and skipping nodes in `removedOmNodes` lands on the first surviving node before the removed tail block. For the bench case (remove the last row, a contiguous tail block), this walks just the removed block — O(removed).

**Edge case:** if ALL nodes were removed, the walk ends at `null` → `lastOm = null`, matching the old scan's behavior for an empty runtime. If `lastOm` was NOT removed, the `if` is skipped — `lastOm` unchanged, correct.

**Important:** verify `OMNode` is imported/in-scope in `runtime.ts`. If `Set<OMNode>` needs the type, ensure the import exists (it likely does — `runtime.ts` already references OM nodes).

- [ ] **Step 6: Run the structural-differential fuzzer — controlling gate**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Expected: green at numRuns=300. This fuzzer does random insert/remove/move sequences and asserts cold-rebuild equivalence — a wrong `lastOm` makes the next graft insert at the wrong order position, producing a divergence. If a seed fails, pin it deterministically, debug, fix, then unpin (per project convention).

- [ ] **Step 7: Run the full core suite + differential mode**

Run: `pnpm --filter @pilates/core test`
Run: `pnpm test:differential`
Expected: 1456 + new OM tests pass; differential 820 / 6 skipped.

- [ ] **Step 8: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/algorithm/spineless/order-maintenance.ts packages/core/src/algorithm/spineless/runtime.ts
# plus the order-maintenance test file
git commit -m "$(cat <<'EOF'
phase 15F: incremental lastOm tracking in runtime.detach

detach previously recomputed the OM tail (lastOm) by scanning all
omNodes.values() — O(total live nodes), ~172µs for a 1,100-node
runtime on hot-structural.

Added OrderMaintenance.predecessor(node) — an O(1) prev-pointer
read, implemented in both Bender and Naive (both already have a
doubly-linked prev). detach now collects removed OM nodes into a
Set and, only if lastOm was among them, walks predecessors past
the removed block to the new tail — O(removed), O(1) for the
common tail-removal case.

The structural-differential fuzzer (numRuns=300) validates: a
wrong lastOm misplaces the next graft and diverges from cold
rebuild.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: In-place fragment-build mutation

**Files:**
- Modify: `packages/core/src/algorithm/spineless/flex-grammar.ts`

`prev` (the previous `FlexGrammarOutput`) is single-use: `layout.ts` swaps `built.output = fragment.next` immediately after the builder returns, orphaning `prev.styleInputs` / `prev.allFields`. Mutating them in place in the simple-regime path is safe.

- [ ] **Step 1: Add `mutateBase` to `mergeStyleInputsMap`**

`mergeStyleInputsMap` is at `flex-grammar.ts:1365`. Current:

```ts
function mergeStyleInputsMap(
  base: Map<Node, StyleInputs>,
  extra: Map<Node, StyleInputs>,
): Map<Node, StyleInputs> {
  const merged = new Map(base);
  for (const [node, entry] of extra) {
    const existing = merged.get(node);
    merged.set(node, existing === undefined ? entry : mergeStyleInputs(existing, entry));
  }
  return merged;
}
```

Change to:

```ts
function mergeStyleInputsMap(
  base: Map<Node, StyleInputs>,
  extra: Map<Node, StyleInputs>,
  mutateBase: boolean,
): Map<Node, StyleInputs> {
  // When mutateBase is true the caller owns `base` exclusively (it is
  // the previous grammar output, swapped out by the caller right after
  // this returns) — mutate it directly and skip the ~1,100-entry clone.
  const merged = mutateBase ? base : new Map(base);
  for (const [node, entry] of extra) {
    const existing = merged.get(node);
    merged.set(node, existing === undefined ? entry : mergeStyleInputs(existing, entry));
  }
  return merged;
}
```

- [ ] **Step 2: Update `mergeStyleInputsMap` call sites**

Grep: `grep -n "mergeStyleInputsMap" packages/core/src/algorithm/spineless/flex-grammar.ts`

The simple-regime `buildAppendFragment` caller (~line 1484) passes `mutateBase: true`. Any other caller (full rebuild path) passes `false`. The implementer reads each call site and determines: does this caller own `prev` exclusively? The `buildAppendFragment` simple path does (confirmed by exploration). If unsure for a given call site, pass `false` (safe default — preserves clone behavior).

- [ ] **Step 3: `buildRemoveFragment` in-place delete**

`buildRemoveFragment`'s simple path is around `flex-grammar.ts:1706-1710`:

```ts
allFields: prev.allFields.filter((e) => !removedNodes.has(e.node)),
styleInputs: new Map([...prev.styleInputs].filter(([n]) => !removedNodes.has(n))),
mainDistributionByParent: new Map(
  [...prev.mainDistributionByParent].filter(([n]) => !removedNodes.has(n)),
),
```

Replace the `styleInputs` + `mainDistributionByParent` spreads with in-place deletes. Before constructing the `next` output object:

```ts
  for (const n of removedNodes) {
    prev.styleInputs.delete(n);
    prev.mainDistributionByParent.delete(n);
  }
```

Then use `prev.styleInputs` and `prev.mainDistributionByParent` directly as `next`'s fields:

```ts
styleInputs: prev.styleInputs,
mainDistributionByParent: prev.mainDistributionByParent,
```

For `allFields`: `prev.allFields.filter((e) => !removedNodes.has(e.node))` is O(total) but the filter produces a fresh array. Keep it as-is OR assign back (`prev.allFields = prev.allFields.filter(...)`) — the styleInputs spread was the measured ~48µs cost; `allFields` filter is smaller. The implementer's call: if trivial, also convert; if it complicates the code, leave it. The styleInputs + mainDistribution in-place delete is the required change.

- [ ] **Step 4: Run the structural-differential fuzzer**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Expected: green at numRuns=300. In-place mutation of a wrongly-shared map would corrupt a later layout and diverge.

- [ ] **Step 5: Run differential mode + full core suite**

Run: `pnpm test:differential`
Run: `pnpm --filter @pilates/core test`
Expected: 820 / 6 skipped; 1456+ pass.

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts
git commit -m "$(cat <<'EOF'
phase 15F: in-place fragment-build mutation

mergeStyleInputsMap cloned the full ~1,100-entry styleInputs Map
on every buildAppendFragment call (~48µs). buildRemoveFragment
spread + filtered the same Map. The previous grammar output
(`prev`) is single-use — the caller swaps built.output to the new
fragment immediately after the builder returns — so mutating
prev.styleInputs / prev.mainDistributionByParent in place is safe.

mergeStyleInputsMap gains a mutateBase flag (simple-regime append
passes true). buildRemoveFragment deletes removed nodes from the
prev maps directly instead of spread-filter-reconstruct.

Structural-differential fuzzer (numRuns=300) validates no shared-
state corruption.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Validation sweep + bench

**Files:** `bench/RESULTS.md` (regenerated).

- [ ] **Step 1: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck` — clean.

- [ ] **Step 2: Full workspace test**

Run: `pnpm test` — 1456+ pass.

- [ ] **Step 3: Differential mode ×3**

Run: `pnpm test:differential` three times — 820 / 6 skipped each.

- [ ] **Step 4: Structural-differential fuzzer at numRuns=300**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz` — green. The controlling gate for Phase 15F.

- [ ] **Step 5: Yoga oracle**

Run: `pnpm --filter @pilates/core test -- yoga-oracle` — 33 pass.

- [ ] **Step 6: Bench**

Run: `pnpm bench`
Compare `hot-structural` `@pilates/core (layout)` to pre-15F (commit `8ba656f`: ~478µs, noting that scenario's ±100µs variance — earlier runs saw 377-478µs, call the baseline ~400µs).
Target: `hot-structural` ≥ 35% faster than its ~400µs baseline → ~250µs or better. No other scenario regresses.

If `hot-structural` does NOT improve ≥ 25%, investigate: confirm the bench's hot-structural actually exercises `detach` (it alternates append/remove, so it should) and that the lastOm fix is on the hot path.

- [ ] **Step 7: Commit `bench/RESULTS.md`**

```bash
git add bench/RESULTS.md
git commit -m "$(cat <<'EOF'
bench: refresh RESULTS.md post phase 15F

Spineless structural optimization (incremental lastOm + in-place
fragment-build mutation):
- [actual hot-structural before/after numbers]

hot-structural's Yoga gap roughly halved. Phases 15G/H continue
toward parity.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Replace `[actual ...]` with real measurements.)

---

## Self-Review

**Spec coverage:**
- `predecessor()` interface + 2 impls: Task 1 Steps 1-2. ✓
- Incremental `lastOm` in `detach`: Task 1 Step 5. ✓
- `mergeStyleInputsMap` mutateBase: Task 2 Steps 1-2. ✓
- `buildRemoveFragment` in-place: Task 2 Step 3. ✓
- Structural fuzzer as controlling gate: Task 1 Step 6, Task 2 Step 4, Task 3 Step 4. ✓
- Bench confirms hot-structural improvement: Task 3 Step 6. ✓

**Placeholder scan:**
- Task 2 Step 2/3 say "the implementer's call" / "if unsure pass false" — acceptable: the safe default is explicit, and the exploration already confirmed the simple-append path. Not a TBD.
- Task 3 Step 7 `[actual ...]` — filled from measurement.
- No "TODO" / "implement later".

**Type / name consistency:**
- `predecessor` — interface method + 2 impls, same signature `(node: OMNode) => OMNode | null`.
- `mutateBase: boolean` — `mergeStyleInputsMap` param, consistent.
- `removedOmNodes: Set<OMNode>` — Task 1 Step 5, consistent within `detach`.

No gaps. The `drop` closure modification (Task 1 Step 5) and the tail-recompute replacement are in the same method — the implementer applies both in `detach`.
