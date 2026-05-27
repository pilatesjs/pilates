# Overflow `justifyContent` — Design

**Status:** approved (design phase)
**Date:** 2026-05-27
**Branch:** `fix/overflow-justify-content`
**Tracking:** closes issue #164.

## Goal

When main-axis content overflows the container, allow `justifyContent: 'flex-end'` and `'center'` to keep their anchor (producing negative cursor positions); keep `space-*` modes' existing flex-start degradation. Matches Yoga 3.x and CSS. Closes the 2 fixtures PR #162 deferred for this divergence.

## Behavior

Split the leftover computation in `positionItemsInLine`:

- `leftover = innerMain - usedMain` — SIGNED, can be negative on overflow.
- `leftoverPositive = Math.max(0, leftover)` — clamped, used only by `space-*`.

Per-mode:
- `flex-start`: cursor = 0 (unchanged).
- `flex-end`: cursor = `leftover` (was `Math.max(0, leftover)`).
- `center`: cursor = `leftover / 2` (was clamped).
- `space-between`: extraGap = `leftoverPositive / (n-1)` (unchanged behavior on overflow → flex-start).
- `space-around`: slot = `leftoverPositive / n` (unchanged).
- `space-evenly`: slot = `leftoverPositive / (n+1)` (unchanged).

For overflow + `flex-end`: items start at negative cursor and chain forward. For overflow + `center`: cursor is `negative / 2`, items center-overflow both sides.

## Non-goals

- Negative-margin support (Pilates' `setMargin` validates non-negative).
- Negative gap support.
- New CSS modes (`legacy left/right`, etc.).

## Where the fix lives

- **Classic engine** (`packages/core/src/algorithm/main-axis.ts:782`): change the `leftover` definition + each switch case as above.
- **Spineless engine** (`packages/core/src/algorithm/spineless/flex-grammar.ts`): mirror — locate the `Math.max(0, ...)` in the justify-driven cursor emission. Likely inside the in-flow per-line packer that handles `justify-content`.

## Tests

### Unit test

```ts
it('justify-content: flex-end with overflow places children at negative left', () => {
  const root = Node.create();
  root.setFlexDirection('row');
  root.setJustifyContent('flex-end');
  root.setWidth(40);
  const a = Node.create(); a.setWidth(30); a.setHeight(10); a.setFlexShrink(0);
  const b = Node.create(); b.setWidth(30); b.setHeight(10); b.setFlexShrink(0);
  root.insertChild(a, 0);
  root.insertChild(b, 1);
  root.calculateLayout();
  // Total used = 60, free = -20. flex-end anchors items toward the right,
  // so cursor = -20, a at -20, b at 10.
  expect(a.getComputedLayout().left).toBe(-20);
  expect(b.getComputedLayout().left).toBe(10);
});
```

### Reinstated fixtures

- `overflow-row-flex-end.spec.json`
- `overflow-row-center.spec.json`

### Existing fixtures unchanged

All 13 justify-content fixtures from PR #162 (including the 4 overflow space-* variants) must still pass — they exercise the clamped path that this PR preserves.

## Risks

- **Single-line `space-between` with 1 item**: existing behavior `n > 1` guard keeps `extraGap = 0`. Preserved.
- **Floating-point precision**: `cursor = leftover / 2` for `center` when leftover is odd produces 0.5 fractional values; the round step handles these (already does for the non-overflow case).
- **Spineless cache**: the cursor formula change doesn't add new deps; same fields, same recompute path.

## Definition of done

- Classic engine `positionItemsInLine` uses split leftover.
- Spineless engine mirrors the split.
- 1 unit test passes.
- 2 deferred fixtures reinstated (`overflow-row-flex-end`, `overflow-row-center`).
- `pnpm test`, `pnpm test:differential`, `pnpm typecheck`, `pnpm lint`, `pnpm run ci` all green.
- Issue #164 closed.
- PR opened against `main`.
