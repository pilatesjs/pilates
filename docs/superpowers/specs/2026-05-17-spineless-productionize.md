# Phase 8 — Wire Spineless into `calculateLayout`

## Problem

The Spineless incremental layout engine is feature-complete
(phase 5d), content-sizing-complete (phase 6) and fuzz-validated
both statically and incrementally (phase 7) — but it is still
**internal**. The public `node.calculateLayout()` runs the
imperative algorithm every call; the validated incremental engine
reaches no users.

Phase 8 productionises it: a stateful layout driver that builds the
grammar + runtime once, writes results back into `node._layout`,
and on subsequent calls relays *incrementally* — `markStyleDirty` +
`recompute()` for value mutations, `graft` / `detach` / rebuild for
structural ones.

## Approach

A `SpinelessLayout` driver bound to a root `Node`. Its `layout(aw,
ah)` method produces a layout byte-equivalent to imperative
`calculateLayout`, persisting the runtime between calls so a second
`layout()` after a mutation is incremental.

The grammar emits floating-point relative positions; `roundLayout`
(the existing imperative rounding pass) turns them into integer
cells. So the write-back is: evaluate every node's
`{width, height, left, top}` Field → `node._layout` (float) →
`roundLayout(root)` → `computeScrollSizes(root)` → mark clean.

## Slices

- **v19 — single-shot Spineless layout + write-back.** A
  `SpinelessLayout` whose `layout()` always does a full build:
  `buildFlexGrammar` → `SpinelessRuntime.init()` → write each
  node's evaluated floats into `_layout` → `roundLayout` →
  `computeScrollSizes`. Differentially verified, on a curated
  integer-friendly corpus, against imperative `calculateLayout`.
  No incrementality yet — every `layout()` rebuilds.
- **v20 — persistent runtime, incremental value relayout.** The
  driver keeps the runtime between `layout()` calls. When only
  value mutations occurred (every dirty node's change is a
  value-input mutation), it `markStyleDirty`s the changed inputs and
  `recompute()`s instead of rebuilding.
- **v21 — structural change handling.** Child insert / remove and
  other structural mutations drive `graft` / `detach` when the
  fast-path applies, a full grammar rebuild otherwise.
- **v22 — public wiring.** `calculateLayout` routes through
  `SpinelessLayout`, with an imperative fallback for trees the
  grammar does not cover (`display: none`, a measure function on an
  absolute node).

## Slice v19 — single-shot Spineless layout + write-back

`packages/core/src/algorithm/spineless/layout.ts` exports a
`SpinelessLayout` class:

- `new SpinelessLayout(root)` — binds the driver to a root.
- `layout(availableWidth?, availableHeight?)` — builds the grammar
  with the given availability, runs a fresh `SpinelessRuntime`,
  writes every node's evaluated `{left, top, width, height}` floats
  into `node._layout` (and `_floatLeft` / `_floatTop`), then runs
  `roundLayout` and `computeScrollSizes`, and clears dirty flags —
  mirroring `calculateLayoutImpl`'s tail.

`computeScrollSizes` is promoted from a local in `algorithm/index.ts`
to an exported function so both the imperative and the Spineless
paths share it.

### Tests

`spineless-layout.test.ts`: a curated set of trees (fixed sizes,
flex distribution, wrap, `'auto'`, `aspectRatio`, a measure leaf,
absolute, nested) laid out by both `SpinelessLayout.layout()` and
imperative `calculateLayout`, asserting every node's `layout`
(`left` / `top` / `width` / `height`) and `scrollWidth` /
`scrollHeight` are byte-identical. Trees are kept integer-friendly
so rounding is unambiguous (see the phase-7 spec on the `x.5`
boundary).
