# Phase 10 — Close the imperative fallbacks

## Problem

The public `calculateLayout` routes a tree through the Spineless
incremental engine — but only when `spinelessSupports(root)` says the
grammar covers the whole subtree. Two features it does not model send
the **entire tree** onto the imperative path, forever:

- a `display: 'none'` node anywhere in the subtree;
- a measure function on a `positionType: 'absolute'` node.

The grammar has zero `display` handling (`buildFlexGrammar` never
reads it), and the absolute-node rules never consult a measurer. A
single hidden node — a common pattern, e.g. a conditionally-rendered
panel — disqualifies the whole tree from incremental layout.

Separately, the only structural mutation the driver patches
incrementally is a **single last-child append** (`tryGraftAppend`,
v21). Every other structural change — a removal, a mid-list insert, a
reorder — forces a full O(tree) grammar rebuild, even though the
runtime already has `detach` / `rebindRule` primitives and
`flex-grammar.ts` already exports a `buildRemoveFragment` builder
that is **defined and unit-tested but wired into nothing**.

Phase 10 closes both gaps: the grammar covers every tree (so the
imperative fallback disappears), and the common structural mutations
patch the runtime instead of rebuilding it.

## Approach

Two themes, coverage first:

```
COVERAGE          v29 display:none  →  v30 absolute+measure  →  (spinelessSupports removed)
STRUCTURAL        v31 last-child remove  →  v32 mid-list insert / remove
```

After v29 + v30 the grammar models every tree the imperative
algorithm does; `spinelessSupports` and the router's
grammar-unsupported branch are deleted. The imperative algorithm
stays — it still serves a root's deliberate cold *first* layout (no
grammar to amortise) and differential mode — but it is no longer a
*coverage* fallback.

v31 wires the already-built `buildRemoveFragment`; v32 extends the
fragment builders past the last-child restriction. A reorder (v33)
is reassessed after v32 — a move is a remove + insert, so v32's
machinery may cover it directly or with a thin classifier.

## Slices

- **v29 — `display: 'none'` grammar coverage.** The emitter lays a
  `display: 'none'` node (and its subtree) out as a zero box and
  excludes it from its parent's flex flow, content sizing and sibling
  positioning — mirroring the imperative algorithm. `spinelessSupports`
  drops its `display: 'none'` rejection.
- **v30 — measure function on an absolute node.** The absolute-node
  size rules consult the node's measure function for an `'auto'`
  dimension, exactly as an in-flow measure leaf does.
  `spinelessSupports` — now always `true` — and the router's
  unsupported branch are removed.
- **v31 — last-child remove fast-path.** `SpinelessLayout` gains
  `tryDetachRemove`, the mirror of `tryGraftAppend`: a single
  last-child removal patches the runtime via `buildRemoveFragment` +
  `runtime.detach` (+ `rebindRule` for a non-simple parent) instead
  of rebuilding. `stats` gains `detachRelayouts`; `LayoutTrace.path`
  gains `'detach'`.
- **v32 — mid-list insert / remove.** `buildAppendFragment` /
  `buildRemoveFragment` are generalised past the last-child
  restriction: a simple-regime insert / remove at any index
  fast-paths by rebinding the later in-flow siblings' main-position
  rules. Non-simple regimes still rebuild.

## Slice v29 — `display: 'none'` grammar coverage

`buildFlexGrammar`'s emitter (`makeEmitter`) currently assumes every
node participates in layout. v29 teaches it the `display: 'none'`
case, matching `calculateLayoutImpl`:

- A `display: 'none'` node emits constant-`0` rules for its `width`,
  `height`, `left`, `top` — and the recursion still descends, so its
  descendants are emitted as zero boxes too (a hidden subtree
  occupies no space and has no computed layout).
- Its **parent** skips it everywhere an in-flow child is consulted:
  main-axis packing, cross-axis sizing, flex distribution, justify
  leftover, wrap line-breaking, and `'auto'` content sizing. The
  emitter already has the `positionType === 'absolute'` skip at each
  of those sites (`flex-grammar.ts` lines ~558, ~732, ~927, ~1159,
  ~1803, ~1932) — `display: 'none'` joins the same predicate via a
  shared `isInFlow(child)` helper (`positionType !== 'absolute' &&
  display !== 'none'`).

`spinelessSupports` (`algorithm/index.ts`) drops the
`display === 'none'` check. `nodeSig` (`layout.ts`) already includes
`s.display`, so toggling a node's `display` to or from `'none'` is a
structural change → rebuild — correct, since it reshapes the parent's
flex flow.

### Tests

`spineless-layout.test.ts` gains a `slice v29` describe: trees with a
hidden leaf, a hidden middle child (siblings must close the gap), a
hidden subtree, a hidden flex-growing child (its weight leaves the
distribution), and a hidden child under an `'auto'` parent — each
laid out by `SpinelessLayout` and imperative `calculateLayout` and
asserted byte-identical. A persistent driver toggling `display`
between `'flex'` and `'none'` confirms the rebuild path. `flex-grammar.fuzz.test.ts`'s
node generator starts emitting `display: 'none'` so the differential
fuzzer covers it.

## Slice v30 — measure function on an absolute node

An `'auto'`-sized in-flow leaf with a measure function already routes
through `isMeasureLeaf` + the measure-consulting size rules. An
absolute node does not: `emitAbsoluteRules` resolves an `'auto'`
dimension from its `position` edges or falls to `0`, never calling
the measurer.

v30 makes the absolute size rules measure-aware: when an absolute
node has a measure function and an `'auto'` dimension that its
`position` edges do not pin (no opposing `left`/`right` or
`top`/`bottom` pair), the rule consults the measurer — reusing the
in-flow leaf's measure-input Field and `callMeasureFunc` path so the
8-slot `MeasureCache` still applies.

With both gaps closed, `spinelessSupports` always returns `true`. The
function, its call site, and the router's `if (!spinelessSupports)`
imperative branch are deleted; `calculateLayout`'s non-differential
body is just the cold-first / Spineless-thereafter routing.

### Tests

`spineless-layout.test.ts` gains a `slice v30` describe: an absolute
node with a measure function and no size; with one edge pinned and
one `'auto'`; with both edges pinned (measurer must NOT be consulted
— the edges win); nested inside an in-flow tree — each differential
against imperative `calculateLayout`. A test asserts a tree that
previously fell back (absolute + measure) now reports a Spineless
`LayoutTrace.path` from its second layout. The fuzzer's node
generator allows a measure function on absolute nodes.

## Slice v31 — last-child remove fast-path

`buildRemoveFragment(prev, root, parent, child)` already exists and
is unit-tested (`remove-fragment.test.ts`) — the inverse of
`buildAppendFragment`: for a last-child removal in the simple regime
it returns the fields to `detach` and the surviving siblings to
`rebindRule`; it returns `null` for a non-last child or a reverse
parent. It is wired into nothing.

v31 adds `SpinelessLayout.tryDetachRemove`, structured like
`tryGraftAppend`:

- The dirty-walk classifier already flags a removal as structural.
  `tryDetachRemove` compares the built `snaps` to the current tree:
  no node added, ≥ 1 removed, every surviving node's `nodeSig` /
  measure unchanged, and the removed nodes form exactly one subtree
  whose root's parent survives.
- It calls `buildRemoveFragment` **before** the runtime mutation
  (the builder reads the pre-removal grammar). On a non-`null`
  fragment it applies the `rebinds`, `detach`es the removed subtree's
  fields, adopts `fragment.next`, re-collects inputs / snaps /
  indexes, runs the value diff + `recompute()`, and returns `true`.
- `layout()` tries `tryGraftAppend`, then `tryDetachRemove`, then
  falls back to a rebuild.

`stats` gains `detachRelayouts`. `LayoutTrace.path` gains `'detach'`
(`spineless/layout.ts`); the v26 trace logic sets it on the detach
branch with `dirtyNodes` / recompute counts like the graft branch.
The public `LayoutTrace` doc and the v27 profiler are unaffected —
`'detach'` is just another driver path the union already widens for.

### Tests

`spineless-layout.test.ts` gains a `slice v31` describe: removing the
last child / several last children in sequence / a whole last-child
subtree / a last child from a flex-distributing parent — each takes
the detach path (`stats.detachRelayouts` confirms) and is differential
against imperative `calculateLayout`; a mid-list removal and a
reverse-parent removal fall back to rebuild; an append-then-remove
sequence exercises both fast-paths. `LayoutTrace.path` is asserted
`'detach'` for a removal.

## Slice v32 — mid-list insert / remove

`buildAppendFragment` returns `null` unless `child` is the last
child; `buildRemoveFragment` likewise. v32 lifts that restriction for
the **simple regime** (no flex distribution, `flex-start` justify, no
wrap, non-reverse direction):

- A mid-list **insert** adds the new subtree's fields (a `graft`, as
  today) *and* shifts every later in-flow sibling's main start — in
  the simple regime each later sibling's main-position rule just adds
  one more preceding-sibling extent, a bounded `rebindRule` per later
  sibling. The fragment carries those rebinds.
- A mid-list **remove** is the inverse: `detach` the removed
  subtree, `rebindRule` each later in-flow sibling's main-position
  rule to drop the gone extent.
- The driver classifiers (`tryGraftAppend` / `tryDetachRemove`) drop
  their "must be last child" guard and accept any single
  contiguous-subtree insert / remove; a non-simple parent still
  rebuilds (the fragment builder returns `null`).

Cost is O(subtree + later-siblings) — still sublinear in the whole
tree for an insert near the tail, O(tree) worst case for an insert at
the head, but never a grammar rebuild.

### Tests

`spineless-layout.test.ts` gains a `slice v32` describe: inserting /
removing a child at the head, the middle, and (regression) the tail;
a sequence of mixed-index inserts and removes; mid-list mutation in a
flex-distributing parent still rebuilds — each differential against
imperative `calculateLayout`. The v21 obsolete-case note is revisited:
"a mid-list insert falls back to a rebuild" becomes "mid-list insert
fast-paths". `remove-fragment.test.ts` / the append-fragment tests
gain mid-list cases.

## v33 — reorder (reassess)

A child move is a remove + an insert of the same node. After v32 the
driver may already classify a reorder as one detach + one graft, or
need a thin "permutation" classifier that rebinds only the moved
sibling band's positions. Specced as a follow-up once v32's mid-list
machinery is in hand — it determines whether v33 is a small slice or
unnecessary.

## Validation

Every slice keeps the full suite green (`npx vitest run`), `pnpm
typecheck` and `pnpm lint` clean, and `pnpm bench:budgets` within
thresholds. The differential fuzzers (`flex-grammar.fuzz.test.ts`,
`runtime-incremental.fuzz.test.ts`) are the correctness backstop —
v29 / v30 widen their generators so the new coverage is fuzzed, and
v31 / v32 are exercised by the incremental fuzzer's mutation set.
Slices land one branch / one PR each, in order v29 → v32.
