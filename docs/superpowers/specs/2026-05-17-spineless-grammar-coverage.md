# Phase 5d — Spineless grammar feature coverage

## Problem

The flex grammar (`buildFlexGrammar`) covers the v1–v8 feature
subset. Anything outside it is **rejected at build time** with a
`throw`:

- `align-content` other than `flex-start` under `flex-wrap: wrap`
- `flex-wrap: wrap-reverse`
- `flex-direction: row-reverse` / `column-reverse`
- `min` / `max` width / height clamping (which the imperative
  algorithm resolves with a multi-iteration freeze loop)

Until coverage is complete the Spineless engine cannot run an
arbitrary real tree — it is the gap between research prototype and a
drop-in for the imperative `calculateLayout`.

## Approach

The mirror of phase 5a's v1–v8: one rejected feature per slice, each
gated by a differential test in `flex-grammar.test.ts` that asserts
`evaluateGrammar` is byte-identical to `evaluateImperative`. The
grammar mirrors the imperative algorithm's existing helper for the
feature, so a slice is "delete the `throw`, port the helper into the
grammar, prove equality."

## Slices

- **v9 — `align-content` (landed).** For a multi-line wrap
  container, the cross-axis leftover is distributed among / around
  the lines per `flex-start` / `flex-end` / `center` /
  `space-between` / `space-around` / `stretch`. Scoped entirely to
  `evaluateWrappedChild`'s line-cross positioning — it mirrors the
  imperative `positionLinesOnCross`. `stretch` grows each line's
  cross size; the rest shift the line stack. Single-line containers
  ignore `align-content`.
- **v10 — `flex-wrap: wrap-reverse`.** Mirrors the imperative
  `reverseLineStack` — the line stack is mirrored on the cross axis.
- **v11 — reverse directions.** `row-reverse` / `column-reverse`
  lay children out from the main-axis *end*; the main-position
  formula is mirrored, and justify-content interacts.
- **v12 — `min` / `max` clamping.** The hardest: flex distribution
  becomes the imperative freeze loop — clamp violating items, freeze
  them, redistribute the remainder, iterate to a fixpoint.

## Slice v9 — `align-content`

`buildFlexGrammar` no longer rejects non-`flex-start`
`align-content`. `evaluateWrappedChild` takes an `alignContent`
argument; its per-line cross-start computation distributes the
`innerCross - Σ lineCrossSizes - gaps` leftover per the value,
exactly as `positionLinesOnCross` does (including treating `auto`
and any unrecognised value as `stretch` / `flex-start` respectively,
and not special-casing `space-evenly`).

### Tests

`flex-grammar.test.ts` gains a `slice v9` describe: 3-line and
2-line row-wrap containers under each `align-content` value, a
no-leftover no-op case, a single-line container (ignores
`align-content`), a column-wrap case, and `stretch` composed with a
per-item `align-items`. The obsolete v7 "throws on non-flex-start
align-content" rejection test is removed.
