# Phase 15B — Selective dirty propagation infrastructure

## Context

Phase 15A profiling revealed that current "node-level dirty" propagation (`Node._dirty: boolean`) treats every style mutation the same. A `setWidth(40)` on an explicit-dim cell invalidates the same caches as a `setFlexDirection('row')` on a parent — yet they have entirely different downstream impacts.

**Phase 15B ships per-property dirty bits as the foundation for selective cache invalidation in subsequent sub-phases.** It is a structural change with no immediate perf delta; the perf wins land when 15C/D/E/G/H consume the new flags.

## Goal

Replace `Node._dirty: boolean` with `Node._dirtyFlags: number` (bitmask). Each style/structural mutation marks only the specific flags affected. Backward compatible: existing `isDirty()` reads `_dirtyFlags !== 0`; existing `markDirty()` semantics preserved as "all flags".

**Success criteria:**

1. New flag constants exported from `@pilates/core` `@internal`:
   - `DIRTY_STYLE_SIG` (layout-shape: flexDirection, flexWrap, justifyContent, alignItems, alignContent, alignSelf, positionType, display, aspectRatio)
   - `DIRTY_STYLE_VALUE` (explicit-dim values: width, height, minWidth/Height, maxWidth/Height, margin, padding, border, position[])
   - `DIRTY_FLEX_DISTRIBUTION` (flexGrow, flexShrink, flexBasis)
   - `DIRTY_MEASURE` (setMeasureFunc / clearMeasureFunc)
   - `DIRTY_MEASURE_CONTENT` (manual measure-cache invalidation hint, for consumers whose measure depends on external state)
   - `DIRTY_CHILDREN` (insertChild / removeChild / reorder)
2. `Node._dirtyFlags: number` field replaces `Node._dirty: boolean`.
3. `Node.isDirty()` returns `this._dirtyFlags !== 0` — bitwise unchanged from before.
4. New `Node.markDirtyFlag(flag: number): void` — sets the specific flag, propagates upward.
5. Existing `Node.markDirty()` calls `markDirtyFlag(DIRTY_ANY)` for back-compat.
6. Every existing style setter calls `markDirtyFlag(<specific flag>)`.
7. All existing tests + `pnpm test:differential` + structural-differential fuzzer green.

**Explicit non-goals (deferred to later phases):**

- Cache layer consuming flags. `LayoutCache.clear()` and `MeasureCache.clear()` still fire on every flag. Selective cache invalidation is Phase 15C/D.
- Propagation upward gaining flag-awareness. Current behavior: any dirty propagates up. Phase 15H may change this.
- Spineless grammar consuming flags. Current behavior unchanged.

## Architecture

### Flag constants

In a new file `packages/core/src/dirty-flags.ts`:

```ts
/**
 * Per-property dirty bits. Each mutation on a `Node` marks specific
 * flags rather than a generic boolean. Cache layers and incremental
 * engines consume these to skip invalidation when their inputs
 * didn't actually change.
 *
 * The flag set is intentionally small (one word fits in V8's
 * SMI representation); broad enough to cover every public Node
 * setter but no broader.
 *
 * @internal
 */
export const DIRTY_STYLE_SIG = 1 << 0;
export const DIRTY_STYLE_VALUE = 1 << 1;
export const DIRTY_FLEX_DISTRIBUTION = 1 << 2;
export const DIRTY_MEASURE = 1 << 3;
export const DIRTY_MEASURE_CONTENT = 1 << 4;
export const DIRTY_CHILDREN = 1 << 5;

export const DIRTY_ANY =
  DIRTY_STYLE_SIG |
  DIRTY_STYLE_VALUE |
  DIRTY_FLEX_DISTRIBUTION |
  DIRTY_MEASURE |
  DIRTY_MEASURE_CONTENT |
  DIRTY_CHILDREN;
```

### Flag-to-property mapping (the design decision matrix)

| Flag | Triggering setters | Why |
|---|---|---|
| `DIRTY_STYLE_SIG` | setFlexDirection, setFlexWrap, setJustifyContent, setAlignItems, setAlignContent, setAlignSelf, setPositionType, setDisplay, setAspectRatio, setOverflow | Changes the SHAPE of layout computation. Spineless grammar must rebuild on these. |
| `DIRTY_STYLE_VALUE` | setWidth, setHeight, setMinWidth, setMinHeight, setMaxWidth, setMaxHeight, setMargin, setPadding, setBorder, setPosition (edge), setGap | Changes computed values but not the algorithm's shape. Spineless can use incremental relayoutValues. |
| `DIRTY_FLEX_DISTRIBUTION` | setFlex, setFlexGrow, setFlexShrink, setFlexBasis | Changes parent's flex-line distribution. May affect siblings. |
| `DIRTY_MEASURE` | setMeasureFunc, clearMeasureFunc | Re-attaches the measure function pointer; invalidates measure cache. |
| `DIRTY_MEASURE_CONTENT` | (new public method) `invalidateMeasure()` | Consumer-driven: the measure function's external state changed. |
| `DIRTY_CHILDREN` | insertChild, removeChild, setChildren | Structural change; parent's child-list changed. |

### Node field changes

`Node._dirty: boolean` → `Node._dirtyFlags: number = 0`.

`Node.isDirty(): boolean` body becomes `return this._dirtyFlags !== 0;`.

New method `Node.markDirtyFlag(flag: number): void`:
```ts
markDirtyFlag(flag: number): void {
  this._dirtyFlags |= flag;
  this._measureCache?.clear();   // existing behavior preserved
  this._layoutCache?.clear();    // existing behavior preserved
  if (this._parent !== null && !this._parent._dirty) {
    this._parent.markDirtyFromChild(this);
  }
}
```

`Node.markDirty(): void` body becomes `this.markDirtyFlag(DIRTY_ANY);` — preserves all existing semantics.

`Node.markDirtyFromChild(child: Node): void` unchanged in body, but the parent now also accumulates flags from the child? **No — phase 15B preserves existing propagation behavior verbatim.** A child's dirty flags don't propagate as flags to the parent; the parent gets DIRTY_ANY for any descendant change. This is a deliberate scope-limit; Phase 15H may refine.

Actually, reconsidering: if the parent just sets its own `_dirty` (currently a boolean to be replaced), what flag does it set? **It sets DIRTY_ANY**, preserving existing semantics. Future phases will refine "what flag does a child's dirty mean for the parent."

### Files touched

```
packages/core/src/dirty-flags.ts                    NEW    — flag constants
packages/core/src/dirty-flags.test.ts               NEW    — flag bitmask sanity tests
packages/core/src/node.ts                           MODIFY — _dirty → _dirtyFlags, add markDirtyFlag()
packages/core/src/node.dirty-flags.test.ts          NEW    — verify setters mark correct flags
packages/core/src/index.ts                          MODIFY — export flags @internal
```

### Setter table (every setter that currently calls markDirty)

| Setter | Current line | Flag |
|---|:-:|---|
| setFlexDirection | 201 | DIRTY_STYLE_SIG |
| setFlexWrap | 209 | DIRTY_STYLE_SIG |
| setJustifyContent | 249 | DIRTY_STYLE_SIG |
| setAlignItems | 260 | DIRTY_STYLE_SIG |
| setAlignContent | (search) | DIRTY_STYLE_SIG |
| setAlignSelf | (search) | DIRTY_STYLE_SIG |
| setPositionType | (search) | DIRTY_STYLE_SIG |
| setDisplay | (search) | DIRTY_STYLE_SIG |
| setAspectRatio | (search) | DIRTY_STYLE_SIG |
| setOverflow | (search) | DIRTY_STYLE_SIG |
| setWidth, setHeight | 265, 293 | DIRTY_STYLE_VALUE |
| setMinWidth, setMinHeight | (search) | DIRTY_STYLE_VALUE |
| setMaxWidth, setMaxHeight | (search) | DIRTY_STYLE_VALUE |
| setMargin | (search) | DIRTY_STYLE_VALUE |
| setPadding | (search) | DIRTY_STYLE_VALUE |
| setBorder | (search) | DIRTY_STYLE_VALUE |
| setPosition (edge) | (search) | DIRTY_STYLE_VALUE |
| setGap | (search) | DIRTY_STYLE_VALUE |
| setFlex, setFlexGrow, setFlexShrink, setFlexBasis | (search) | DIRTY_FLEX_DISTRIBUTION |
| setMeasureFunc | (search) | DIRTY_MEASURE |
| insertChild, removeChild | 201, 209 | DIRTY_CHILDREN |

(The "search" lines indicate the implementer must locate the exact setter — there are ~30 setters total in node.ts; the implementer uses Grep to find all `markDirty()` call sites and updates each.)

## Risk model

| Risk | Likelihood | Mitigation |
|---|:-:|---|
| Setter missed in conversion → still calls `markDirty()` instead of `markDirtyFlag(X)` | Medium | Grep across `node.ts` for `markDirty()` call sites; manually verify each. Tests check each setter sets correct flag. |
| Existing consumers read `_dirty` field directly (not via `isDirty()`) → breaks when field renamed | Medium | Grep across `packages/` for `._dirty\b`. Replace direct reads with `isDirty()` calls or `_dirtyFlags !== 0` checks. |
| Cache layer consumers (LayoutCache, MeasureCache) need refactoring to use flags | Low (phase 15B doesn't change cache behavior) | Phase 15B explicitly keeps cache layer unchanged; cache `.clear()` still fires on every flag. |
| Bitmask operations have subtle bugs (off-by-one shifts, missing flag in DIRTY_ANY) | Low-Medium | `dirty-flags.test.ts` exhaustively verifies bitmask sanity. |
| Spineless engine reads `_dirty` to drive its classifier | High | Spineless's classifier already calls `isDirty()` (method, not field). Phase 14b's earlier work verified this. Just verify no `._dirty` direct reads. |

## Validation plan

1. `pnpm typecheck`: clean. Renaming `_dirty` → `_dirtyFlags` may surface direct-field-read consumers; they need updating.
2. `pnpm test`: 1432 pass. Setter-flag tests added.
3. `pnpm test:differential`: 803 pass / 6 skipped. Selective dirty doesn't change differential mode behavior.
4. Structural-differential fuzzer at numRuns=300: green. The fuzzer mutates randomly via Node setters and asserts cold-rebuild equivalence; with phase 15B's flag accumulation, the dirty state is equivalent.
5. Yoga oracle (33 fixtures): green. Unchanged.
6. `pnpm bench`: hot scenarios unchanged within variance (phase 15B has no perf delta yet).

## Why no perf win in phase 15B alone

Phase 15B is **architectural foundation**. It ships the API surface (`markDirtyFlag`, flag constants) and updates setters, but no cache layer or engine consumes the flag distinction yet. Performance is unchanged within bench variance.

The flags become *valuable* in:
- **15C** (SoA layout fields): `DIRTY_STYLE_VALUE` lets us zero only the value arrays, not the signature arrays.
- **15D** (flat `snapshotForCache`): only nodes with `DIRTY_CHILDREN` need full snapshot refresh; pure-value mutations skip.
- **15E** (Spineless fragment-build): `DIRTY_STYLE_SIG` triggers fragment rebuild; pure-value mutations stay incremental.
- **15G** (integer-indexed PQ): different priority queues per flag class.
- **15H** (boundary-scoped grammar): `DIRTY_STYLE_VALUE` on a boundary's child doesn't escape the boundary.

This is *precisely* what Yoga does internally — its `nodeMarkDirtyAndPropagate()` machinery has been per-flag for a decade. Pilates' adoption of the same pattern unlocks the rest of Phase 15.
