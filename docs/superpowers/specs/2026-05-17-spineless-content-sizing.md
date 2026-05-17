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
- **v14 — `'auto'` cross axis + `align-items: stretch`.** An
  `'auto'` **cross-axis** size is `0` under a non-stretch align, but
  `align-items: stretch` (the default) resizes it to fill the line's
  inner cross — `clampSize(lineCross − crossMargins)`. This is the
  imperative `crossAlignItemsInLine` stretch branch; it is reached
  for explicit cross sizes too but is a no-op there. Needs the
  line cross size, so it touches the non-wrap rule and the wrap line
  packer.
- **v15 — `aspectRatio`.** When an axis is `'auto'` and the
  perpendicular axis is an explicit number, derive
  `width = height × ratio` / `height = width ÷ ratio`, mirroring
  `effectivePreferredSize`. Explicit-on-both → ratio ignored.
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
