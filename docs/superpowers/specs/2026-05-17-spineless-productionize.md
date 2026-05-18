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
- **v21 — graft fast-path for child append (landed).** When the
  only structural change is a single child append (to a parent the
  fragment fast-path covers), `buildAppendFragment` + `graft` patch
  the runtime in place — no whole-tree rebuild. Any other structural
  change (remove, mid-list insert, reverse-parent append,
  flex-direction, …) still rebuilds.
- **v22 — dirty-flag-guided detection (landed).** `SpinelessLayout`'s
  per-call change detection was O(tree) — `captureStructure` +
  diffing every input Field. v22 scopes it to the mutated region
  using the `Node` dirty flags (`isDirty()` / `_hasDirtyDescendant`),
  so a value relayout after a small mutation is O(dirty region).
- **v23 — incremental output write-back (landed).** With detection
  now O(dirty), the remaining O(tree) cost was the *output* plumbing
  — `writeBack` / `roundLayout` / `recordScrollSizes` re-processing
  the whole tree. v23 makes `recompute()` report the fields it
  changed, so write-back, re-rounding (`roundLayoutFrom`) and
  scroll-extents touch only the subtrees whose layout actually moved.
- **v24 — public wiring (landed).** `calculateLayout` routes through
  `SpinelessLayout` (the imperative path for the first cold layout
  of a root; Spineless from the second), with an imperative
  fallback for trees the grammar does not cover (`display: none`, a
  measure function on an absolute node). Deferred to here because
  wiring is only a non-regression once both detection (v22) and
  output write-back (v23) are incremental — a prototype wiring
  showed the O(tree) plumbing regressing the `hotrelayoutboundary`
  bench.

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

## Slice v21 — graft fast-path for child append

When `layout()` finds a structural change, it tries `tryGraftAppend`
before falling back to a rebuild. The classifier compares the
current `StructuralFingerprint` to the built one:

- no node removed, ≥ 1 added;
- every surviving node's `nodeSig` + measure function unchanged
  (`graft` patches only the append — a concurrent style-structural
  change would be missed);
- the added nodes form exactly one subtree (a unique added node
  whose parent is not itself added — its root is the appended
  `child`, its parent the `parent`).

On a match it calls `buildAppendFragment(prev, root, parent, child)`;
if that returns a fragment (the parent is not reverse-direction and
`child` is the last child), the driver `graft`s the additions,
applies the `rebinds` via `rebindRule`, adopts `fragment.next`,
re-collects the input Fields, and runs the value-change diff +
`recompute()` (so a value mutation in the same gap is picked up
too). `buildAppendFragment` returning `null`, a removed node, a
mid-list insert, or a touched sibling signature all fall back to a
full rebuild.

`stats` gains a `graftRelayouts` counter.

### Tests

`spineless-layout.test.ts` gains a `slice v21` describe (10 tests):
appending a last child / several in sequence / a whole subtree /
into a flex-distributing parent / into a wrap container takes the
graft path (`stats.graftRelayouts` confirms); an append composed
with a value mutation grafts and applies both; a mid-list insert, a
reverse-parent append and a child removal all fall back to a
rebuild; each step is mirrored on a parallel imperative tree and the
layouts asserted equal. The obsolete v20 "inserting a child forces a
rebuild" test is removed (a last-child append now grafts).

## Slice v22 — dirty-flag-guided detection

v20/v21's `layout()` walked the whole tree every call: `captureStructure`
built a signature for all N nodes, and `applyValueChanges` diffed all
~N×15 input Fields. For a small mutation in a large tree that O(tree)
detection swamps the O(affected) `recompute()` — a prototype wiring
into `calculateLayout` showed `hotrelayoutboundary` at 0.96 ms (vs the
imperative's 0.1 ms).

v22 uses the `Node` dirty flags the imperative cache already relies on.
After each `layout()` the driver clears them; a mutation re-sets
`_dirty` on the touched node and `_hasDirtyDescendant` on its
ancestors. The next `layout()`:

- `collectDirty` walks only the dirty region (descending where
  `isDirty() || _hasDirtyDescendant`).
- Each dirty node is classified against a stored `NodeSnap`
  (`{ sig, measure, children }`): an unchanged signature / measure /
  child list → a pure value change; anything else → structural.
- All value → re-`markDirty` just the dirty nodes' input Fields
  (skipping any the runtime never tracked — a registered-but-unread
  input like a flex-start container's main-end padding) and
  `recompute()`. Structural → the v21 `tryGraftAppend` / rebuild.

Detection is now O(dirty region). The same prototype wiring measured
`hotrelayoutboundary` drop from 0.96 ms to 0.24 ms; the residual is
the O(tree) output plumbing (`writeBack` / `roundLayout` /
`recordScrollSizes`), which slice v23 addresses before the public
wiring lands.

### Tests

The existing 36 `spineless-layout.test.ts` cases (slices v19–v21) all
pass unchanged — they already drive persistent drivers through value
and structural mutation sequences, so they cover the new dirty-walk
classifier and value path.

## Slice v23 — incremental output write-back

After v22 the change detection is O(dirty region), but `layout()`
still ran three whole-tree output passes every call — `writeBack`
(evaluate + store every node's `_layout`), `roundLayout`, and
`recordScrollSizes`. A prototype wiring measured the residual at
0.24 ms on `hotrelayoutboundary`.

v23 scopes all three to the moved subtrees:

- `SpinelessRuntime.recompute()` now returns the Fields whose value
  actually changed. The driver maps the changed layout Fields
  (via an `owner` index) to the nodes whose box moved, then keeps
  the **maximal moved subtree roots** — a moved node with no moved
  ancestor.
- For each such root the driver writes back only that subtree,
  re-rounds it with the new `roundLayoutFrom` (round.ts) — the
  root's parent did not move, so its rounded corner is a stable
  origin — and recomputes the subtree's scroll extents. A moved
  root's parent then needs a single scroll recompute (one of its
  children's box changed, but the parent itself did not move).
- A build / graft still finishes whole-tree.

A prototype wiring measured `hotrelayoutboundary` drop from 0.24 ms
(post-v22) to **0.12 ms**, and `hotrelayouttext` now clears its
budget. The public wiring (v24) can land as a non-regression.

### Tests

`spineless-layout.test.ts` gains a `slice v23` describe (7 tests): a
depth-4 nested tree driven through deep-leaf mutations, a sibling
shift, a mid-tree resize, scattered cross-subtree mutations, a long
sequence, fractional flex-grow layout, and an `available` resize —
each step mirrored on a parallel imperative tree and asserted
byte-identical. The 36 v19–v21 cases pass unchanged.

## Slice v24 — public wiring

`algorithm/index.ts` `calculateLayout` becomes a router. Outside
differential mode it:

- runs the imperative `calculateLayoutImpl` for a tree the grammar
  does not cover — `spinelessSupports(root)` recurses the subtree,
  returning false for any `display: 'none'` node or a measure
  function on an `'absolute'` node;
- runs the imperative path for the **first** layout of a root (cold
  builds have no grammar to amortise), recording `'cold'` in a
  per-root `WeakMap`;
- from the **second** layout onward adopts a persistent
  `SpinelessLayout` for that root — built once, relaid
  incrementally per v22/v23.

Differential mode (`PILATES_DIFFERENTIAL_LAYOUT=1`) is unchanged: it
still runs the imperative algorithm twice and diffs.

The imperative cache's own tests need the imperative path directly,
so `index.ts` also exports `calculateLayoutImperative(root, aw?, ah?)`
— a thin `calculateLayoutImpl` wrapper. `cache.test.ts`,
`cache.fuzz.test.ts`, `cache.invariants.test.ts`, the two
imperative-cache blocks of `index.test.ts`, and `node.test.ts`'s
measure-cache test route through it.

### Bench

Wiring swaps the engine for the hot-relayout scenarios. The
imperative boundary cache served `hotrelayoutboundary` in ~0.02 ms;
Spineless's dependency-graph incrementality costs ~0.12 ms local —
~0.7 % of a 16 ms frame, and the trade buys correct incrementality
on trees the boundary cache cannot (no explicit-sized boundary
needed). `bench/thresholds.json` is recalibrated for the new engine:
`hotrelayoutboundary` 0.1 → 1.5 ms (matching its sibling
`hotrelayout`, now the same engine and ~same local cost),
`hotrelayouttext (layout)` 0.1 → 0.5 ms — both with CI-variance
headroom (~5–7× dev-local).
