# Root Auto-Cross-Axis Sizing — Design

**Status:** approved (design phase)
**Date:** 2026-05-26
**Branch:** `fix/root-auto-cross-axis`
**Tracking:** partial fix for issue #157 (root-only path). Inner-container path stays open as the architectural Path B follow-up.

## Goal

When a root flex container has `style.{width|height}: 'auto'` AND no `available.{width|height}` was passed to `calculateLayout`, set the root's `_layout.{width|height}` to the content-derived size (sum of in-flow children's extent + padding-end), clamped by min/max. Closes the root half of issue #157 and unblocks ~8–9 deferred fixtures from PR #156.

Matches Yoga 3.x behavior for the same inputs.

## Non-goals

- **Inner container auto-cross.** A non-root container with `style.{cross}: 'auto'` reported through `naturalCrossSize` at `main-axis.ts:1006` still returns 0. That requires a two-phase recursion model (Path B in issue #157's investigation). This PR closes only the root path; issue #157 stays open with the scope narrowed.
- **Auto-MAIN-axis at root.** For a root with `flexDirection: 'row'` and `width: 'auto'`, the main-axis fallback (no available width) currently returns 0. This PR also closes that, because the post-step is symmetric across axes. If the user wants the change scoped to cross-only, that's a one-line tweak — but symmetric is cleaner and matches Yoga.
- **Aspect-ratio interaction.** The post-step only fires when `rootAxisIsBareZero` is true; aspect-ratio derivation already takes precedence (effectivePreferredSize returns non-null), so this PR doesn't touch that path.

## Behavior

For each axis (row=width, column=height), AFTER `layoutChildren(root)` writes children's positions:

1. Check `rootAxisIsBareZero(root, axis, available)`:
   - `root.style[axisSize] === 'auto'`, AND
   - `available[axis] === undefined`, AND
   - aspect-ratio doesn't derive this axis from the other.
2. If true:
   - Walk in-flow children (`positionType !== 'absolute'` AND `display !== 'none'`).
   - For each, take the child's outer-edge on this axis: `child.layout.left + child.layout.width` for row, `child.layout.top + child.layout.height` for column.
   - Compute `extent = max(outer-edges, 0)`.
   - Add `padEnd` to get the root's outer extent: `extent + padEnd`. (Children's positions already include padStart from the flex pipeline's step 8.)
   - Apply min/max clamp: `final = clamp(extent + padEnd, minStyle, maxStyle ?? Infinity)`.
   - Write to `root._layout.{width|height}` AND `root._floatWidth/_floatHeight` if applicable.

If the root has no in-flow children, `extent = 0`, and the clamp may still produce a non-zero size from minStyle (e.g. `minHeight: 50` → root height = 50). That matches Yoga.

## Where the fix lives

**Single engine-agnostic post-step**, in `calculateLayoutImpl` (`packages/core/src/algorithm/index.ts`), after the engine's `layoutChildren(root)` call AND BEFORE `roundLayout`. Reason: both classic and spineless engines write to `node._layout` at the end of their respective pipelines; the post-step reads from `_layout` and writes back to `_layout`, so it's engine-agnostic and runs once.

Function signature:

```ts
function autoSizeRootFromContent(
  root: Node,
  available: { width?: number; height?: number } | undefined,
): void;
```

Uses existing helpers:
- `effectivePreferredSize` from `main-axis.ts` (to detect 'auto').
- `aspectDerivable` (already private in main-axis.ts; may need to export).
- `clampSize` (already exported from main-axis.ts).

## Files

| Path | Change |
|---|---|
| `packages/core/src/algorithm/index.ts` | call `autoSizeRootFromContent` after `layoutChildren(root)`, before `roundLayout`. |
| `packages/core/src/algorithm/main-axis.ts` | new private `autoSizeRootFromContent`; export `aspectDerivable` if needed for the bare-zero predicate. |
| `packages/core/src/algorithm/layout.test.ts` | 5 new unit tests (see below). |
| `packages/core/test/fixtures/flex-wrap/*.spec.json` | port the ~8 root-only fixtures from PR #156's deferred list. |

## Tests

### Unit tests (`layout.test.ts`)

```ts
describe('root auto cross-axis sizing', () => {
  it('non-wrap row sums child height into auto root height', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(100);
    const kid = Node.create();
    kid.setWidth(30); kid.setHeight(30);
    root.insertChild(kid, 0);
    root.calculateLayout();
    expect(root.getComputedLayout().height).toBe(30);
  });

  it('non-wrap column sums child width into auto root width', () => {
    // mirror of above with axes swapped
  });

  it('wrap row sums all wrapped lines into auto root height', () => {
    // 4 children width=30 in width=100 → 2 lines of height 30 → root height 60
  });

  it('root padding is included in auto-sum', () => {
    // root with paddingAll: 5, width: 100, one child 30x30 → height = 30 + 10
  });

  it('minHeight clamps auto-sum upward', () => {
    // root with width: 100, minHeight: 50, no children → height = 50
  });
});
```

### Fixture corpus

Reinstate from PR #156's deferred list the root-only fixtures (root has `width` only, OR `height` only, no `available`). Identified via inspection of the Yoga gentest source. Expected count: 8–9 fixtures. Each goes back into `packages/core/test/fixtures/flex-wrap/` with the same name. The corpus runner (`fixtures.test.ts`) will assert Pilates and Yoga produce matching boxes after the fix.

### Diff fuzz

`packages/core/src/algorithm/spineless/flex-grammar.fuzz.test.ts` (v17) and `runtime-incremental.fuzz.test.ts` (v19) compare classic vs spineless. Since the post-step is engine-agnostic and runs on `_layout`, both engines see the same final values. No fuzzer regression expected.

## Risks

- **`flex-grow` on cross axis**: doesn't exist (flex is main-axis). Safe.
- **`alignItems: stretch` with auto root cross**: in the current single-pass model, children's cross is stretched to `containerCross` (0 in auto). After the fix, the root's cross becomes the auto-sum AFTER the stretch ran — children still have cross=0 in this case. **This matches Yoga's behavior for this input** because Yoga also computes children's cross from the resolved (post-measure) container cross, and an empty content tree yields 0 either way. Confirmed via the auto-tests already in PR #156's port pass.
- **`alignContent` with auto root cross**: align-content distributes lines across `innerCross`. When `innerCross` is 0 (auto root), all lines stack from 0 with no extra space. Auto-sum then captures the natural stack. Matches Yoga.
- **Min/max clamp ordering**: must be applied to the SUM, not the individual child. Per CSS spec, the min/max applies to the resolved content size.
- **Performance**: post-step is O(direct children of root) — trivial cost. Bench should be flat.

## Definition of done

- `autoSizeRootFromContent` added; engine-agnostic post-step wired into `calculateLayoutImpl`.
- 5 new unit tests pass.
- ~8 fixtures ported from PR #156's deferred list, all green under `pnpm test`.
- `pnpm test:differential` green (engine agreement preserved).
- `pnpm run ci` green.
- Issue #157 updated with comment: "Root-only path closed by this PR; inner-container path (`naturalCrossSize` non-leaf fallback) tracked separately."
- PR opened against `main`.
