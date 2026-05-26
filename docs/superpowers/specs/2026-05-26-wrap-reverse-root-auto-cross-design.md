# Wrap-Reverse Root Auto-Cross Sizing — Design

**Status:** approved (design phase)
**Date:** 2026-05-26
**Branch:** `fix/wrap-reverse-root-auto-cross`
**Tracking:** the wrap-reverse follow-up flagged in PR #158 and issue #157's scoping comment.

## Goal

When a root has `flexWrap: 'wrap-reverse'` AND a bare-zero auto cross axis, produce Yoga-matching positions: shifted-to-non-negative child positions and a content-derived container cross. Reinstates the 5 wrap-reverse fixtures deferred by PR #156.

## Background

PR #158 added `autoSizeRootFromContent` to set the root's auto cross from `max(child outer-edge) + padEnd`. For forward wrap and non-wrap this is correct. For wrap-reverse, `layoutFlexFlow` flipped lines about a container_cross of 0, leaving children at NEGATIVE cross positions (e.g. `top: -30`, `top: -60`). The current `sumChildExtent` only measures positive max edges, so it reports the root cross as 0 and leaves children at negative positions — Yoga renders the same tree with all children at non-negative positions inside a content-sized container.

## Behavior

For each axis where `axisIsBareZero` is true, post-layout:

1. Walk in-flow children. Compute `minStart` (min of `child.{top|left}`) AND `maxEdge` (max of `child.{top|left} + child.{width|height}`).
2. Natural extent = `maxEdge - minStart` (was just `maxEdge` before this PR).
3. If `minStart < 0`, shift all in-flow children's `{top|left}` by `-minStart` so the topmost lands at 0. Update both `_layout.{top|left}` and `_floatLeft/_floatTop`.
4. Root cross size = `clampSize(extent + padEnd)`.

Forward wrap and non-wrap: `minStart = 0`, no shift, behavior unchanged.

## Non-goals

- **Absolute children of a shifted root.** They were positioned during `layoutAbsoluteChildren` against the unshifted container_cross=0; their positions remain wrong after the post-step. Fixing this requires re-running `layoutAbsoluteChildren` (or its equivalent) after the post-step, which couples with the architectural Path B work on issue #157. Out of scope here; documented as a known limitation.
- **Inner-container wrap-reverse with auto cross.** Same Path B territory.
- **Reverse main-axis (`row-reverse` / `column-reverse`) with auto main on root.** Symmetric problem on the main axis, but the existing PR #158 fix didn't address this either — flagged but deferred to keep this PR scoped to wrap-reverse only.

## Where the fix lives

`packages/core/src/algorithm/main-axis.ts`:
- Modify `sumChildExtent` to return `{ extent, shift }` instead of `number`.
- Add private `shiftChildren(root, axis, shift)`.
- Update `autoSizeRootFromContent` to call `shiftChildren` when `shift > 0`.

Engine-agnostic: same call sites as PR #158 (classic cold path, spineless `finishWhole`, spineless `finishMoved`).

## Tests

### Reinstated fixtures (from PR #156's deferred list)

- `wrap-reverse-align-content-flex-start.spec.json`
- `wrap-reverse-align-content-center.spec.json`
- `wrap-reverse-single-line-different-size.spec.json`
- `wrap-reverse-align-content-stretch.spec.json`
- `wrap-reverse-align-content-space-around.spec.json`

### Unit test (layout.test.ts)

- `wrap-reverse with auto cross shifts children to non-negative positions and sets root cross to content sum`. Builds a 2-line wrap-reverse tree, asserts both child positions are ≥ 0, root cross matches content sum.
- `forward-wrap behavior unchanged (no shift)` — regression pin: forward wrap still produces children at non-shifted positions and root cross = max edge + padEnd, identical to PR #158 behavior.

## Risks

- **`finishMoved` re-round**: PR #158's `roundLayoutFrom(this.root, 0, 0, 0, 0)` re-rounds the root subtree. Shifted children are already in `_layout` when this runs, so the re-round picks them up correctly.
- **Differential fuzzer**: both engines now apply the same shift via the engine-agnostic post-step. Cross-engine agreement preserved.
- **Sibling-invariant**: the shift is uniform across all in-flow children, so siblings' relative positions are unchanged — no displacement.

## Definition of done

- `sumChildExtent` extended; `shiftChildren` added; `autoSizeRootFromContent` calls them.
- 5 wrap-reverse fixtures reinstated from PR #156's deferred list — all pass.
- 2 new unit tests in `layout.test.ts`.
- `pnpm test`, `pnpm test:differential`, `pnpm typecheck`, `pnpm lint`, `pnpm run ci` all green.
- Issue #157 comment updated: the remaining open item is the architectural Path B (inner-container auto-cross + absolute children of shifted containers).
- PR opened against `main`.
