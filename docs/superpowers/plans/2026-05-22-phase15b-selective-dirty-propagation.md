# Phase 15B — Selective dirty propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use `- [ ]` for tracking.

**Goal:** Replace `Node._dirty: boolean` with `Node._dirtyFlags: number`; add `markDirtyFlag(flag)`; preserve backward compatibility (all existing tests green; no perf delta yet).

**Architecture:** New `dirty-flags.ts` module defines flag constants (`DIRTY_STYLE_SIG`, `DIRTY_STYLE_VALUE`, `DIRTY_FLEX_DISTRIBUTION`, `DIRTY_MEASURE`, `DIRTY_MEASURE_CONTENT`, `DIRTY_CHILDREN`, `DIRTY_ANY`). Node gets a bitmask field, a new method, and back-compat for existing `_dirty`/`markDirty()` semantics. Every setter updates to call `markDirtyFlag(<specific>)`.

**Tech Stack:** TypeScript 5.7 NodeNext ESM. Vitest. Bitmask operations. No new dependencies.

---

## File Structure

```
packages/core/src/dirty-flags.ts                     NEW  — flag constants
packages/core/src/dirty-flags.test.ts                NEW  — bitmask sanity tests
packages/core/src/node.ts                            MODIFY — _dirty → _dirtyFlags
packages/core/src/node.dirty-flags.test.ts           NEW  — per-setter flag tests
packages/core/src/index.ts                           MODIFY — export flags @internal
```

---

### Task 1: Flag constants + bitmask sanity

**Files:**
- Create: `packages/core/src/dirty-flags.ts`
- Create: `packages/core/src/dirty-flags.test.ts`

Pure module: 7 constants + bitmask sanity tests. No Node-coupling yet.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/dirty-flags.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  DIRTY_ANY,
  DIRTY_CHILDREN,
  DIRTY_FLEX_DISTRIBUTION,
  DIRTY_MEASURE,
  DIRTY_MEASURE_CONTENT,
  DIRTY_STYLE_SIG,
  DIRTY_STYLE_VALUE,
} from './dirty-flags.js';

describe('dirty-flags', () => {
  test('each flag is a distinct power of 2', () => {
    const flags = [
      DIRTY_STYLE_SIG,
      DIRTY_STYLE_VALUE,
      DIRTY_FLEX_DISTRIBUTION,
      DIRTY_MEASURE,
      DIRTY_MEASURE_CONTENT,
      DIRTY_CHILDREN,
    ];
    // Each is non-zero
    for (const f of flags) {
      expect(f).toBeGreaterThan(0);
    }
    // Each is a power of 2
    for (const f of flags) {
      expect(f & (f - 1)).toBe(0);
    }
    // All distinct
    const unique = new Set(flags);
    expect(unique.size).toBe(flags.length);
  });

  test('DIRTY_ANY is the OR of all flags', () => {
    const expected =
      DIRTY_STYLE_SIG |
      DIRTY_STYLE_VALUE |
      DIRTY_FLEX_DISTRIBUTION |
      DIRTY_MEASURE |
      DIRTY_MEASURE_CONTENT |
      DIRTY_CHILDREN;
    expect(DIRTY_ANY).toBe(expected);
  });

  test('bitmask operations work as expected', () => {
    let flags = 0;
    flags |= DIRTY_STYLE_VALUE;
    expect(flags & DIRTY_STYLE_VALUE).toBe(DIRTY_STYLE_VALUE);
    expect(flags & DIRTY_STYLE_SIG).toBe(0);
    flags |= DIRTY_CHILDREN;
    expect(flags & DIRTY_CHILDREN).toBe(DIRTY_CHILDREN);
    expect(flags & DIRTY_STYLE_VALUE).toBe(DIRTY_STYLE_VALUE);
    expect(flags).toBe(DIRTY_STYLE_VALUE | DIRTY_CHILDREN);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @pilates/core test -- dirty-flags.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `dirty-flags.ts`**

Create `packages/core/src/dirty-flags.ts`:

```ts
/**
 * Per-property dirty bits. Each mutation on a `Node` marks specific
 * flags rather than a generic boolean. Cache layers and incremental
 * engines consume these to skip invalidation when their inputs
 * didn't actually change.
 *
 * The flag set is intentionally small (one word fits in V8's SMI
 * representation); broad enough to cover every public Node setter
 * but no broader.
 *
 * Used by `Node._dirtyFlags`, `Node.markDirtyFlag()`, and the cache
 * + incremental layers consuming these flags in subsequent phases.
 *
 * @internal
 */

/** Layout-shape mutations (flexDirection, wrap, justify, align, display, ...). */
export const DIRTY_STYLE_SIG = 1 << 0;

/** Explicit-dimension values (width, height, margin, padding, border, position). */
export const DIRTY_STYLE_VALUE = 1 << 1;

/** Flex-distribution parameters (flexGrow, flexShrink, flexBasis). */
export const DIRTY_FLEX_DISTRIBUTION = 1 << 2;

/** Measure function attached or detached. */
export const DIRTY_MEASURE = 1 << 3;

/** Manual measure-cache invalidation (consumer-driven). */
export const DIRTY_MEASURE_CONTENT = 1 << 4;

/** Children list mutation (insert / remove / reorder). */
export const DIRTY_CHILDREN = 1 << 5;

/** All flags ORed together. Used by back-compat `markDirty()`. */
export const DIRTY_ANY =
  DIRTY_STYLE_SIG |
  DIRTY_STYLE_VALUE |
  DIRTY_FLEX_DISTRIBUTION |
  DIRTY_MEASURE |
  DIRTY_MEASURE_CONTENT |
  DIRTY_CHILDREN;
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @pilates/core test -- dirty-flags.test`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/dirty-flags.ts packages/core/src/dirty-flags.test.ts
git commit -m "$(cat <<'EOF'
phase 15B: dirty-flags.ts — per-property dirty bitmask constants

Six flags + DIRTY_ANY aggregate. Foundation for selective cache
invalidation in subsequent phase 15 sub-phases. No Node coupling
yet; pure module.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `Node._dirtyFlags` + `markDirtyFlag()` + back-compat

**Files:**
- Modify: `packages/core/src/node.ts`

Replace `_dirty: boolean` with `_dirtyFlags: number`. Add `markDirtyFlag(flag)`. Preserve `markDirty()` semantics via `markDirtyFlag(DIRTY_ANY)`.

- [ ] **Step 1: Inventory current `_dirty` usage**

Run: `grep -n "_dirty\b" packages/core/src/node.ts | head -30`

Locate:
- The field declaration (`private _dirty: boolean = ...` or similar).
- `isDirty()` method body.
- `markDirty()` method body.
- `markDirtyFromChild()` method body.
- Any other readers/writers.

- [ ] **Step 2: Modify the field**

Change the field from:
```ts
private _dirty: boolean = true; // or similar
```
to:
```ts
/** Bitmask of `DIRTY_*` flags. Non-zero means this node is dirty. */
private _dirtyFlags: number = 0;
```

(Note initial value: a freshly-constructed Node has `_dirtyFlags = 0`. Previously, freshly-constructed Nodes were dirty. Check the constructor for explicit `markDirty()` calls — preserve that behavior by setting `_dirtyFlags = DIRTY_ANY` in the constructor if applicable. Confirm by reading current Node constructor.)

If the current code uses `this._dirty = true` anywhere, change to `this._dirtyFlags = DIRTY_ANY` (or `|=` the relevant flag if context is clearer).

- [ ] **Step 3: Update `isDirty()`**

```ts
isDirty(): boolean {
  return this._dirtyFlags !== 0;
}
```

- [ ] **Step 4: Add `markDirtyFlag()` + update `markDirty()`**

Add new public method (place near existing `markDirty`):

```ts
/**
 * Set specific dirty flag(s) on this node. Propagates upward
 * through ancestors. Used by individual setters to indicate the
 * granular nature of the change; cache layers consume the flag
 * to decide whether to invalidate.
 *
 * @internal
 */
markDirtyFlag(flag: number): void {
  this._dirtyFlags |= flag;
  this._measureCache?.clear();
  this._layoutCache?.clear();
  if (this._parent !== null && !this._parent._dirty) {
    this._parent.markDirtyFromChild(this);
  }
}
```

Wait — `this._parent._dirty` won't compile after we rename. Use `this._parent.isDirty()` or `this._parent._dirtyFlags !== 0`. Pick the equivalent. Both work; `isDirty()` is the public API path, `_dirtyFlags` is direct field. Direct field is faster (no method call); since this is `@internal` performance-sensitive code, use the direct field check:

```ts
if (this._parent !== null && this._parent._dirtyFlags === 0) {
  this._parent.markDirtyFromChild(this);
}
```

Update existing `markDirty()`:

```ts
markDirty(): void {
  this.markDirtyFlag(DIRTY_ANY);
}
```

Import `DIRTY_ANY` at the top of `node.ts`:

```ts
import { DIRTY_ANY } from './dirty-flags.js';
```

- [ ] **Step 5: Update `markDirtyFromChild`**

Currently `markDirtyFromChild(child)` sets `_dirty = true`; change to:

```ts
markDirtyFromChild(child: Node): void {
  // ...existing relayout-boundary checks unchanged...
  this._dirtyFlags |= DIRTY_ANY;  // preserves existing semantics: a child mutation dirties parent fully
  // ...existing propagation logic unchanged...
}
```

(Phase 15H will refine to "propagate only relevant flags" — for now preserve.)

- [ ] **Step 6: Run all core tests — regression net**

Run: `pnpm --filter @pilates/core test`
Expected: ALL existing tests pass (no behavior change since `DIRTY_ANY` is the same as setting `_dirty = true` was).

If any test fails: a consumer was reading `._dirty` directly. Find via grep + replace with `.isDirty()` or `._dirtyFlags !== 0`.

- [ ] **Step 7: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. May surface direct `._dirty` reads in `packages/core/src/algorithm/`.

If typecheck flags `._dirty`-direct reads anywhere: replace each with `._dirtyFlags !== 0` (for performance equivalence). Do NOT change to method calls (`.isDirty()`) in hot paths — that's a perf regression.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/node.ts
git commit -m "$(cat <<'EOF'
phase 15B: Node._dirty → _dirtyFlags bitmask + markDirtyFlag()

Replaces the boolean _dirty field with a numeric bitmask of
DIRTY_* flags from dirty-flags.ts. New markDirtyFlag(flag) method
sets specific flags + propagates upward. Existing markDirty()
becomes a thin wrapper calling markDirtyFlag(DIRTY_ANY) for
backward compatibility.

isDirty() body becomes _dirtyFlags !== 0 — bitwise unchanged from
before. All existing consumers continue to work.

No perf delta yet; the flags become valuable when subsequent
phase-15 sub-phases consume them in cache/engine layers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Update setters to use specific flags

**Files:**
- Modify: `packages/core/src/node.ts`
- Create: `packages/core/src/node.dirty-flags.test.ts`

Every existing `markDirty()` call inside a setter changes to `markDirtyFlag(<specific flag>)`. Each setter gets a unit test verifying it sets the correct flag.

- [ ] **Step 1: Inventory setters**

Run: `grep -n "this.markDirty()" packages/core/src/node.ts | head -40`

For each line, identify the setter (or method) it belongs to. Map each to the appropriate flag per the spec's flag-to-property table.

- [ ] **Step 2: Write failing tests**

Create `packages/core/src/node.dirty-flags.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  DIRTY_CHILDREN,
  DIRTY_FLEX_DISTRIBUTION,
  DIRTY_MEASURE,
  DIRTY_STYLE_SIG,
  DIRTY_STYLE_VALUE,
} from './dirty-flags.js';
import { Node } from './node.js';

function freshNode(): Node {
  const n = Node.create();
  // Newly-created Nodes are dirty by default; clear flags for a known starting state.
  // The test exercise: from a "clean" state, mutate one property, observe the flag.
  // Some setters early-exit if the value is unchanged; choose mutation values that differ from defaults.
  // (Implementer: if Node doesn't have a clean-flags method, you may need to do a fake calculateLayout
  // first, OR access `_dirtyFlags` directly to reset — pick whichever is feasible.)
  (n as unknown as { _dirtyFlags: number })._dirtyFlags = 0;
  return n;
}

function flags(n: Node): number {
  return (n as unknown as { _dirtyFlags: number })._dirtyFlags;
}

describe('Node setters mark specific dirty flags (phase 15B)', () => {
  test('setFlexDirection marks DIRTY_STYLE_SIG', () => {
    const n = freshNode();
    n.setFlexDirection('row'); // assume default is 'column' or similar; pick a different value
    expect(flags(n) & DIRTY_STYLE_SIG).toBe(DIRTY_STYLE_SIG);
    // Pure SIG mutation should NOT mark STYLE_VALUE etc.
    expect(flags(n) & DIRTY_STYLE_VALUE).toBe(0);
    expect(flags(n) & DIRTY_FLEX_DISTRIBUTION).toBe(0);
  });

  test('setWidth marks DIRTY_STYLE_VALUE', () => {
    const n = freshNode();
    n.setWidth(50);
    expect(flags(n) & DIRTY_STYLE_VALUE).toBe(DIRTY_STYLE_VALUE);
    expect(flags(n) & DIRTY_STYLE_SIG).toBe(0);
  });

  test('setHeight marks DIRTY_STYLE_VALUE', () => {
    const n = freshNode();
    n.setHeight(50);
    expect(flags(n) & DIRTY_STYLE_VALUE).toBe(DIRTY_STYLE_VALUE);
  });

  test('setFlex marks DIRTY_FLEX_DISTRIBUTION', () => {
    const n = freshNode();
    n.setFlex(1);
    expect(flags(n) & DIRTY_FLEX_DISTRIBUTION).toBe(DIRTY_FLEX_DISTRIBUTION);
    expect(flags(n) & DIRTY_STYLE_SIG).toBe(0);
    expect(flags(n) & DIRTY_STYLE_VALUE).toBe(0);
  });

  test('setFlexGrow marks DIRTY_FLEX_DISTRIBUTION', () => {
    const n = freshNode();
    n.setFlexGrow(2);
    expect(flags(n) & DIRTY_FLEX_DISTRIBUTION).toBe(DIRTY_FLEX_DISTRIBUTION);
  });

  test('setJustifyContent marks DIRTY_STYLE_SIG', () => {
    const n = freshNode();
    n.setJustifyContent('center');
    expect(flags(n) & DIRTY_STYLE_SIG).toBe(DIRTY_STYLE_SIG);
  });

  test('setAlignItems marks DIRTY_STYLE_SIG', () => {
    const n = freshNode();
    n.setAlignItems('center');
    expect(flags(n) & DIRTY_STYLE_SIG).toBe(DIRTY_STYLE_SIG);
  });

  test('setMargin marks DIRTY_STYLE_VALUE', () => {
    const n = freshNode();
    n.setMargin('all', 5);
    expect(flags(n) & DIRTY_STYLE_VALUE).toBe(DIRTY_STYLE_VALUE);
  });

  test('setPadding marks DIRTY_STYLE_VALUE', () => {
    const n = freshNode();
    n.setPadding('all', 5);
    expect(flags(n) & DIRTY_STYLE_VALUE).toBe(DIRTY_STYLE_VALUE);
  });

  test('setMeasureFunc marks DIRTY_MEASURE', () => {
    const n = freshNode();
    n.setMeasureFunc(() => ({ width: 10, height: 1 }));
    expect(flags(n) & DIRTY_MEASURE).toBe(DIRTY_MEASURE);
  });

  test('insertChild marks DIRTY_CHILDREN on parent', () => {
    const parent = freshNode();
    const child = Node.create();
    parent.insertChild(child, 0);
    expect(flags(parent) & DIRTY_CHILDREN).toBe(DIRTY_CHILDREN);
  });

  test('removeChild marks DIRTY_CHILDREN on parent', () => {
    const parent = freshNode();
    const child = Node.create();
    parent.insertChild(child, 0);
    // Reset after insertChild
    (parent as unknown as { _dirtyFlags: number })._dirtyFlags = 0;
    parent.removeChild(child);
    expect(flags(parent) & DIRTY_CHILDREN).toBe(DIRTY_CHILDREN);
  });

  test('multiple setters accumulate flags', () => {
    const n = freshNode();
    n.setWidth(50);
    n.setFlexDirection('row');
    n.setFlex(2);
    expect(flags(n) & DIRTY_STYLE_VALUE).toBe(DIRTY_STYLE_VALUE);
    expect(flags(n) & DIRTY_STYLE_SIG).toBe(DIRTY_STYLE_SIG);
    expect(flags(n) & DIRTY_FLEX_DISTRIBUTION).toBe(DIRTY_FLEX_DISTRIBUTION);
  });
});
```

- [ ] **Step 3: Run tests — verify they fail**

Run: `pnpm --filter @pilates/core test -- node.dirty-flags.test`
Expected: FAIL — setters still use `markDirty()` (which sets DIRTY_ANY, not specific flags). Tests will see all flags set on every setter, failing the "pure SIG mutation should NOT mark STYLE_VALUE" assertions.

- [ ] **Step 4: Update setters**

In `packages/core/src/node.ts`, find every `this.markDirty()` inside a setter. Replace each with `this.markDirtyFlag(<flag>)` per the spec's mapping.

The spec's flag-to-property table:

```
DIRTY_STYLE_SIG:        setFlexDirection, setFlexWrap, setJustifyContent,
                        setAlignItems, setAlignContent, setAlignSelf,
                        setPositionType, setDisplay, setAspectRatio, setOverflow
DIRTY_STYLE_VALUE:      setWidth, setHeight, setMinWidth, setMinHeight,
                        setMaxWidth, setMaxHeight, setMargin, setPadding,
                        setBorder, setPosition (edge), setGap
DIRTY_FLEX_DISTRIBUTION: setFlex, setFlexGrow, setFlexShrink, setFlexBasis
DIRTY_MEASURE:          setMeasureFunc
DIRTY_CHILDREN:         insertChild, removeChild
```

(If any setter doesn't match these — e.g., a setter the spec missed — use judgment: if the setter changes layout shape, use DIRTY_STYLE_SIG; if it changes a computed value, use DIRTY_STYLE_VALUE. Add a note in the commit if you encounter a setter not in the spec.)

- [ ] **Step 5: Run setter tests — verify they pass**

Run: `pnpm --filter @pilates/core test -- node.dirty-flags.test`
Expected: all tests pass.

- [ ] **Step 6: Run full core suite — regression net**

Run: `pnpm --filter @pilates/core test`
Expected: all existing tests pass + 13 new setter tests pass = 822+ tests.

- [ ] **Step 7: Run lint + typecheck**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/node.ts packages/core/src/node.dirty-flags.test.ts
git commit -m "$(cat <<'EOF'
phase 15B: setters call markDirtyFlag with specific flags

Every Node setter that previously called this.markDirty() now calls
this.markDirtyFlag(<specific flag>) per the spec's flag-to-property
mapping. setWidth/setHeight/setMargin/setPadding etc → STYLE_VALUE;
setFlexDirection/setJustify etc → STYLE_SIG; setFlex/setFlexGrow etc
→ FLEX_DISTRIBUTION; setMeasureFunc → MEASURE; insertChild /
removeChild → CHILDREN.

13 unit tests verify each setter sets its expected flag and ONLY
that flag (within its category). Multiple-setter sequences correctly
accumulate flags via bitwise OR.

No behavior change yet — DIRTY_ANY is set on the parent via
markDirtyFromChild propagation, preserving existing semantics for
cache invalidation and ancestor walks. Cache/engine layers consuming
the granular flags lands in phase 15C-H.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Export flags `@internal` + full validation

**Files:**
- Modify: `packages/core/src/index.ts`

Make the flag constants discoverable from `@pilates/core` for in-workspace consumers (algorithm/, future Spineless integration). External package consumers (npm) don't see `@internal` exports.

- [ ] **Step 1: Find current `@internal` exports**

Read `packages/core/src/index.ts`. Look for the section exporting `@internal` symbols.

- [ ] **Step 2: Re-export flag constants**

Add:

```ts
export {
  DIRTY_ANY,
  DIRTY_CHILDREN,
  DIRTY_FLEX_DISTRIBUTION,
  DIRTY_MEASURE,
  DIRTY_MEASURE_CONTENT,
  DIRTY_STYLE_SIG,
  DIRTY_STYLE_VALUE,
} from './dirty-flags.js';
```

(Follow the file's existing convention for grouping `@internal` exports.)

- [ ] **Step 3: Run all validation gates**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:differential`
Expected: all green. The structural-differential fuzzer also runs as part of `pnpm test` — verify it passes.

- [ ] **Step 4: Run Yoga oracle**

Run: `pnpm --filter @pilates/core test -- yoga-oracle`
Expected: 33 pass.

- [ ] **Step 5: Run bench (no perf delta expected)**

Run: `pnpm bench`
Expected: numbers within ±5% of pre-15B values (phase 15B is foundation; no perf delta yet).

Compare `bench/RESULTS.md` to the previous run. If any scenario shifted by > 5%, investigate — the flag refactor may have introduced a hot-path call-site regression.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts bench/RESULTS.md
git commit -m "$(cat <<'EOF'
phase 15B: export DIRTY_* flags @internal + refresh bench

Flag constants reachable from @pilates/core for the algorithm/ and
spineless/ modules to consume in subsequent phase-15 sub-phases.

bench/RESULTS.md refreshed; numbers within variance of pre-15B —
phase 15B is foundation, no perf delta yet (the flag refactor is
bitwise-equivalent to the existing _dirty boolean).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Flag constants: Task 1. ✓
- Node._dirtyFlags field: Task 2. ✓
- markDirtyFlag method: Task 2. ✓
- Back-compat markDirty(): Task 2 Step 4. ✓
- isDirty() body update: Task 2 Step 3. ✓
- Every setter updated: Task 3. ✓
- Per-setter tests: Task 3 Step 2 (13 tests). ✓
- Export @internal: Task 4. ✓
- Full validation: Task 4 Step 3. ✓
- Bench sanity (no perf delta): Task 4 Step 5. ✓

**Placeholder scan:**
- Task 3 Step 4 says "If any setter doesn't match these — use judgment" — acceptable. The flag-to-property mapping in the spec is comprehensive; "judgment" is for the rare edge case the spec doesn't enumerate.
- No "TBD" / "TODO" / "implement later".

**Type / name consistency:**
- `DIRTY_*` constants: defined in dirty-flags.ts, consumed by name in Node, test files, and index.ts re-export. All same casing.
- `_dirtyFlags` field name: consistent across Node, tests, all readers.
- `markDirtyFlag` method name: consistent.
- `isDirty()` return type: `boolean`, unchanged.

No gaps or inconsistencies.
