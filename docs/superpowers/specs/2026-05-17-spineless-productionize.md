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
- **v20 — persistent runtime, incremental value relayout (landed).**
  The driver keeps the grammar + runtime between `layout()` calls.
  It compares a structural fingerprint of the tree; when nothing
  structural changed it diffs every leaf input Field (`deps: []`),
  `markDirty`s the ones whose live value drifted, and `recompute()`s
  — no rebuild. A structural change rebuilds.
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

## Slice v20 — persistent runtime + incremental value relayout

`SpinelessLayout` keeps a `Built` record between `layout()` calls:
the `FlexGrammarOutput`, the `SpinelessRuntime`, the `available`
holder, the list of leaf input Fields, and a structural
fingerprint.

Each `layout()` decides build-vs-reuse:

- **Structural fingerprint.** `captureStructure` walks the tree
  pre-order recording, per node, its identity, a `nodeSig` string
  (flex-direction / wrap / justify / align* / position-type /
  display, the `typeof` of each size and `flexBasis`, the
  zero/positive boundary of each flex weight, `aspectRatio`,
  child count, and absolute `position` edges) and its measure
  function. Anything in that signature reshapes the rule graph, so
  a mismatch — or an `available` presence change — forces a full
  rebuild.
- **Incremental relayout.** When the fingerprint matches, the
  grammar is unchanged: the driver re-runs each leaf input Field's
  `compute` (a `deps: []` rule reads `node.style` live), compares
  it to the runtime's cached value, `markDirty`s the ones that
  drifted, and `recompute()`s. The `available` holder is mutated in
  place so an `available` value change flows through the
  `available:*` input Fields the same way.

A `stats` counter (`fullBuilds` / `incrementalRelayouts`) records
which path each call took, asserted by the tests.

### Tests

`spineless-layout.test.ts` gains a `slice v20` describe (13 tests):
a persistent driver is run through mutation sequences, each step
applied to a parallel imperative tree and the layouts asserted
equal. Value mutations (size, gap, padding, margin, min/max, a
positive→positive flex-weight tweak, a new `available`) take the
incremental path (`stats` confirms); structural changes
(flex-direction, a flex weight crossing zero, an `'auto'` boundary
crossing, child insert/remove, `aspectRatio`, an `available`
presence change) force a rebuild; a mixed sequence interleaves both.
