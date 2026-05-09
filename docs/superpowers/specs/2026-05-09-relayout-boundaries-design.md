# Relayout Boundaries Design (Phase 3)

**Date:** 2026-05-09
**Branch:** `perf-relayout-boundaries` (not yet created)
**Status:** Approved — ready for implementation plan
**Predecessor:** Phase 2 (`docs/superpowers/specs/2026-05-08-perf-hardening-design.md`) shipped the layout cache; the hot-relayout bench documented that Yoga still wins ~2.5× on persistent-tree-mutate-one-leaf workloads. Phase 3 closes that gap.

---

## Overview

Add Flutter-style relayout boundaries to `@pilates/core`. A node with explicit `width` AND explicit `height` becomes a "layout boundary" — when any descendant calls `markDirty()`, propagation walks up only as far as the boundary, then stops. The boundary itself goes dirty (its `_layoutCache` clears); ancestors stay clean (their caches stay valid).

This makes Phase 2's per-node `LayoutCache` actually pay off on the hot-relayout workload: with boundaries, a leaf mutation no longer dirties root, root's cache hits, and only the boundary's subtree re-runs flex on the next `calculateLayout`.

### Scope

- Auto-detected boundaries (no opt-in API): explicit width AND explicit height.
- `markDirty()` short-circuits at boundaries.
- `_forceDirty()` `@internal` method bypasses the boundary check (used by differential-mode validation infrastructure to compute the cold path).
- New unit tests covering boundary semantics.
- New `hot-relayout-boundary` bench scenario demonstrating the win.

### Out of scope

- `aspectRatio`-derived implicit boundary (when only one axis is explicit but aspect-ratio fixes the other). Future improvement.
- Flutter's full `parentUsesSize == false` semantics. Would require constraint-propagation tracking we don't have.
- Opt-in `setLayoutBoundary(true)` API. Defer until someone asks.
- Diagnostics ("this tree has N boundaries"). Defer.

---

## Architecture

### Files to modify

| File | Change |
|---|---|
| `packages/core/src/node.ts` | Add private `isLayoutBoundary()` method (two `typeof` checks). Modify `markDirty()` to stop at boundaries. Add `@internal` `_forceDirty()` that bypasses the check. |
| `packages/core/src/algorithm/cache.ts` | Modify `markDirtyDeep` to use `_forceDirty()` instead of `markDirty()` so the differential-mode infrastructure can re-dirty across boundaries. |
| `packages/core/src/node.test.ts` | New `Node — relayout boundary semantics` describe block, 5 tests. |
| `packages/core/src/algorithm/cache.invariants.test.ts` | Add 1 test: layout cache hits at root after descendant mutation under a boundary. |
| `bench/scenarios/hot-relayout-boundary.ts` (NEW) | Same shape as `hot-relayout.ts`, but row containers have explicit width+height (`setWidth(COLS).setHeight(ROWS / ROW_COUNT)`). |
| `bench/index.ts` | Register the new scenario. |
| `bench/thresholds.json` | Add a threshold for the new scenario. |
| `packages/core/CHANGELOG.md` | `## Unreleased` Phase 3 entry. |

### No public API change

`Node.isLayoutBoundary()` is `private`. `_forceDirty()` is `@internal` JSDoc-tagged. Both stripped from published `.d.ts` by existing tsconfig.

---

## Boundary semantics

### Definition

```ts
private isLayoutBoundary(): boolean {
  return typeof this._style.width === 'number'
      && typeof this._style.height === 'number';
}
```

A node is a boundary iff both width AND height are explicit numbers (not `'auto'`).

### Why this is sufficient

The boundary's job is to guarantee that descendant mutations cannot affect ancestors. That requires the boundary's size to be independent of its descendants' sizes.

With explicit width AND height:
- The flex algorithm's `resolveHypotheticalMainSize` and `naturalCrossSize` honor explicit values directly (verified in `algorithm/main-axis.ts`).
- `flexGrow` may expand the node when there's free space, but that's PARENT state, not descendant state. When a descendant mutates without dirtying the parent, the parent's flex distribution result stays the same → the boundary's actual size stays the same.
- `flexShrink` may shrink the node when the container overflows, but again, that's parent state, not descendant state.
- Parent's `scrollWidth`/`scrollHeight` use children's `left + width` (not children's scrollWidth), so they don't depend on the boundary's scroll state.

Therefore: when a descendant of the boundary mutates without dirtying the parent, the parent's complete layout result (its own `_layout` and all `childLayouts`) stays valid.

### Modified `markDirty()`

```ts
markDirty(): void {
  this._dirty = true;
  this._measureCache?.clear();
  this._layoutCache?.clear();
  // Stop at relayout boundaries — see Phase 3 spec for why explicit
  // width+height makes the boundary's size independent of descendant
  // changes, so the parent's flex result stays valid and ancestor
  // caches remain correct.
  if (this.isLayoutBoundary()) return;
  if (this._parent !== null && !this._parent._dirty) this._parent.markDirty();
}
```

Three lines added. Negligible hot-path cost (one call to a method that does two `typeof` checks).

### `_forceDirty()` — bypass for validation infra

```ts
/**
 * Set dirty + clear caches + propagate up unconditionally, bypassing
 * the layout-boundary short-circuit in `markDirty()`. Used only by
 * `markDirtyDeep` in `algorithm/cache.ts` for differential-mode and
 * fuzzer validation.
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

Used in `cache.ts`:

```ts
export function markDirtyDeep(root: Node): void {
  root._forceDirty();
  for (let i = 0; i < root.getChildCount(); i++) markDirtyDeep(root.getChild(i)!);
}
```

---

## Edge cases (resolved during design)

1. **`flexGrow > 0` on a boundary** — fine. Growth is parent-driven, not descendant-driven. Not a boundary issue.

2. **`overflow: scroll` on a boundary** — fine. Boundary's `scrollWidth/Height` recomputes when its subtree re-runs cold (boundary itself is dirty). Above the boundary, ancestors' `scrollWidth/Height` use children's `left + width`, which don't change.

3. **`position: absolute` children** — already isolated from siblings via the absolute-layout path. If the absolute child has explicit width+height, it's also a boundary. Compose well; no special handling.

4. **Toggling boundary status (`setWidth(N)` → `setWidth('auto')`)** — the setter calls `markDirty()` AFTER updating `_style.width`. The new value is what `isLayoutBoundary()` reads, so the change correctly takes effect on this very call.

5. **First `calculateLayout` after construction** — `_dirty = true` from construction, so the first pass is cold regardless. No special handling.

6. **`markDirtyDeep` interaction** — addressed by `_forceDirty()` (above).

7. **Measure-leaf with explicit width+height** — the measure-func wouldn't actually be invoked because explicit sizes take precedence in `resolveHypotheticalMainSize`. The leaf is still a boundary by our rule. Semantically correct (the measure-func's would-be result is irrelevant).

8. **`aspectRatio` with one explicit axis** — strict rule misses this case. Treated as "not a boundary." Missed optimization, not a correctness bug. Future-improvement candidate.

---

## Testing strategy

### Layer 1: Boundary unit tests (`node.test.ts`)

5 deterministic tests in a new `Node — relayout boundary semantics` describe block:

1. Node with explicit width AND height stops dirty propagation.
2. Node with only one axis explicit propagates dirty up (NOT a boundary).
3. Toggling from explicit to `'auto'` removes the boundary.
4. Absolute-positioned boundary still acts as a boundary.
5. `_forceDirty()` bypasses the boundary check.

### Layer 2: Cache invariant test (`cache.invariants.test.ts`)

1 deterministic test: layout cache hits at root after descendant mutation under a boundary. Proves the optimization actually fires.

### Layer 3: Differential mode + fuzzer

Run unchanged. The existing fuzzer's `nodeSpecArbitrary` produces ~25% of nodes with explicit width+height; with 500 runs × ~50 nodes/tree, that's thousands of boundary-bearing trees per CI run. Differential mode catches any missed-invalidation bug as soon as it ships.

`markDirtyDeep` switching to `_forceDirty()` is the only change to the fuzzer's environment.

### Layer 4: Bench validation

`bench/scenarios/hot-relayout-boundary.ts` — same shape as `hot-relayout.ts` but with explicit-sized row containers. The Phase 3 win is "this scenario significantly beats `hot-relayout`" (and ideally beats Yoga's `hot-relayout` number). If it doesn't, the work hasn't paid off — revert before merging.

---

## Public API

**Zero changes.** No new public methods, no new public types, no behavior change visible to consumers. Boundaries are auto-detected from existing style.

`Node.isLayoutBoundary()` is `private`. `Node._forceDirty()` is `@internal`. Both stripped from published `.d.ts`.

---

## Observability

The existing `_layoutCache.hits` / `_layoutCache.misses` counters automatically reflect Phase 3's effect — boundary-protected subtrees produce more root cache hits, surfacing as higher `hits` in bench output. No new counters.

---

## Error handling

No error path inside the boundary check. The method is two `typeof` checks; both always succeed.

`_forceDirty` cannot fail (same as `markDirty`).

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Boundary applied incorrectly — descendant mutation should have dirtied parent but didn't | Medium | High | Differential mode + fuzzer + dedicated unit tests |
| `markDirtyDeep` forgets to bypass boundaries → false negatives on cache divergences | Low | High | Test 5 in unit suite explicitly verifies `_forceDirty` bypass |
| `flexShrink` on a boundary changes its size unexpectedly | Low | Medium | Documented as parent-driven, not descendant-driven |
| `aspectRatio` opportunity missed (one axis explicit + aspect-ratio derives the other) | Low | Low | Out of scope; future improvement |
| Phase 3 doesn't measurably improve hot-relayout in practice | Medium | Low | New bench scenario is the validation; revert if no win |
| TUI consumers don't actually use explicit width+height | Medium | Low | Cost of adding boundaries is tiny; opportunistic benefit |

---

## Realistic effort

- Core implementation: ~3hr
- Unit tests + invariant test: ~2hr
- Bench scenario + threshold: ~2hr
- CHANGELOG, PR, validation: ~1hr

Total: **~8hr**, much smaller than Phase 1 (~17hr) or Phase 2 (~16hr) because the validation infrastructure (differential mode + fuzzer + bench harness + perf budgets) already exists from Phase 1+2 and is leveraged unchanged.

---

## Phase delivery sequence

Single PR (`perf-relayout-boundaries` branch). Tasks:

1. Add `isLayoutBoundary()` + `_forceDirty()` to `Node`. Modify `markDirty()`.
2. Update `markDirtyDeep` in `cache.ts` to use `_forceDirty()`.
3. Add 5 unit tests + 1 invariant test.
4. Add `hot-relayout-boundary.ts` bench scenario + register + threshold.
5. CHANGELOG entry.
6. Run full CI + bench locally; push; open PR.

PR squash-merges to `main`. After merge, `@pilates/core` gets a minor bump in the next promotion bundle.
