# Phase 15C — Node indexing + LayoutPool foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` for tracking.

**Goal:** Ship `Node._id` integer indexing + `LayoutPool` module + `roundLayout` refactored to use `Pool.absCornersX/Y` instead of `Map<Node, AbsCorner>`. ~18µs improvement on `roundLayout`-heavy scenarios.

**Architecture:** New `layout-pool.ts` module manages `Float64Array`s indexed by `Node._id`. IDs allocated at Node construction, recycled via `FinalizationRegistry`. `roundLayout` reads/writes via the pool instead of a Map.

**Tech Stack:** TypeScript NodeNext ESM. Vitest. `FinalizationRegistry` (Node ≥ 14). Float64Array.

---

## File Structure

```
packages/core/src/layout-pool.ts                     NEW    — LayoutPool + allocateNodeId
packages/core/src/layout-pool.test.ts                NEW    — pool sanity + ID recycling
packages/core/src/node.ts                            MODIFY — add _id field + import
packages/core/src/algorithm/round.ts                 MODIFY — Map → Pool typed arrays
bench/RESULTS.md                                     REGEN  — confirms ~18µs improvement
```

---

### Task 1: `LayoutPool` module + tests

**Files:**
- Create: `packages/core/src/layout-pool.ts`
- Create: `packages/core/src/layout-pool.test.ts`

Pure module: `Pool` object + `allocateNodeId(node)` + `_resetPoolForTesting()`. Float64Arrays for `absCornersX` and `absCornersY`. Growth on demand. FinalizationRegistry-based ID recycling.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/layout-pool.test.ts`:

```ts
import { describe, expect, test, beforeEach } from 'vitest';
import { Pool, _poolStats, _resetPoolForTesting, allocateNodeId } from './layout-pool.js';

describe('LayoutPool', () => {
  beforeEach(() => {
    _resetPoolForTesting();
  });

  test('allocateNodeId returns sequential IDs starting at 0', () => {
    const obj1 = {};
    const obj2 = {};
    const obj3 = {};
    expect(allocateNodeId(obj1)).toBe(0);
    expect(allocateNodeId(obj2)).toBe(1);
    expect(allocateNodeId(obj3)).toBe(2);
  });

  test('Pool exposes absCornersX and absCornersY as Float64Arrays', () => {
    expect(Pool.absCornersX).toBeInstanceOf(Float64Array);
    expect(Pool.absCornersY).toBeInstanceOf(Float64Array);
  });

  test('initial capacity is at least 1024', () => {
    expect(Pool.absCornersX.length).toBeGreaterThanOrEqual(1024);
    expect(Pool.absCornersY.length).toBeGreaterThanOrEqual(1024);
  });

  test('pool stats reflect allocations', () => {
    const obj = {};
    allocateNodeId(obj);
    const stats = _poolStats();
    expect(stats.nextId).toBe(1);
    expect(stats.capacity).toBeGreaterThanOrEqual(1024);
  });

  test('writes to Pool arrays persist by index', () => {
    const obj = {};
    const id = allocateNodeId(obj);
    Pool.absCornersX[id] = 42.5;
    Pool.absCornersY[id] = 100.25;
    expect(Pool.absCornersX[id]).toBe(42.5);
    expect(Pool.absCornersY[id]).toBe(100.25);
  });

  test('pool grows when nextId would exceed capacity', () => {
    const initialCapacity = _poolStats().capacity;
    // Allocate enough to force a grow
    const objs: object[] = [];
    for (let i = 0; i < initialCapacity + 10; i++) {
      objs.push({});
      allocateNodeId(objs[i]!);
    }
    const stats = _poolStats();
    expect(stats.capacity).toBeGreaterThan(initialCapacity);
    expect(Pool.absCornersX.length).toBe(stats.capacity);
    expect(Pool.absCornersY.length).toBe(stats.capacity);
  });

  test('data is preserved across pool growth', () => {
    const obj = {};
    const id = allocateNodeId(obj);
    Pool.absCornersX[id] = 99.5;
    // Force growth
    const fillerObjs: object[] = [];
    const initialCap = _poolStats().capacity;
    for (let i = 0; i < initialCap; i++) {
      fillerObjs.push({});
      allocateNodeId(fillerObjs[i]!);
    }
    // The original write should still be there
    expect(Pool.absCornersX[id]).toBe(99.5);
  });

  test('_resetPoolForTesting clears state', () => {
    const objs: object[] = [];
    for (let i = 0; i < 100; i++) {
      objs.push({});
      allocateNodeId(objs[i]!);
    }
    expect(_poolStats().nextId).toBe(100);
    _resetPoolForTesting();
    expect(_poolStats().nextId).toBe(0);
    expect(_poolStats().freeCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @pilates/core test -- layout-pool.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `layout-pool.ts`**

Create `packages/core/src/layout-pool.ts` per the spec's "LayoutPool module" section.

The implementation is concise (~70 lines). Key points:
- `INITIAL_CAPACITY = 1024`.
- `Pool` is a mutable object with `absCornersX: Float64Array` and `absCornersY: Float64Array`.
- `allocateNodeId(node)` pops from `freeIds` first, else uses `nextId++`. Grows pool if needed. Registers node with FinalizationRegistry.
- `FinalizationRegistry` callback pushes id to `freeIds`.
- `growPool` doubles capacity, copies existing data to new arrays, replaces `Pool.absCornersX` / `Pool.absCornersY`.
- `_resetPoolForTesting` resets to initial state.
- `_poolStats` returns `{ capacity, nextId, freeCount }`.

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @pilates/core test -- layout-pool.test`
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/layout-pool.ts packages/core/src/layout-pool.test.ts
git commit -m "$(cat <<'EOF'
phase 15C: layout-pool.ts — typed-array storage indexed by Node._id

Foundation for phase-15 sub-phases that replace Map<Node, X>
lookups with TypedArray[node._id]. Pool object holds Float64Arrays
for absolute corners (X, Y) — used by roundLayout in Task 2.

Capacity 1024 initially; grows on demand (doubling). IDs recycled
via FinalizationRegistry — long-running processes stay bounded by
peak live-node count.

8 vitest tests cover sequential allocation, growth, data
preservation, and reset. No Node coupling yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add `Node._id` field

**Files:**
- Modify: `packages/core/src/node.ts`

Single small change: import `allocateNodeId`, add the `_id` field, ensure it's initialized in the constructor.

- [ ] **Step 1: Add import to node.ts**

At the top of `packages/core/src/node.ts`, near the other imports:

```ts
import { allocateNodeId } from './layout-pool.js';
```

- [ ] **Step 2: Add the field**

Inside the `Node` class, near other private fields:

```ts
  /**
   * Unique integer ID for typed-array indexing in the LayoutPool.
   * Assigned at construction; recycled via FinalizationRegistry when
   * this Node is garbage-collected.
   *
   * @internal
   */
  readonly _id: number = allocateNodeId(this);
```

(Note: `readonly` because the ID never changes; assigned via field initializer using `this` reference.)

- [ ] **Step 3: Run all core tests — regression net**

Run: `pnpm --filter @pilates/core test`
Expected: all existing tests pass; no behavior change since `_id` is unused so far.

- [ ] **Step 4: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/node.ts
git commit -m "$(cat <<'EOF'
phase 15C: add Node._id integer index

Field assigned at construction via allocateNodeId(this). Recycled
via FinalizationRegistry when the Node is GC'd. Used by
roundLayout in Task 2 and subsequent phase-15 sub-phases.

No behavior change. The pool's Float64Arrays are populated but
unread until Task 2's roundLayout refactor uses them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Refactor `roundLayout` to use `Pool` instead of `Map<Node, AbsCorner>`

**Files:**
- Modify: `packages/core/src/algorithm/round.ts`

Replace the Map with `Pool.absCornersX[node._id]` / `Pool.absCornersY[node._id]`. Same two-pass pre-order traversal; the storage mechanism changes. Output byte-identical.

- [ ] **Step 1: Read current `round.ts`**

Run: `cat packages/core/src/algorithm/round.ts` (or use Read).

Identify:
- The `AbsCorner` type (likely `{ x: number; y: number }`).
- The `Map<Node, AbsCorner>` allocation site.
- The collect-pass function (recursive DFS, calls `corners.set(node, { x, y })`).
- The apply-pass function (recursive DFS, calls `corners.get(node)`).

- [ ] **Step 2: Refactor to use Pool**

Replace the Map with direct Pool access:

```ts
import type { Node } from '../node.js';
import { Pool } from '../layout-pool.js';

export function roundLayout(root: Node): void {
  collectAbsolutes(root, 0, 0);
  applyRounding(root);
}

function collectAbsolutes(node: Node, parentAbsX: number, parentAbsY: number): void {
  const absX = parentAbsX + node._floatLeft;
  const absY = parentAbsY + node._floatTop;
  Pool.absCornersX[node._id] = absX;
  Pool.absCornersY[node._id] = absY;
  for (let i = 0; i < node.getChildCount(); i++) {
    collectAbsolutes(node.getChild(i)!, absX, absY);
  }
}

function applyRounding(node: Node): void {
  const absX = Pool.absCornersX[node._id]!;
  const absY = Pool.absCornersY[node._id]!;
  // ... existing rounding math, reading absX/absY from above ...
}
```

(Adjust per the actual `round.ts` structure. Preserve all existing rounding logic exactly; only the parent-corner lookup mechanism changes.)

Delete the `AbsCorner` type if no longer needed.

- [ ] **Step 3: Run round.test.ts (existing tests)**

Run: `pnpm --filter @pilates/core test -- round.test`
Expected: existing tests pass. If they don't, the rounding logic was inadvertently changed; fix.

- [ ] **Step 4: Run differential mode — the controlling correctness gate**

Run: `pnpm test:differential`
Expected: 812 passed / 6 skipped. `roundLayout` is invoked on every layout call, so any divergence surfaces immediately.

- [ ] **Step 5: Run full core suite**

Run: `pnpm --filter @pilates/core test`
Expected: 1448 + 8 (new layout-pool tests) = 1456 tests pass.

- [ ] **Step 6: Run structural fuzzer**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Expected: green at numRuns=300.

- [ ] **Step 7: Run lint + typecheck**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/algorithm/round.ts
git commit -m "$(cat <<'EOF'
phase 15C: roundLayout uses Pool.absCornersX/Y instead of Map

Replaces Map<Node, AbsCorner> with direct Float64Array access by
node._id. Two-pass traversal preserved; rounding math unchanged.
Output byte-identical (validated by pnpm test:differential).

Probe-measured ~18µs improvement on 1k-node trees. Universal —
every cold layout invocation pays less.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Full validation sweep + bench

**Files:** none touched in this task. Run the gates.

- [ ] **Step 1: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 2: Full workspace test**

Run: `pnpm test`
Expected: 1456 tests pass.

- [ ] **Step 3: Differential mode (repeat 3 times to catch flake)**

Run: `pnpm test:differential` × 3
Expected: 812/6-skipped each time.

- [ ] **Step 4: Structural fuzzer at numRuns=300**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Expected: green.

- [ ] **Step 5: Yoga oracle (33 fixtures)**

Run: `pnpm --filter @pilates/core test -- yoga-oracle`
Expected: 33 pass.

- [ ] **Step 6: Bench measurement**

Run: `pnpm bench`
Expected: writes `bench/RESULTS.md` + `bench/history/<sha>.json`.

Inspect for `@pilates/core (layout)` rows. Compare to pre-15C numbers (commit `8d7b597` bench):
- Pre-15C: `hot-relayout 22.4µs / hot-relayoutboundary 22.4µs / hot-relayouttext 21.5µs / hot-structural 392µs / huge 11.92ms / big 4.55ms / stress 750µs / realistic 144.7µs / tiny 5.6µs`.
- Post-15C: all should be ~5-18µs faster (where `roundLayout` is invoked). Hot scenarios may show modest improvement since `roundLayoutFrom` is invoked in `finishMoved`; cold scenarios (especially huge) should show the most.

If `hot-structural` shows surprising regression (> 5% slower), investigate — pool growth or FinalizationRegistry overhead may be impacting hot allocation patterns.

- [ ] **Step 7: Commit `bench/RESULTS.md`**

```bash
git add bench/RESULTS.md
git commit -m "$(cat <<'EOF'
bench: refresh RESULTS.md post phase 15C

LayoutPool + roundLayout refactor delivers measurable improvement
on roundLayout-heavy scenarios:
- [actual numbers from inspection]

Universal improvement (every layout pass invokes roundLayout or
roundLayoutFrom). No regressions on hot-* scenarios within
variance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Replace `[actual numbers from inspection]` with the actual comparison.)

---

## Self-Review

**Spec coverage:**
- `LayoutPool` module: Task 1. ✓
- `Pool.absCornersX/Y` Float64Arrays: Task 1. ✓
- `allocateNodeId` with FinalizationRegistry recycling: Task 1. ✓
- Capacity growth on demand: Task 1 (test 6+7). ✓
- `Node._id` field: Task 2. ✓
- `roundLayout` refactored: Task 3. ✓
- Output byte-identical (differential mode): Task 3 Step 4. ✓
- ~18µs improvement validation: Task 4 Step 6. ✓
- Tests: 8 pool tests + existing round tests + differential + fuzzer. ✓

**Placeholder scan:**
- Task 3 Step 2 says "adjust per the actual round.ts structure" — acceptable since the implementer must read the file first.
- Task 4 Step 7 has `[actual numbers from inspection]` placeholder — the implementer fills in real values.
- No "TBD" / "TODO" / "implement later".

**Type / name consistency:**
- `Pool`, `allocateNodeId`, `_id`, `_resetPoolForTesting`, `_poolStats` — all consistent across module, Node, tests, and round.ts.
- `Float64Array` typing consistent.
- `FinalizationRegistry<number>` typed for ID recycling.

No gaps or inconsistencies.
