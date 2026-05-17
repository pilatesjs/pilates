# Phase 7 — Spineless differential fuzz validation

## Problem

The Spineless flex grammar now reproduces the whole imperative
`calculateLayout` (phases 5–6). It is gated by ~250 hand-written
differential tests in `flex-grammar.test.ts` — but those each
exercise *one* feature in isolation. The combinatorial surface
(`'auto'` × `wrap-reverse` × `aspectRatio` × min/max × a measure
leaf × `row-reverse` …) is far larger than any hand-written corpus.

Before Spineless is wired in behind the public API, that surface
needs random coverage. The project's history says this pays off:
the imperative cache fuzzer (`cache.fuzz.test.ts`) caught three real
bugs that theoretical analysis missed — when the fuzzer disagrees
with reasoning, the fuzzer wins.

## Approach

A property-based differential fuzzer (`fast-check`): generate a
random `Node` tree spanning the full v1–v16 feature set, then assert
the Spineless result is **byte-identical** to the imperative
`calculateLayout`. Two layers:

1. **Static** (v17) — `evaluateGrammar(tree)` vs `evaluateImperative`
   over random trees. Validates the grammar's static correctness
   across feature combinations.
2. **Incremental** (v18) — random tree + a random style-mutation
   sequence; drive `SpinelessRuntime` incrementally
   (`markStyleDirty` + `recompute`) and assert it still matches the
   imperative. Validates the incremental path.

Any divergence is reproduced from its `fast-check` seed, pinned as a
deterministic regression test in `flex-grammar.test.ts`, the bug
fixed, and the seed left pinned.

## Slices

- **v17 — static differential fuzzer (landed).** A new
  `flex-grammar.fuzz.test.ts`: a recursive `NodeSpec` arbitrary
  covering numeric / `'auto'` sizes, `flexBasis`, grow / shrink,
  min / max, per-edge padding / margin, gap, all four
  `flex-direction`s, all `flex-wrap`s, justify / align*, absolute
  positioning, `aspectRatio`, and measure-function leaves. The
  property builds the tree, runs `evaluateGrammar` and
  `evaluateImperative` with a random `available`, and asserts
  equality. Found and fixed four real grammar bugs (see below).
- **v18 — incremental differential fuzzer.** Random tree + a random
  sequence of value mutations (`setWidth`, `setMinHeight`, `setGap`,
  …); after each, `markStyleDirty` the affected input Field and
  `recompute()`, asserting the runtime's layout still matches a
  fresh imperative pass.

## Slice v17 — static differential fuzzer

`flex-grammar.fuzz.test.ts` mirrors `cache.fuzz.test.ts`'s shape: an
`fc.letrec` `NodeSpec` arbitrary (leaf / node variants — measure
functions only on leaves, since `setMeasureFunc` rejects parents),
a `buildTree`, and an `fc.assert` property. The measurer generated
per leaf is deterministic and mode-aware, so a wrong measure
constraint surfaces as a divergence.

Generation ranges are kept small (sizes ≤ ~60, depth ≤ 3, ≤ 4
children) so trees stay legible when one shrinks to a counter-
example. Any divergence the fuzzer finds is pinned as a regression
test and fixed before the slice lands.

### Bugs found (v17)

The fuzzer disagreed with reasoning four times — each a real
grammar bug latent since the slice that introduced it, pinned now as
a deterministic regression in `flex-grammar.test.ts`'s
`slice v17` describe:

1. **Root honoured its own `flexBasis`.** The no-distribution main
   size rule ran `resolveBasisFromRead` (flexBasis wins) for the
   root too — but `flexBasis` is a flex-*child* property and
   `resolveRootAxisSize` never reads it. Latent since v4. Fix: the
   root branch resolves its preferred size directly, no flexBasis
   short-circuit.
2. **`align: flex-end` didn't clamp a negative inner cross.** The
   cross-position rule computed `parentCross − padEnd − …`, correct
   only when `parentCross − padStart − padEnd ≥ 0`. A container
   whose cross padding exceeds its cross size has a *zero* inner
   cross, not a negative one (the imperative
   `crossAlignItemsInLine` clamps). Latent since v6. Fix: anchor on
   `padStart + max(0, innerCross)`.
3. **The wrap regime didn't filter absolute children.** Its child
   recursion passed the raw child index and an all-children
   `priorSiblings` list — so an absolute child's margin / size
   leaked into a later in-flow sibling's main position. The
   non-wrap recursion already filtered. Latent since v7. Fix: the
   wrap recursion filters absolute children identically.
4. **An `'auto'` no-`available` root clamped to min/max.**
   `resolveRootAxisSize`'s `'auto'` + no-`available` fallback
   returns a bare `0`, *unclamped* — unlike its explicit /
   `available` paths. The grammar clamped unconditionally, so a
   root `minWidth` inflated an unavailable axis. Latent since v13.
   Fix: `rootAxisIsBareZero` flags the case; the root size rule
   skips the clamp for it.
