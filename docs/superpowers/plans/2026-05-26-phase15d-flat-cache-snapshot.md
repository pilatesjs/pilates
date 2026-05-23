# Phase 15D — Flat cache snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` for tracking.

**Goal:** Replace `LayoutCacheValue.childLayouts: CachedChildLayout[]` (array of 8-field objects) with a flat `childData: Float64Array` (stride 8). Eliminate per-child object allocation in `snapshotForCache`. Projected: `huge` 11.92ms → ~10.3ms (~2× Yoga).

**Architecture:** `snapshotForCache` writes 8 floats per child into one contiguous `Float64Array`; leaf nodes share a module-level empty array. `restoreFromCache` reads by stride. Output byte-identical — validated by differential mode.

**Tech Stack:** TypeScript NodeNext ESM. Vitest. Float64Array. The controlling correctness gate is `pnpm test:differential`.

---

## File Structure

```
packages/core/src/algorithm/cache.ts            MODIFY — LayoutCacheValue, snapshotForCache, restoreFromCache; delete CachedChildLayout
packages/core/src/algorithm/*.test.ts           MODIFY — any test referencing childLayouts / CachedChildLayout
bench/RESULTS.md                                REGEN  — confirms huge improvement
```

---

### Task 1: Flat `Float64Array` cache snapshot

**Files:**
- Modify: `packages/core/src/algorithm/cache.ts`

Replace the object-array storage with a flat typed array. This is the entire perf change.

- [ ] **Step 1: Inventory `childLayouts` + `CachedChildLayout` consumers**

Run:
```
grep -rn "childLayouts\|CachedChildLayout" packages/
```

Catalogue every reference. Expected: `cache.ts` (definition + snapshotForCache + restoreFromCache), possibly test files. Each must be updated in this task.

- [ ] **Step 2: Add stride constants + delete `CachedChildLayout`**

In `cache.ts`, near the top of the cache-related declarations:

```ts
/** Number of Float64 slots per child in a `LayoutCacheValue.childData` array. */
const CHILD_STRIDE = 8;

/** Shared empty child-data array for leaf nodes — avoids per-leaf allocation. */
const EMPTY_CHILD_DATA = new Float64Array(0);
```

Delete the `CachedChildLayout` interface entirely (lines 138-156 region).

- [ ] **Step 3: Update `LayoutCacheValue`**

```ts
/** @internal */
export interface LayoutCacheValue {
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
  /**
   * Flat child-layout data — `CHILD_STRIDE` (8) floats per direct child:
   * [left, top, width, height, scrollWidth, scrollHeight, floatLeft, floatTop].
   * Leaf nodes share the module-level `EMPTY_CHILD_DATA`.
   */
  childData: Float64Array;
  /** Number of direct children captured. `childData.length === childCount * CHILD_STRIDE`. */
  childCount: number;
}
```

- [ ] **Step 4: Rewrite `snapshotForCache`**

```ts
export function snapshotForCache(node: Node): LayoutCacheValue {
  const count = node.getChildCount();
  const childData = count === 0 ? EMPTY_CHILD_DATA : new Float64Array(count * CHILD_STRIDE);
  for (let i = 0; i < count; i++) {
    const c = node.getChild(i)!;
    const base = i * CHILD_STRIDE;
    childData[base] = c.layout.left;
    childData[base + 1] = c.layout.top;
    childData[base + 2] = c.layout.width;
    childData[base + 3] = c.layout.height;
    childData[base + 4] = c.layout.scrollWidth;
    childData[base + 5] = c.layout.scrollHeight;
    childData[base + 6] = c._floatLeft;
    childData[base + 7] = c._floatTop;
  }
  return {
    width: node.layout.width,
    height: node.layout.height,
    scrollWidth: node.layout.scrollWidth,
    scrollHeight: node.layout.scrollHeight,
    childData,
    childCount: count,
  };
}
```

Preserve the existing JSDoc comment block above `snapshotForCache` (update any mention of `childLayouts` to `childData`).

- [ ] **Step 5: Rewrite `restoreFromCache`**

```ts
export function restoreFromCache(node: Node, value: LayoutCacheValue): void {
  if (process.env.PILATES_DIFFERENTIAL_LAYOUT === '1') {
    if (node.getChildCount() !== value.childCount) {
      throw new Error(
        `[pilates layout cache] restored value has ${value.childCount} children but node has ${node.getChildCount()} — cache invalidation bug`,
      );
    }
  }
  node._layout.width = value.width;
  node._layout.height = value.height;
  node._layout.scrollWidth = value.scrollWidth;
  node._layout.scrollHeight = value.scrollHeight;
  // node._layout.left/top are set by the caller before recursion starts.
  const cd = value.childData;
  const count = node.getChildCount();
  for (let i = 0; i < count; i++) {
    const c = node.getChild(i)!;
    const base = i * CHILD_STRIDE;
    c._layout.left = cd[base]!;
    c._layout.top = cd[base + 1]!;
    c._layout.width = cd[base + 2]!;
    c._layout.height = cd[base + 3]!;
    c._layout.scrollWidth = cd[base + 4]!;
    c._layout.scrollHeight = cd[base + 5]!;
    c._floatLeft = cd[base + 6]!;
    c._floatTop = cd[base + 7]!;
  }
}
```

Preserve the existing JSDoc above `restoreFromCache` (update `childLayouts` references).

- [ ] **Step 6: Update any other consumers found in Step 1**

If test files reference `childLayouts` or `CachedChildLayout`, update them to `childData` / `childCount`. A test that previously did `value.childLayouts[0].width` becomes `value.childData[2]` (offset 2 = width for child 0). A test checking `value.childLayouts.length` becomes `value.childCount`.

- [ ] **Step 7: Run cache tests**

Run: `pnpm --filter @pilates/core test -- cache`
Expected: all cache-related tests pass (cache.invariants.test.ts and any others).

- [ ] **Step 8: Run differential mode — the controlling gate**

Run: `pnpm test:differential`
Expected: 820 passed / 6 skipped. `restoreFromCache` runs on every cache-hit layout; any stride bug surfaces here as a divergence with the exact diff.

- [ ] **Step 9: Run full core suite**

Run: `pnpm --filter @pilates/core test`
Expected: 1456 tests pass (count unchanged unless test files gained/lost assertions).

- [ ] **Step 10: Run structural fuzzer**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Expected: green at numRuns=300.

- [ ] **Step 11: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. Deleting `CachedChildLayout` surfaces any missed external consumer.

- [ ] **Step 12: Commit**

```bash
git add packages/core/src/algorithm/cache.ts
# plus any test files updated in Step 6
git commit -m "$(cat <<'EOF'
phase 15D: flat Float64Array cache snapshots

snapshotForCache previously allocated one childLayouts[] array plus
one 8-field CachedChildLayout object per direct child per call. On
huge (10,101 nodes) a cold build allocated ~30k heap objects here —
profiled at 54% of total runtime.

Replaced with a flat Float64Array (CHILD_STRIDE=8 floats per child).
Leaf nodes share a module-level EMPTY_CHILD_DATA. CachedChildLayout
interface deleted; LayoutCacheValue.childLayouts → childData +
childCount.

restoreFromCache reads by stride; output byte-identical (validated
by pnpm test:differential). No algorithm or traversal change —
purely swapping the storage container.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Validation sweep + bench

**Files:** `bench/RESULTS.md` (regenerated).

- [ ] **Step 1: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 2: Full workspace test**

Run: `pnpm test`
Expected: 1456 pass.

- [ ] **Step 3: Differential mode ×3**

Run: `pnpm test:differential` three times.
Expected: 820 / 6 skipped each run. No flake.

- [ ] **Step 4: Structural fuzzer + Yoga oracle**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Run: `pnpm --filter @pilates/core test -- yoga-oracle`
Expected: both green.

- [ ] **Step 5: Bench**

Run: `pnpm bench`
Expected: writes `bench/RESULTS.md` + history JSON.

Compare `@pilates/core (layout)` rows to pre-15D (commit `42430c8`):
- Pre-15D: `tiny 5.1µs / realistic 138.2µs / stress 700µs / big 4.31ms / huge 11.92ms / hot-relayout 21.3µs / hot-relayoutboundary 21.2µs / hot-relayouttext 21.4µs / hot-structural 377µs`.
- Target post-15D: `huge ≥ 12% faster (~10.3ms)`, `big ~3.8ms`, `stress ~640µs`, `realistic ~130µs`. Hot-* within variance.

If `huge` does NOT improve by ≥ 10%, investigate — the `snapshotForCache` refactor may not be capturing the projected win, OR `snapshotForCache` isn't called as often as the Phase 15A profile suggested. Re-profile if needed.

- [ ] **Step 6: Commit `bench/RESULTS.md`**

```bash
git add bench/RESULTS.md
git commit -m "$(cat <<'EOF'
bench: refresh RESULTS.md post phase 15D

Flat Float64Array cache snapshots eliminate per-child object
allocation in snapshotForCache:
- [actual numbers from inspection]

huge crosses the 2× Yoga decisive-win bar — it was the weakest
scenario (1.5× pre-Phase-15).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Replace `[actual numbers from inspection]` with the real before/after comparison table.)

---

## Self-Review

**Spec coverage:**
- `CachedChildLayout` deleted: Task 1 Step 2. ✓
- `LayoutCacheValue.childData` + `childCount`: Task 1 Step 3. ✓
- `snapshotForCache` flat rewrite + shared empty: Task 1 Step 4. ✓
- `restoreFromCache` stride read: Task 1 Step 5. ✓
- Consumer updates: Task 1 Step 1 (inventory) + Step 6 (update). ✓
- Differential validation: Task 1 Step 8, Task 2 Step 3. ✓
- Bench confirms huge improvement: Task 2 Step 5. ✓

**Placeholder scan:**
- Task 2 Step 6 has `[actual numbers from inspection]` — implementer fills from measurement.
- No "TBD" / "TODO".

**Type / name consistency:**
- `CHILD_STRIDE`, `EMPTY_CHILD_DATA`, `childData`, `childCount` — consistent across the interface, both functions, and any test updates.
- Stride offsets (0-7) consistent between `snapshotForCache` writes and `restoreFromCache` reads — both use `base = i * CHILD_STRIDE` with the same 0-7 field order: left, top, width, height, scrollWidth, scrollHeight, floatLeft, floatTop.

No gaps. The write order in Step 4 and read order in Step 5 MUST match exactly — verified: both are left(0), top(1), width(2), height(3), scrollWidth(4), scrollHeight(5), floatLeft(6), floatTop(7).
