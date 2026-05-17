# Phase 6 — Spineless content sizing (`'auto'` / measure / aspectRatio)

## Problem

The flex grammar (`buildFlexGrammar`) covers the whole imperative
flexbox feature set (phase 5d) **but only for trees of explicitly
numeric `width` / `height`**. Its in-flow precondition throws:

```
[flex-grammar] node requires explicit numeric width; got "auto"
```

The imperative `calculateLayout` handles `'auto'` on every axis:

- a leaf with a measure function is measured;
- `aspectRatio` derives an `'auto'` axis from the explicit
  perpendicular one;
- the root falls back to the caller-supplied `available` size;
- everything else resolves `'auto'` to `0`.

Until the grammar reproduces this, the Spineless engine cannot run
a real TUI tree — text leaves and auto-sized boxes are pervasive.
Closing this gap makes Spineless a true drop-in for `calculateLayout`.

## Scope clarification — what Pilates' `'auto'` actually means

Pilates does **not** do bottom-up content-based *container* sizing:
`resolveHypotheticalMainSize` / `naturalCrossSize` return `0` for a
non-leaf `'auto'` node. Content sizing enters only through
**measure functions on leaves** (`getChildCount() === 0`). So phase 6
is "reproduce the imperative `'auto'` resolution", not "invent
intrinsic container sizing" — the grammar mirrors
`effectivePreferredSize`, `resolveHypotheticalMainSize`,
`naturalCrossSize` and `resolveRootAxisSize`.

## Approach

`'auto'` vs a numeric value on an axis is a **structural** property
(like `flex-direction`): it selects which rule shape an axis's size
Field gets, so a mutation between `'auto'` and a number needs a
fresh `buildFlexGrammar()`. At build time each node/axis branches:

- numeric → the existing `styleSizeInput` path;
- `'auto'` → a content-resolution rule (v13: `0` on the main axis;
  v14: stretch resize on the cross axis; v15: aspectRatio; v16:
  measure func).

Each slice is gated by a differential test asserting `evaluateGrammar`
is byte-identical to `evaluateImperative`.

## Slices

- **v13 — `'auto'` main axis → `0`, root from `available`.** Remove
  the numeric precondition. A non-measured `'auto'` **main-axis**
  size resolves to `0` (still clamped to `[min, max]`), mirroring
  `resolveHypotheticalMainSize`. The root's `'auto'` axis resolves
  from a caller-supplied `available`, modelled as a root input
  Field so a terminal resize drives a precise incremental relayout.
- **v14 — `'auto'` cross axis + `align-items: stretch` (landed).**
  An `'auto'` **cross-axis** size is `0` under a non-stretch align,
  but `align-items: stretch` (the default) resizes it to fill the
  line's inner cross — `clampSize(lineCross − crossMargins)`. This
  is the imperative `crossAlignItemsInLine` stretch branch; it is
  reached for explicit cross sizes too but is a no-op there. Needs
  the line cross size, so it touches the non-wrap cross-size rule
  and the wrap line packer.
- **v15 — `aspectRatio` (landed).** When an axis is `'auto'` and the
  perpendicular axis is an explicit number, derive
  `width = height × ratio` / `height = width ÷ ratio`, mirroring
  `effectivePreferredSize`. Explicit-on-both → ratio ignored;
  both-`'auto'` → cannot derive. A derived axis is definite — not
  content-sized — so `align-items: stretch` does not resize it.
- **v16 — measure-func leaves.** A leaf (`getChildCount() === 0`)
  with a measure function resolves its `'auto'` axes by calling the
  measurer with axis constraints derived from the parent's inner
  size. The measure function + its result cache become grammar
  inputs; the constraint is a new parent→child dependency edge.

## Slice v13 — `'auto'` main axis → `0`, root from `available`

`buildFlexGrammar` gains an optional `available` argument
(`{ width?: number; height?: number }`); the test helper threads
the same value into `evaluateImperative`'s `calculateLayout` call.
The root's `available` becomes input Fields (`available:width` /
`available:height`), surfaced on `FlexGrammarOutput.availableInputs`,
so a resize is incremental.

A build-time `preferredSizeInput(node, axis, isRoot)` helper selects
the input Field a size rule reads: numeric → `styleSizeInput`;
`'auto'` + root → `availableInput`; `'auto'` elsewhere → a constant
`0` Field. The `flexBasis: 'auto'` case already resolves to the main
style size (now `0` when that is also `'auto'`). Absolute children
with an `'auto'` axis already fall to the `0` branch in
`emitAbsoluteRules`.

Scope note: an `'auto'` **cross** size resolves to `0` here too, but
that is only byte-identical to the imperative under a non-stretch
`align-items`. The default `stretch` resizes it — deferred to v14 —
so v13's differential tests keep the cross axis explicit.

### Tests

A `slice v13` describe (10 tests): `'auto'` main size on a leaf in a
column and a row parent (→ 0), an `'auto'` root sized from
`available` (both axes / no available / one explicit axis), `'auto'`
main composed with flex-grow / min-width / justify-content, an
`'auto'` absolute child, and nested auto-main containers — all with
the cross axis explicit. The three obsolete "requires explicit
numeric width/height" precondition tests are removed.

## Slice v14 — `'auto'` cross axis + `align-items: stretch`

The cross-size rule branches at build time. For a numeric cross, the
`'auto'` root, or an `'auto'` cross under a non-stretch align it is
the resolved input clamped to `[min, max]` (v12/v13 — `0` for a
non-stretched `'auto'`). For an `'auto'` cross with `align: stretch`
the size instead fills the line's inner cross:
`clampMinMax(max(0, lineCross − crossMarginStart − crossMarginEnd))`,
mirroring `crossAlignItemsInLine`'s stretch branch.

For a **non-wrap** parent the line cross is the parent's inner cross
(`parentCross − padding`), so the rule depends on the parent's
cross-size Field plus the cross paddings and the child's cross
margins. For a **wrap** parent the line cross is per-line:
`evaluateWrappedChild` now also returns `crossSize`, and the wrap
regime overrides `crossSizeField` with it. `WrapSibling` /
`WrapSibInputs` carry `crossIsAuto` and the cross-axis clamp bounds;
the stretch resize uses the post-`align-content` line cross, so an
`align-content` line boost flows through.

### Tests

A `slice v14` describe (14 tests): `'auto'` cross stretching in a
column and a row parent, `align-items: flex-start` / `align-self`
override leaving it at `0`, the fill subtracting parent padding and
child cross margins, min/max clamping of the stretched size,
composition with an `'auto'` root, both-axes-auto leaves,
single-line and multi-line wrap, an `align-content` line boost,
reverse direction, and nested auto-cross containers.

## Slice v15 — `aspectRatio` derivation

A build-time `aspectDerivable(node, axis)` predicate holds when the
axis is `'auto'`, an `aspectRatio` is set, and the perpendicular
axis is an explicit number — exactly when `effectivePreferredSize`
derives a concrete size. `preferredSizeInput` gains a branch: a
derivable axis returns an `aspect:*` Field whose `compute` reads the
other axis's `styleSizeInput` and applies the ratio
(`width = other × ratio`, `height = other ÷ ratio`). The ratio
itself is captured at build time (a `setAspectRatio` is structural);
the perpendicular axis stays an input Field, so mutating it
re-derives.

Precedence mirrors `effectivePreferredSize` / `resolveRootAxisSize`:
explicit → aspectRatio-derived → (root) `available` / (non-root)
`0`. So a derived size wins over an `'auto'` root's `available` and
over the `0` fallback.

A derived axis is **definite**, not content-sized: the v14 stretch
condition is narrowed from "cross is `'auto'`" to "cross is
content-`'auto'`" (`'auto'` *and* not `aspectDerivable`), matching
the imperative `crossAlignItemsInLine` stretch branch which treats
an `effectivePreferredSize` number as explicit. The `WrapSibling` /
`WrapSibInputs` `crossIsAuto` flag is renamed `crossIsContentAuto`
accordingly.

### Tests

A `slice v15` describe (12 tests): width-from-height and
height-from-width derivation, a fractional ratio, both-axes-auto
(cannot derive) and both-explicit (ratio ignored), a derived main
size feeding flex layout and acting as the flex-grow basis, a
derived cross size staying definite under `stretch`, an `'auto'`
root deriving over `available`, min/max clamping of a derived size,
composition with `flex-wrap`, and nested derived containers.
