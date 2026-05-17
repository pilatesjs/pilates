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
- **v10 — `flex-wrap: wrap-reverse` (landed).** Mirrors the
  imperative `reverseLineStack` — after `align-content` has placed
  the lines, each line's cross start is mirrored:
  `innerCross − crossStart − crossSize`. The wrap branch now fires
  for `wrap` *and* `wrap-reverse`; `evaluateWrappedChild` takes a
  `reverse` flag. A no-op for a single line (its cross size already
  fills `innerCross`).
- **v11 — reverse directions (landed).** `row-reverse` /
  `column-reverse` lay children out from the main-axis *end*. The
  base axis (`mainAxis`) drives field assignment unchanged; a
  post-hoc wrapper reflects each in-flow child's main position
  across the inner-main box (`padStart + innerMain − innerPos −
  childMain`), exactly the imperative `flipMainAxis`. Applies
  uniformly to the flex-start, justified and wrap regimes.
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

## Slice v10 — `flex-wrap: wrap-reverse`

`buildFlexGrammar` no longer rejects `wrap-reverse`; the wrap branch
fires for any `flexWrap !== 'nowrap'`. `evaluateWrappedChild` takes
a `reverse` flag (`flexWrap === 'wrap-reverse'`); after
`align-content` has placed the lines, when `reverse` it mirrors each
line's cross start (`innerCross − crossStart − crossSize`), exactly
as the imperative `reverseLineStack`. A `wrap-reverse` parent is
non-simple for the structural fast-paths (the `flexWrap === 'nowrap'`
checks already exclude it).

### Tests

`flex-grammar.test.ts` gains a `slice v10` describe: 3-line
row `wrap-reverse` under every `align-content` value, a single-line
case, a column `wrap-reverse`, and `wrap-reverse` composed with
`align-items` — each byte-identical to the imperative. The obsolete
v7 "throws on wrap-reverse" rejection test is removed.

## Slice v11 — reverse directions

`buildFlexGrammar` no longer rejects `row-reverse` / `column-reverse`.
`parentDirection` is computed via `mainAxis` (collapsing `*-reverse`
onto its base axis) so all main/cross field assignment is unchanged;
a separate `parentReverse` flag records the reverse.

`applyReverseMainPos` re-wraps a child's already-emitted
main-position rule: it preserves the forward rule, invokes it for
the forward offset, and reflects the result across the parent's
inner-main box — `padStart + innerMain − (forwardPos − padStart) −
childMain`, byte-for-byte the imperative `flipMainAxis`. The deps
become the union of the forward rule's deps and the parent main
size / both main-axis paddings / the child's own main size. It is
called once per in-flow child in both the wrap and non-wrap regimes,
so flex-start, justified and wrapped positioning all reverse
uniformly. Absolute children are positioned against the parent's
outer box and never flip — they return before the wrapper.

The structural fast-paths (`buildAppendFragment` /
`buildRemoveFragment`) still bail to a full rebuild for a
reverse-direction parent: a flip reflects every sibling, so it is a
whole-subtree rewrite rather than a topological-tail graft.

### Tests

`flex-grammar.test.ts` gains a `slice v11` describe (16 tests):
`row-reverse` / `column-reverse` with fixed children, `row-reverse`
under every `justify-content` value, flex-grow / flex-shrink
distribution, padding + margin + gap, `align-items`, `flex-wrap`,
`column-reverse` × `wrap-reverse` (both axes mirrored), an absolute
child coexisting, and nested reverse containers — each
byte-identical to the imperative. The obsolete v2 "throws on
row-reverse / column-reverse" rejection tests are removed.
