# Wrap-Reverse Per-Line Cross Alignment — Design

**Status:** approved (design phase)
**Date:** 2026-05-26
**Branch:** `fix/wrap-reverse-cross-alignment`
**Tracking:** closes issue #159 (surfaced during PR #160's port).

## Goal

In `flexWrap: 'wrap-reverse'` containers, anchor each in-flow item at the cross-END of its line by default (Yoga 3.x / CSS semantics). Currently Pilates anchors at cross-START regardless of wrap direction. Closes the 5 wrap-reverse fixtures still deferred from PRs #156 and #160.

## Background

`reverseLineStack` (`main-axis.ts:760`) already flips line POSITIONS on the cross axis when `flexWrap === 'wrap-reverse'`. What's missing is the WITHIN-line flip: each item's default anchor inside its line.

For example, a 30-px tall line containing three children with heights 10/20/30:
- Forward wrap (or stretch with auto-height): all children at line-top=0; for explicit heights, child 0 at top=0/height=10 (top of the line), child 2 at top=0/height=30 (fills the line).
- **wrap-reverse**: Yoga puts all three sharing the line's BOTTOM edge — heights 10/20/30 at top=20/10/0. Pilates today: all at top=0.

## Behavior

Apply this transform to the effective per-item alignment when `parent.style.flexWrap === 'wrap-reverse'`:

| Original align | Wrap-reverse equivalent |
|---|---|
| `flex-start` | `flex-end` (swap) |
| `flex-end` | `flex-start` (swap) |
| `center` | `center` (unchanged) |
| `stretch` with explicit cross | anchored at cross-end |
| `stretch` with auto cross | unchanged (fills line) |
| `baseline`, `space-between`, `space-around` | unchanged (degenerate / unsupported) |

The flip applies AFTER `align-self` resolution — per-item overrides resolve first, then the wrap-reverse flip transforms the resolved value.

## Where the fix lives

### Classic engine — `packages/core/src/algorithm/main-axis.ts`

- `crossAlignItemsInLine` (line 825) gains a `wrap: FlexWrap` parameter.
- Compute `reverseCross = (wrap === 'wrap-reverse')` once at function start.
- After `align = effectiveAlign(...)`, apply the flip:
  ```ts
  if (reverseCross) {
    if (align === 'flex-start') align = 'flex-end';
    else if (align === 'flex-end') align = 'flex-start';
  }
  ```
- In the stretch branch (line 831), when `reverseCross && explicit` (child has explicit cross), use the flex-end position formula `line.crossSize - item.finalCross - item.marginCrossEnd` instead of `item.marginCrossStart`.
- Call site at line 320: `crossAlignItemsInLine(line, node.style.alignItems, node.style.flexWrap)`.

### Spineless engine — `packages/core/src/algorithm/spineless/flex-grammar.ts`

- Where `align` is computed (lines 783–788), apply the same flip when the parent has `flexWrap: 'wrap-reverse'`:
  ```ts
  let align: Align = parent === null ? 'auto' : (
    node.style.alignSelf === 'auto' ? parent.style.alignItems : node.style.alignSelf
  );
  if (parent !== null && parent.style.flexWrap === 'wrap-reverse') {
    if (align === 'flex-start') align = 'flex-end';
    else if (align === 'flex-end') align = 'flex-start';
  }
  ```
- The stretch branch's cross-position emission (need to locate during implementation — there's an emission point around line 808–840 where stretch + content-auto produces a position) needs the same flip for the explicit-cross case: when wrap-reverse + stretch + explicit, position should be `parentCross - mce - childCross` instead of `mcs`.

## Tests

### Unit tests in `packages/core/src/algorithm/layout.test.ts`

1. **wrap-reverse + explicit-height children + default alignItems**: children share the line's bottom edge (heights 10/20/30 → tops 20/10/0 in a 30-px line).
2. **wrap-reverse + alignItems: flex-end**: children share the line's top edge (flipped to flex-start).
3. **wrap-reverse + alignItems: center**: unchanged (still center).
4. **wrap-reverse + auto-height children + stretch**: fills line (no flip).

### Fixtures

Reinstate from PR #156 / #160 deferred lists:
- `wrap_reverse_row_align_content_flex_start`
- `wrap_reverse_row_align_content_center`
- `wrap_reverse_row_single_line_different_size`
- `wrap_reverse_row_align_content_stretch`
- `wrap_reverse_row_align_content_space_around`

### Differential fuzz

Both engines apply the same flip. The grammar's `align` computation and the imperative's `crossAlignItemsInLine` parallel each other; the differential fuzzer pins agreement.

## Risks

- **Existing tests asserting the old (incorrect) behavior**: any test using wrap-reverse with variable-height children may need updating. Watch for them and adjust expected values to match Yoga.
- **`align-self` with wrap-reverse**: the flip is applied after align-self resolution. A child with explicit `alignSelf: 'flex-end'` inside a wrap-reverse parent ends up at flex-start (flipped). Matches Yoga.
- **Stretch + auto cross**: when stretch is honored (auto cross), no flip needed — the child fills the line and position is moot. The flip only matters for the EXPLICIT-cross stretch case.
- **Margins on wrap-reverse**: the existing flex-start formula uses `marginCrossStart`; flex-end uses `marginCrossEnd`. The flip swaps the chosen alignment, which naturally swaps which margin is consulted.

## Out of scope

- **`alignContent` flipping**: already handled by `reverseLineStack`. Not touched here.
- **Absolute children inside wrap-reverse containers**: tracked under issue #157 Path B.

## Definition of done

- `crossAlignItemsInLine` flip implemented in classic engine.
- Equivalent flip emitted by the spineless grammar.
- 4 unit tests pass.
- 5 wrap-reverse fixtures reinstated from deferred lists; all pass against both engines.
- `pnpm test`, `pnpm test:differential`, `pnpm typecheck`, `pnpm lint`, `pnpm run ci` all green.
- Issue #159 closed by this PR; issue #157 comment updated.
- PR opened against `main`.
