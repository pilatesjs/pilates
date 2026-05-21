# Phase 15C — Node integer indexing + LayoutPool foundation

## Context

Phase 15A profiling identified two infrastructure-level levers:

1. **Node integer indexing** — enables typed-array keying (replacing `Map<Node, X>` with `TypedArray[node._id]`) across multiple hot paths. Foundation for 15D (`snapshotForCache`), 15G (integer-indexed PQ), and future SoA inner-loop refactors.
2. **`roundLayout` Map → flat array** — already implemented on the shelved phase 14b branch; ~18µs universal saving on 1k-node trees. Cherry-pickable.

Phase 15C ships both together. The integer indexing is the foundation; the `roundLayout` refactor is the first concrete consumer. Subsequent sub-phases (15D, 15G) use the same `Node._id` infrastructure for their own typed-array data structures.

## Goal

**Ship Node integer indexing + a `LayoutPool` module + a `roundLayout` refactor that uses the pool's typed arrays instead of a `Map<Node, AbsCorner>`.**

Concrete deliverables:
- `Node._id: number` — unique integer assigned at construction; recycled via `FinalizationRegistry` when nodes are GC'd.
- `LayoutPool` module — managed `Float64Array`s with growth-on-demand and ID lifecycle.
- `roundLayout` refactored to use `Pool.absCornersX[node._id]` / `Pool.absCornersY[node._id]` instead of `Map.get`.

**Success criteria:**

1. `Node._id` is a unique non-negative integer for every live Node.
2. Recycled IDs (via `FinalizationRegistry`) are reused — long-running processes don't grow the pool unboundedly.
3. `roundLayout` produces byte-identical output to before (validated by `pnpm test:differential` + Yoga oracle).
4. `pnpm bench` shows ~10-18µs improvement on scenarios where `roundLayout` is invoked (universal — every cold layout, every Spineless `finishMoved`).
5. `LayoutPool` capacity grows automatically when `nextId` exceeds it (no hard cap).
6. All existing tests pass.

**Explicit non-goals (deferred to later phases):**

- Moving `_layout.{width,height,left,top}` etc. into the pool. (Phase 15D / 15F will do this once `snapshotForCache` benefits from it.)
- Inner-loop refactor for `layoutFlexFlow` to read from pool. (Future phase if profiling warrants.)
- SoA storage for `_floatLeft/Top` or any other Node fields. (Future phase.)
- The pool's lifecycle hooks integrating with Node garbage collection beyond FinalizationRegistry.

## Architecture

### `Node._id` allocation

In `node.ts`:

```ts
import { allocateNodeId } from './layout-pool.js';

class Node {
  /**
   * Unique integer ID for typed-array indexing in the LayoutPool.
   * Assigned at construction; recycled via FinalizationRegistry when
   * this Node is garbage-collected.
   *
   * @internal
   */
  readonly _id: number = allocateNodeId(this);
  // ... rest of class unchanged ...
}
```

The ID is assigned once at construction; never changes during the node's lifetime.

### `LayoutPool` module

```ts
// packages/core/src/layout-pool.ts

/**
 * Typed-array storage indexed by `Node._id`. Replaces `Map<Node, X>`
 * lookups in hot paths (roundLayout, snapshotForCache, OmPriorityQueue
 * in future sub-phases).
 *
 * Capacity grows on demand. IDs are recycled when nodes are GC'd
 * via `FinalizationRegistry` — long-running processes do not
 * accumulate IDs unboundedly.
 *
 * @internal
 */

const INITIAL_CAPACITY = 1024;

export interface LayoutPoolArrays {
  absCornersX: Float64Array;
  absCornersY: Float64Array;
}

let capacity = INITIAL_CAPACITY;
let nextId = 0;
const freeIds: number[] = [];

export const Pool: LayoutPoolArrays = {
  absCornersX: new Float64Array(INITIAL_CAPACITY),
  absCornersY: new Float64Array(INITIAL_CAPACITY),
};

const registry = new FinalizationRegistry<number>((id) => {
  freeIds.push(id);
});

/**
 * Allocate an integer ID for `node`. Returns a recycled ID if any
 * are available, otherwise a fresh one. Grows the pool if `nextId`
 * exceeds current capacity.
 *
 * @internal
 */
export function allocateNodeId(node: object): number {
  const id = freeIds.pop() ?? nextId++;
  if (id >= capacity) growPool();
  registry.register(node, id);
  return id;
}

function growPool(): void {
  const newCap = Math.max(capacity * 2, nextId + 1);
  const newX = new Float64Array(newCap);
  const newY = new Float64Array(newCap);
  newX.set(Pool.absCornersX);
  newY.set(Pool.absCornersY);
  Pool.absCornersX = newX;
  Pool.absCornersY = newY;
  capacity = newCap;
}

/**
 * Reset the pool. Used by tests + benchmarks to start from a clean
 * state. Not part of the public API.
 *
 * @internal
 */
export function _resetPoolForTesting(): void {
  nextId = 0;
  freeIds.length = 0;
  capacity = INITIAL_CAPACITY;
  Pool.absCornersX = new Float64Array(INITIAL_CAPACITY);
  Pool.absCornersY = new Float64Array(INITIAL_CAPACITY);
}

/**
 * Inspect current pool state. Used by tests.
 * @internal
 */
export function _poolStats(): { capacity: number; nextId: number; freeCount: number } {
  return { capacity, nextId, freeCount: freeIds.length };
}
```

Design notes:

- `Pool` is a mutable object (not `const` exports per array). Lets us reassign on growth without `let` exports.
- `freeIds` is a stack — most-recently-recycled IDs are reused first (better cache locality).
- `FinalizationRegistry` callbacks fire at V8's discretion; not deterministic. IDs may accumulate before recycling, but `nextId` keeps moving so this isn't a correctness issue, just a memory tradeoff.
- Growth doubles capacity, copying existing data. Amortized O(1) per allocation.
- `_resetPoolForTesting` lets the test suite start each test with a fresh pool. Module-state pollution between tests is otherwise a real concern.

### `roundLayout` refactor

Current `round.ts` (post-phase-13) uses `Map<Node, AbsCorner>`:

```ts
const corners = new Map<Node, AbsCorner>();
// Pass 1: collect
collect(root, 0, 0);  // recurses pre-order; sets corners.set(node, {x, y}) per node
// Pass 2: apply
apply(root);  // recurses pre-order; reads corners.get(node)
```

Refactored to use `LayoutPool.absCornersX/Y`:

```ts
import { Pool } from './layout-pool.js';

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
  // ... existing rounding math, but read absX/absY from Pool not Map ...
}
```

Behavioral equivalence: the two passes still traverse pre-order; the only change is the storage of per-node absolute corners. Output is byte-identical.

Performance: probe-measured ~18µs improvement on 1k-node trees. Eliminates `new Map()` allocation per call + per-node `Map.set`/`Map.get` hash work.

### Files touched

```
packages/core/src/layout-pool.ts                     NEW    — LayoutPool + allocateNodeId
packages/core/src/layout-pool.test.ts                NEW    — pool sanity + ID recycling
packages/core/src/node.ts                            MODIFY — _id field + import
packages/core/src/algorithm/round.ts                 MODIFY — Map → Pool typed arrays
bench/RESULTS.md                                     REGEN  — confirms ~18µs improvement
```

## Risk model

| Risk | Likelihood | Mitigation |
|---|:-:|---|
| `FinalizationRegistry` timing causes test flakes (IDs not recycled before next test) | Low-Medium | `_resetPoolForTesting()` clears state at test boundaries. |
| Growth-on-demand allocates large Float64Arrays in production usage | Low | Initial 1024 is generous for most apps. Long-running TUIs unlikely to exceed 10k-20k live nodes. Growth amortizes. |
| V8 deoptimizes `Pool.absCornersX[id]` access (mutating property, not const binding) | Medium | Phase 15C measures both before + after; if V8 doesn't optimize, fall back to `let`-bound exports with reassignment. |
| `roundLayout` refactor changes traversal order subtly → divergence | Low | Same pre-order in both passes; differential mode catches any divergence. |
| Concurrent layout passes (impossible today but future-relevant) would collide in the shared pool | Low | Phase 15C makes no concurrency claims; layout is single-threaded today. |

## Validation plan

1. `pnpm typecheck`: clean.
2. `pnpm test`: 1448 pass + new tests for `layout-pool.ts`.
3. `pnpm test:differential`: 812 / 6 skipped (no regressions; `roundLayout` output unchanged).
4. Structural-differential fuzzer at numRuns=300: green.
5. Yoga oracle (33 fixtures): green.
6. `pnpm bench`: hot-* scenarios within variance; cold scenarios (especially stress/big/huge) showing ~5-15µs reduction from `roundLayout` refactor.

## Why this is the foundation for the rest of Phase 15

After 15C, every subsequent phase 15 sub-phase can use `Pool` for its own typed arrays:

- **15D** — `snapshotForCache` allocates a new `Float64Array` slice per non-leaf node using `Pool.childLayouts`. The biggest single perf lever (54% of huge's runtime).
- **15G** — `OmPriorityQueue` uses `Pool.omRanks` (integer-indexed PQ) replacing `Map<Field, OMNode>`. Reduces constant factors across hot scenarios.
- **15H** — Boundary-scoped Spineless grammar uses `Pool.boundaryIds` for fast lookup of which boundary a node belongs to.

Without `Node._id`, none of these can use typed arrays. Phase 15C is unblockingly foundational.

## Why no risk of memory leak

`FinalizationRegistry` is the V8-blessed pattern for tracking object lifetime without retaining references. Nodes that go out of scope are GC'd; their IDs are recycled; the pool stays bounded by max-live-node-count.

The pool's Float64Arrays grow to the high-water mark but never shrink. In a long-running app with peak usage of 50k nodes and steady state 5k, the pool stays at 64k capacity (next power of 2). Memory cost: 8 bytes × 64k × 2 arrays = 1MB. Acceptable.

If shrinking is needed (rare), `_resetPoolForTesting()` provides the mechanism; a future public `compactPool()` method could add it without changing the API surface.
