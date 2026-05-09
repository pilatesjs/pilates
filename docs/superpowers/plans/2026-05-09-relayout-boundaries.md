# Relayout Boundaries Implementation Plan (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Flutter-style layout boundaries to `@pilates/core` so descendant mutations under a node with explicit width+height don't dirty ancestors. Closes the WASM-Yoga gap on hot-relayout (mutate-one-leaf-per-frame) workloads.

**Architecture:** Three-line change to `Node.markDirty()` plus a new private `isLayoutBoundary()` method (two `typeof` checks). New `_forceDirty()` `@internal` method bypasses the boundary check; used only by the differential-mode validation infrastructure (`markDirtyDeep` in `cache.ts`). New unit tests + cache invariant test + dedicated bench scenario.

**Tech Stack:** TypeScript 5.7, vitest, fast-check, tinybench. All infrastructure from Phase 1+2 reused unchanged.

**Branch:** `perf-relayout-boundaries` (off main; user creates after merging PR #48).

**Spec reference:** `docs/superpowers/specs/2026-05-09-relayout-boundaries-design.md`.

---

## File map

**Modify:**
- `packages/core/src/node.ts` — add private `isLayoutBoundary()`, add `@internal` `_forceDirty()`, modify `markDirty()` to short-circuit at boundaries.
- `packages/core/src/algorithm/cache.ts` — change `markDirtyDeep` to call `_forceDirty()` instead of `markDirty()`.
- `packages/core/src/node.test.ts` — append 5 boundary-semantics tests.
- `packages/core/src/algorithm/cache.invariants.test.ts` — append 1 cache-hit-after-mutation-under-boundary test.
- `bench/index.ts` — register the new scenario.
- `bench/thresholds.json` — add a threshold for `hotrelayoutboundary`.
- `packages/core/CHANGELOG.md` — `## Unreleased` Phase 3 entry.

**Create:**
- `bench/scenarios/hot-relayout-boundary.ts` — same shape as `hot-relayout.ts` but with explicit-sized row containers.

---

## Task 1: Add `_forceDirty()` + update `markDirtyDeep`

Pre-requisite infrastructure. No user-visible behavior change yet.

**Files:**
- Modify: `packages/core/src/node.ts`
- Modify: `packages/core/src/algorithm/cache.ts`

- [ ] **Step 1: Add `_forceDirty()` method to `Node`**

In `packages/core/src/node.ts`, locate the existing `markDirty()` method (around line 438). Add the new method directly below it:

```ts
  /**
   * Set dirty + clear caches + propagate up unconditionally, bypassing
   * the layout-boundary short-circuit in `markDirty()`. Used only by
   * `markDirtyDeep` in `algorithm/cache.ts` for differential-mode and
   * fuzzer validation that need to force the full tree onto the cold
   * path regardless of boundary semantics.
   *
   * @internal
   */
  _forceDirty(): void {
    this._dirty = true;
    this._measureCache?.clear();
    this._layoutCache?.clear();
    if (this._parent !== null && !this._parent._dirty) this._parent._forceDirty();
  }
```

- [ ] **Step 2: Update `markDirtyDeep` to call `_forceDirty()`**

In `packages/core/src/algorithm/cache.ts`, locate `markDirtyDeep`:

```ts
export function markDirtyDeep(root: Node): void {
  root.markDirty();
  for (let i = 0; i < root.getChildCount(); i++) markDirtyDeep(root.getChild(i)!);
}
```

Replace with:

```ts
export function markDirtyDeep(root: Node): void {
  // Use _forceDirty rather than markDirty so the propagation walks
  // through layout boundaries (Phase 3). Differential-mode and fuzzer
  // validation rely on dirtying the entire tree to force the cold path.
  root._forceDirty();
  for (let i = 0; i < root.getChildCount(); i++) markDirtyDeep(root.getChild(i)!);
}
```

The existing JSDoc comment about the redundant clear (Phase 1's measure cache) still applies — leave it in place.

- [ ] **Step 3: Run all existing tests**

Run from repo root: `pnpm vitest run packages/core/src`
Expected: ALL PASS — no behavior change yet (no boundaries exist; `_forceDirty` and `markDirty` are functionally identical until Task 2 lands).

Run: `pnpm test:differential` — also all green.

- [ ] **Step 4: typecheck + lint**

`pnpm typecheck` and `pnpm lint`. Both clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/node.ts packages/core/src/algorithm/cache.ts
git commit -m "feat(core): add _forceDirty() infra for relayout-boundary work"
```

---

## Task 2: Add `isLayoutBoundary()` + modify `markDirty()` + unit tests

The actual feature. TDD: write 5 unit tests, watch them fail (existing `markDirty` always propagates), then add the boundary semantics, watch them pass.

**Files:**
- Modify: `packages/core/src/node.ts`
- Modify: `packages/core/src/node.test.ts`

- [ ] **Step 1: Append 5 failing tests to `node.test.ts`**

After the existing `Node — layout cache integration` block, append:

```ts
describe('Node — relayout boundary semantics', () => {
  it('node with explicit width and height stops dirty propagation', () => {
    const root = Node.create();
    const boundary = Node.create();
    boundary.setWidth(50);
    boundary.setHeight(20);
    const leaf = Node.create();
    boundary.insertChild(leaf, 0);
    root.insertChild(boundary, 0);
    root.calculateLayout(100, 50);

    // All clean after layout.
    expect(root.isDirty()).toBe(false);
    expect(boundary.isDirty()).toBe(false);

    leaf.setFlexGrow(2);

    expect(leaf.isDirty()).toBe(true);
    expect(boundary.isDirty()).toBe(true);   // boundary itself dirties
    expect(root.isDirty()).toBe(false);      // propagation STOPPED
  });

  it('node with only explicit width (no height) propagates dirty up', () => {
    const root = Node.create();
    const partial = Node.create();
    partial.setWidth(50); // height is still 'auto'
    const leaf = Node.create();
    partial.insertChild(leaf, 0);
    root.insertChild(partial, 0);
    root.calculateLayout(100, 50);

    leaf.setFlexGrow(2);
    expect(root.isDirty()).toBe(true); // walked all the way up — not a boundary
  });

  it('toggling width to "auto" removes the boundary', () => {
    const root = Node.create();
    const node = Node.create();
    node.setWidth(50);
    node.setHeight(20);
    root.insertChild(node, 0);
    const leaf = Node.create();
    node.insertChild(leaf, 0);
    root.calculateLayout(100, 50);

    node.setWidth('auto'); // dirties root via markDirty (correct — node's
                            // size will change)
    root.calculateLayout(100, 50); // re-clean
    expect(root.isDirty()).toBe(false);

    leaf.setFlexGrow(2);
    expect(root.isDirty()).toBe(true); // node is no longer a boundary
  });

  it('absolute-positioned boundary still acts as a boundary', () => {
    const root = Node.create();
    const abs = Node.create();
    abs.setPositionType('absolute');
    abs.setWidth(30);
    abs.setHeight(15);
    const leaf = Node.create();
    abs.insertChild(leaf, 0);
    root.insertChild(abs, 0);
    root.calculateLayout(100, 50);

    leaf.setFlexGrow(2);
    expect(abs.isDirty()).toBe(true);
    expect(root.isDirty()).toBe(false);
  });

  it('_forceDirty bypasses boundary semantics for differential-mode infra', () => {
    const root = Node.create();
    const boundary = Node.create();
    boundary.setWidth(50);
    boundary.setHeight(20);
    const leaf = Node.create();
    boundary.insertChild(leaf, 0);
    root.insertChild(boundary, 0);
    root.calculateLayout(100, 50);

    (leaf as unknown as { _forceDirty: () => void })._forceDirty();
    expect(leaf.isDirty()).toBe(true);
    expect(boundary.isDirty()).toBe(true);
    expect(root.isDirty()).toBe(true); // forced through the boundary
  });
});
```

- [ ] **Step 2: Run the new tests — verify failures**

Run: `pnpm vitest run packages/core/src/node.test.ts -t "relayout boundary semantics"`
Expected: 4 failures (test 1, 2 already pass partially — verify each individually). Specifically tests 1, 3, 4 expect `root.isDirty()` to be `false` after a descendant mutation; current `markDirty()` always propagates to root, so root is dirty → tests fail. Test 5 should pass already since `_forceDirty()` was added in Task 1.

If test 2 fails, that's a real surprise — investigate. It tests the negative case (no boundary), which should match existing behavior.

- [ ] **Step 3: Add `isLayoutBoundary()` method to `Node`**

In `packages/core/src/node.ts`, in the `Node` class (place it just above `markDirty()` for grouping):

```ts
  /**
   * A node is a relayout boundary iff both `width` and `height` are
   * explicit numbers (not `'auto'`). Boundaries stop the upward dirty
   * propagation in `markDirty()` so descendant mutations don't
   * invalidate ancestor caches.
   *
   * Why explicit width AND height is sufficient: with both axes pinned,
   * the boundary's size can't change as a function of descendants. The
   * flex algorithm honors explicit values directly. `flexGrow` /
   * `flexShrink` adjust size based on PARENT state (free space), not
   * DESCENDANT state — when a descendant mutates without dirtying the
   * parent, the parent's flex distribution result stays the same, so
   * the boundary's actual size stays the same.
   *
   * See `docs/superpowers/specs/2026-05-09-relayout-boundaries-design.md`
   * for the full rationale and edge-case analysis.
   */
  private isLayoutBoundary(): boolean {
    return (
      typeof this._style.width === 'number' && typeof this._style.height === 'number'
    );
  }
```

- [ ] **Step 4: Modify `markDirty()` to short-circuit at boundaries**

In the same file, find `markDirty()` (around line 438):

```ts
  markDirty(): void {
    this._dirty = true;
    this._measureCache?.clear();
    this._layoutCache?.clear();
    if (this._parent !== null && !this._parent._dirty) this._parent.markDirty();
  }
```

Replace with:

```ts
  markDirty(): void {
    this._dirty = true;
    this._measureCache?.clear();
    this._layoutCache?.clear();
    // Stop propagation at relayout boundaries — see isLayoutBoundary
    // and the Phase 3 spec for why explicit width+height makes the
    // boundary's size independent of descendant changes.
    if (this.isLayoutBoundary()) return;
    if (this._parent !== null && !this._parent._dirty) this._parent.markDirty();
  }
```

- [ ] **Step 5: Run the boundary tests — verify passes**

Run: `pnpm vitest run packages/core/src/node.test.ts -t "relayout boundary semantics"`
Expected: 5 PASS.

- [ ] **Step 6: Run the full core test suite**

Run: `pnpm vitest run packages/core/src`
Expected: ALL PASS — no regressions.

The yoga-oracle suite (33 fixtures) is the canonical correctness gate. If it fails, the boundary semantics introduced a divergence from WASM Yoga — STOP and investigate.

- [ ] **Step 7: Run differential mode**

Run: `pnpm test:differential`
Expected: ALL PASS, zero divergences. This validates that the boundary semantics don't break the cache-vs-cold equivalence — the fuzzer + every existing test runs both paths and asserts identical layouts.

If divergences appear: STOP. The boundary may be incorrectly applied somewhere (e.g., a node that should still propagate dirty doesn't). Report DONE_WITH_CONCERNS with the divergence message.

- [ ] **Step 8: typecheck + lint**

`pnpm typecheck` and `pnpm lint`. Both clean.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/node.ts packages/core/src/node.test.ts
git commit -m "feat(core): add relayout boundaries (explicit width+height short-circuit markDirty)"
```

---

## Task 3: Cache invariant test

Verify that the layout cache infrastructure cooperates correctly with boundaries — specifically, that `calculateLayout` actually hits the root cache after a descendant-of-boundary mutation.

**Files:**
- Modify: `packages/core/src/algorithm/cache.invariants.test.ts`

- [ ] **Step 1: Append the cache-invariant test**

At the end of the existing `cache invariants — open questions from spec` describe block (or add a new describe block at the end of the file):

```ts
describe('cache invariants — relayout boundaries', () => {
  it('layout cache hits at root after descendant mutation under a boundary', () => {
    // The Phase 3 win: with a boundary in the tree, descendant mutations
    // don't invalidate the root cache. Root.calculateLayout hits its
    // cache even though a leaf inside the boundary changed.
    const root = Node.create();
    root.setFlexDirection('row');
    const boundary = Node.create();
    boundary.setWidth(50);
    boundary.setHeight(50);
    const leaf = Node.create();
    boundary.insertChild(leaf, 0);
    root.insertChild(boundary, 0);

    // Prime the cache.
    root.calculateLayout(100, 50);

    // Mutate a leaf under the boundary.
    leaf.setFlexGrow(3);

    const beforeHits =
      (root as unknown as { _layoutCache?: { hits: number } })._layoutCache?.hits ??
      0;

    root.calculateLayout(100, 50);

    const afterHits =
      (root as unknown as { _layoutCache?: { hits: number } })._layoutCache?.hits ??
      0;

    // Root cache must hit (boundary stopped dirty propagation).
    // Differential mode skips this assertion (cold-pass invalidates
    // the counter).
    if (process.env.PILATES_DIFFERENTIAL_LAYOUT !== '1') {
      expect(afterHits).toBe(beforeHits + 1);
    }

    // Layout still correct.
    expect(boundary.layout.width).toBe(50);
    expect(boundary.layout.height).toBe(50);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run packages/core/src/algorithm/cache.invariants.test.ts`
Expected: PASS, all prior tests + 1 new test green.

Run: `pnpm test:differential` — confirm clean under differential mode too.

- [ ] **Step 3: typecheck + lint**

Both clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/algorithm/cache.invariants.test.ts
git commit -m "test(core): cache hits at root when descendant of boundary mutates"
```

---

## Task 4: hot-relayout-boundary bench scenario

Demonstrates the Phase 3 win directly. Same shape as `hot-relayout.ts` but with explicit-sized row containers, so each row is a boundary and leaf mutations don't propagate to root.

**Files:**
- Create: `bench/scenarios/hot-relayout-boundary.ts`
- Modify: `bench/index.ts`
- Modify: `bench/thresholds.json`

- [ ] **Step 1: Create `bench/scenarios/hot-relayout-boundary.ts`**

```ts
/**
 * Hot-relayout with explicit-sized row containers (boundaries).
 *
 * Same workload shape as `hot-relayout.ts` (1k-node persistent tree,
 * mutate one leaf per pass), but each row container has explicit
 * `width` AND `height` — making it a relayout boundary. Leaf
 * mutations dirty the row but don't propagate to root, so root's
 * layout cache hits on every pass and only the row's subtree re-runs
 * flex.
 *
 * Demonstrates the Phase 3 win directly. Compared to `hotrelayout`,
 * Pilates should be substantially faster.
 */

import { Node } from '@pilates/core';
import Yoga from 'yoga-layout';

const COLS = 200;
const ROWS = 100;
const ROW_COUNT = 50;
const CELLS_PER_ROW = 20;
const ROW_HEIGHT = ROWS / ROW_COUNT; // 2

let pilatesRoot: Node;
let pilatesTargetLeaf: Node;
let pilatesToggle = false;

function buildPilatesPersistent(): void {
  const root = Node.create();
  root.setFlexDirection('column');
  root.setWidth(COLS);
  root.setHeight(ROWS);
  let firstLeaf: Node | undefined;
  for (let r = 0; r < ROW_COUNT; r++) {
    const row = Node.create();
    // Explicit width AND height — this row is a relayout boundary.
    row.setWidth(COLS);
    row.setHeight(ROW_HEIGHT);
    row.setFlexDirection('row');
    root.insertChild(row, r);
    for (let c = 0; c < CELLS_PER_ROW; c++) {
      const cell = Node.create();
      cell.setFlex(1);
      row.insertChild(cell, c);
      if (firstLeaf === undefined) firstLeaf = cell;
    }
  }
  pilatesRoot = root;
  pilatesTargetLeaf = firstLeaf!;
  // Prime the layout once.
  root.calculateLayout(COLS, ROWS);
}

buildPilatesPersistent();

export function pilatesCoreLayout(): void {
  pilatesToggle = !pilatesToggle;
  pilatesTargetLeaf.setFlex(pilatesToggle ? 1 : 2);
  pilatesRoot.calculateLayout(COLS, ROWS);
}

export function pilatesFullRender(): void {
  pilatesCoreLayout();
}

// Yoga: same persistent-tree pattern. Yoga's algorithm has its own
// dirty-bit tracking but doesn't have a "layout boundary" concept
// equivalent to Phase 3 — its caches are per-node single-slot, so the
// relayout still walks the spine on each mutation.
let yogaRoot: import('yoga-layout').Node | undefined;
let yogaTarget: import('yoga-layout').Node | undefined;
let yogaToggle = false;

function buildYogaPersistent(): void {
  if (yogaRoot !== undefined) return;
  const root = Yoga.Node.create();
  root.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
  root.setWidth(COLS);
  root.setHeight(ROWS);
  let first: import('yoga-layout').Node | undefined;
  for (let r = 0; r < ROW_COUNT; r++) {
    const row = Yoga.Node.create();
    row.setWidth(COLS);
    row.setHeight(ROW_HEIGHT);
    row.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    root.insertChild(row, r);
    for (let c = 0; c < CELLS_PER_ROW; c++) {
      const cell = Yoga.Node.create();
      cell.setFlex(1);
      row.insertChild(cell, c);
      if (first === undefined) first = cell;
    }
  }
  yogaRoot = root;
  yogaTarget = first;
  root.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
}

buildYogaPersistent();

export function yogaLayout(): void {
  yogaToggle = !yogaToggle;
  yogaTarget!.setFlex(yogaToggle ? 1 : 2);
  yogaRoot!.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
}
```

- [ ] **Step 2: Register in `bench/index.ts`**

Add the import:

```ts
import * as hotRelayoutBoundary from './scenarios/hot-relayout-boundary.js';
```

Append to `SCENARIOS`:

```ts
  { name: 'hotrelayoutboundary', notes: '1k-node persistent tree with explicit-sized row boundaries, mutate one leaf', ...hotRelayoutBoundary },
```

(Lowercase one-word name to match the threshold-key constraint in `check-budgets.ts`.)

- [ ] **Step 3: Run bench**

Run: `pnpm bench`
Expected: 7 scenarios in RESULTS.md. Pilates' `hotrelayoutboundary` should be substantially faster than `hotrelayout` (the boundary lets the root cache hit). If it ISN'T faster, the boundary semantics aren't being exercised — investigate.

- [ ] **Step 4: Add a threshold to `bench/thresholds.json`**

Read the measured `hotrelayoutboundary` mean latency from `bench/RESULTS.md`. Set the threshold at ~2× measured (matching Phase 2's tightening pattern).

For example, if measured at 30µs (0.030ms), set threshold to 0.06ms. If measured at 80µs, set to 0.16ms.

Add the entry to `bench/thresholds.json`:

```json
{
  ...existing entries...,
  "hotrelayoutboundary": { "@pilates/core (layout)": { "maxMeanMs": 0.10 } }
}
```

(Substitute the actual computed threshold.)

- [ ] **Step 5: Run budget check**

Run: `pnpm bench:budgets`
Expected: all 7 scenarios within threshold; exit 0.

- [ ] **Step 6: typecheck + lint**

Both clean.

- [ ] **Step 7: Commit**

```bash
git add bench/scenarios/hot-relayout-boundary.ts bench/index.ts bench/thresholds.json bench/RESULTS.md
git commit -m "bench: add hot-relayout-boundary scenario (boundary stops dirty propagation)"
```

---

## Task 5: CHANGELOG, final CI, push, open PR

**Files:**
- Modify: `packages/core/CHANGELOG.md`

- [ ] **Step 1: Add CHANGELOG entry**

In `## Unreleased`, append below the existing Phase 1 + Phase 2 entries:

```markdown
### Performance hardening — Phase 3 (relayout boundaries)

- **Internal** Flutter-style relayout boundaries: a node with explicit
  `width` AND explicit `height` now stops the upward `markDirty()`
  propagation. Descendant mutations don't dirty ancestors, so
  ancestor `_layoutCache` entries stay valid. The boundary itself
  goes dirty and re-runs cold on the next `calculateLayout`.
- **Internal** new `Node._forceDirty()` `@internal` method bypasses
  the boundary check. Used only by `markDirtyDeep` in
  `algorithm/cache.ts` for differential-mode and fuzzer validation.
- **Bench** new `hotrelayoutboundary` scenario — same shape as
  `hotrelayout` but with explicit-sized row containers. Demonstrates
  the Phase 3 win: substantially faster than `hotrelayout` because
  the root cache hits on every iteration.
- **Public API unchanged.** Boundaries auto-detected from existing
  style; no new setters or getters exposed.
```

- [ ] **Step 2: Run full CI locally**

Run: `pnpm run ci`
Expected: ALL clean — lint, build, typecheck, test, test:differential.

Run: `pnpm bench && pnpm bench:budgets`
Expected: 7 scenarios green; budgets pass; exit 0.

- [ ] **Step 3: Commit CHANGELOG**

```bash
git add packages/core/CHANGELOG.md
git commit -m "docs: changelog entry for relayout boundaries (Phase 3)"
```

- [ ] **Step 4: Push**

```bash
git push -u origin perf-relayout-boundaries
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "perf(core): relayout boundaries (Phase 3)" --body "$(cat <<'EOF'
## Summary

Phase 3 of the perf-hardening work scoped in `docs/superpowers/specs/2026-05-09-relayout-boundaries-design.md`.

- **Flutter-style relayout boundaries** — a node with explicit `width` AND `height` stops the upward `markDirty()` propagation. Descendant mutations don't dirty ancestors, so root `_layoutCache` hits on subsequent `calculateLayout` calls. Three-line change to `markDirty()` plus a private `isLayoutBoundary()` method (two `typeof` checks).
- **`_forceDirty()` `@internal` escape hatch** — bypasses the boundary check; used only by `markDirtyDeep` in the cache helpers so differential mode and the fuzzer can compute the cold path for validation.
- **5 new unit tests** in `node.test.ts` covering boundary semantics (positive, negative, toggle, absolute, `_forceDirty` bypass).
- **1 new cache invariant test** in `cache.invariants.test.ts` proving root cache hit after descendant-of-boundary mutation.
- **New `hotrelayoutboundary` bench scenario** — same shape as `hotrelayout` but with explicit-sized row containers, demonstrating the Phase 3 win.
- **Public API unchanged.**

Closes the WASM-Yoga gap on hot-relayout workloads when consumers structure their trees with explicit-sized container nodes (the idiomatic TUI pattern).

## Test plan

- [x] Full CI green locally (`pnpm run ci`)
- [x] Differential mode green (`pnpm test:differential`)
- [x] Fuzzer green at 500 runs
- [x] All 7 bench scenarios green; budgets pass
- [ ] CI green on this PR
- [ ] perf-budgets workflow uploads RESULTS.md as an artifact

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Verify CI green on the PR**

Both `ci` and `perf-budgets` workflows must succeed.

If `perf-budgets` fails on the runner due to variance, relax the offending threshold in a follow-up commit.

---

## Self-review checklist

- [ ] Spec coverage: every section in `docs/superpowers/specs/2026-05-09-relayout-boundaries-design.md` is addressed:
  - `isLayoutBoundary()` definition → Task 2
  - `markDirty()` modification → Task 2
  - `_forceDirty()` + `markDirtyDeep` update → Task 1
  - 5 unit tests → Task 2 step 1
  - 1 cache invariant test → Task 3
  - Hot-relayout-boundary bench → Task 4
  - CHANGELOG → Task 5
- [ ] Placeholder scan: no TBDs, all code blocks complete
- [ ] Type consistency: `isLayoutBoundary()` and `_forceDirty()` referenced identically across all tasks
- [ ] Each task has a clean commit message and atomic scope

**Realistic effort:** ~8hr for an experienced TypeScript engineer who completed Phase 1+2. The infrastructure (differential mode, fuzzer, bench harness, perf budgets) is reused unchanged.
