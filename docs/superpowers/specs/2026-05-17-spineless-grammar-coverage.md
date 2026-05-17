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
- **v12a — `min` / `max` clamping, leaf sizes (landed).** min / max
  modelled as input Fields. A node's main size (when the parent does
  not flex-distribute), its cross size, and an absolute child's
  width / height are clamped to the node's own
  `[minWidth/Height, maxWidth/Height]` — single `clampSize`
  applications, no iteration.
- **v12b — `min` / `max` in the freeze loop (landed).** Flex
  distribution becomes the imperative freeze loop — an item whose
  proportional grow / shrink target breaches a clamp is frozen at
  its bound and its share redistributed, iterating to a fixpoint.
  The clamped hypothetical also feeds the wrap line packer. With
  v12b the grammar covers the whole imperative flexbox feature set.

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

## Slice v12a — min/max clamping of leaf sizes

`min{Width,Height}` / `max{Width,Height}` are modelled as leaf input
Fields (`minMaxInput`), alongside the other numeric style props. The
`max*` inputs fold the `undefined` "no upper bound" sentinel to
`Infinity`, so every consumer clamps with one unconditional
`clampMinMax(value, min, max)` (floor before cap — when `min > max`
the cap wins, exactly the imperative `clampSize`).

Clamping is applied at three single-shot sites — no iteration, so
this slice is independent of the freeze loop:

- the **non-flex-distributed main size** rule — `clampMinMax` wraps
  the resolved basis (the imperative `buildItem` clamps the
  hypothetical even when no distribution follows; the root takes
  this path too);
- the **cross size** rule — the explicit cross style value clamped,
  matching the imperative `finalCross`. The `align-items: center` /
  `flex-end` cross-position rules now read the clamped `crossSize`
  layout field rather than the raw style input, so they track the
  clamp;
- **absolute children** — `emitAbsoluteRules` clamps width and
  height in every branch (explicit, edge-derived, and the `0`
  fallback), mirroring `layoutAbsoluteChild`.

`StyleInputs` and `style-dirty.ts`'s `ScalarStyleProp` gain the four
props, so a `setMinWidth` … mutation drives a precise incremental
relayout.

Clamping *inside* the flex-distribution freeze loop and the wrap
line packer is deferred to v12b — v12a's differential tests stay on
non-wrap, non-distributed trees plus absolute children.

### Tests

`flex-grammar.test.ts` gains a `slice v12a` describe (16 tests):
min / max on the main and cross axes, row and column parents, the
`min > max` cap-wins case, clamps feeding `align-items` center /
flex-end, composition with padding / margin / gap, clamped sizes
feeding `justify-content` leftover and a reverse-direction flip, the
root clamping its own size, three absolute-child cases (explicit,
edge-derived, `0`-fallback `minWidth`), and a no-clamp regression.

## Slice v12b — min/max in the flex freeze loop

`distributeMainAxis` becomes the real CSS freeze loop. Each
sibling's hypothetical is its basis clamped to its own `[min, max]`;
`freezeLoopGrow` / `freezeLoopShrink` then iterate — an unfrozen
item whose proportional target breaches a clamp is pinned at the
bound, removed from `totalGrow` / `totalScaled`, its delta booked as
`frozenContribution`, and the remainder redistributed, up to `n + 1`
rounds. Byte-for-byte the imperative `distributeGrow` /
`distributeShrink`. With no min/max present the loop settles in one
round and reproduces the prior single-pass result, so v9–v11 trees
are unchanged.

`SizeInputs` / `WrapSibInputs` gain main-axis `min` / `max` input
Fields (and `WrapSibInputs` also cross-axis ones); the
flex-distribution and wrap `mainSize` rules declare them as deps.
The wrap line packer (`evaluateWrappedChild`) packs on the clamped
hypothetical and runs the freeze loop per line.

One subtlety the differential fuzzing-style tests surfaced: the
imperative computes a line's cross size from each item's
**unclamped** natural cross (`computeLineCrossSizes` →
`naturalCross`) but positions an item within its line against the
**clamped** cross (`crossAlignItemsInLine` →
`clampSize(naturalCross)`). A min/max clamp can thus make an item
overflow its line. `WrapSibling` carries both `crossSizeNatural`
(line aggregation) and `crossSize` (within-line alignment).

### Tests

`flex-grammar.test.ts` gains a `slice v12b` describe (16 tests):
flex-grow / flex-shrink with a child hitting max / min, cascading
freezes needing multiple iterations, every child hitting max,
numeric flex-basis clamped both ways, `min > max`, column-direction
distribution, clamps feeding `justify-content` and a reverse flip,
three wrap cases (clamped packing, per-line freeze loop, the
natural-vs-clamped cross-size split), and a no-clamp regression.
