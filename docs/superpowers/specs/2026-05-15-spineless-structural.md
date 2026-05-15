# Phase 5c — Spineless structural incrementality

## Problem

Phases 5a/5b made the Spineless engine incremental for **style-value
mutations**: build the grammar once, mutate any numeric style prop,
`markStyleDirty` it, `recompute()` — propagation reaches exactly the
affected layout fields.

But the grammar is still **fixed at build time**. Any change to the
tree *shape* forces a full `buildFlexGrammar()` + a fresh
`SpinelessRuntime` + `init()`:

- inserting / removing a child,
- flipping `flex-direction`, `flex-wrap`, or `positionType`,
- toggling a flex weight / `flexBasis` across the zero / numeric
  boundary (which flips whether a parent flex-distributes).

Real TUIs change tree shape constantly (rows appended to a list,
panels shown/hidden). A full rebuild on every frame defeats the
point of an incremental engine.

## Approach

Make the dependency graph itself patchable. The runtime gains
operations that splice fields in / out, keep the Order-Maintenance
structure and reverse-dependency edges consistent, and recompute
only the affected fragment.

This is sliced from the easy end (pure additions at the topological
tail) toward the hard end (regime flips that rewrite existing
rules):

1. **`graft` — additive field insertion (this slice).** A runtime
   primitive that integrates new fields whose OM position is at the
   topological *end* — i.e. new fields may depend on existing fields,
   but no existing field depends on a new one, and no existing rule
   changes. This is exactly the shape of *appending* a child to a
   parent in the "simple" regime (no flex distribution, default
   `justify`, no wrap): the new subtree's fields are pure leaves at
   the tail of topo order.
2. **Append-child fragment (landed).** `buildAppendFragment` is the
   grammar-side helper that, given the previous `FlexGrammarOutput`,
   the tree root, the parent, and a freshly appended last child,
   decides whether the append is a pure simple-regime graft and, if
   so, returns the `{ additions, newRoots }` to hand to `graft` plus
   a refreshed full `FlexGrammarOutput`. It returns `null` when a
   rebuild is required instead — so callers get `insertChild`-then-
   relayout without manually diffing grammars.
3. **Simple-regime removal (landed).** `SpinelessRuntime.detach`
   drops a removed subtree's fields — freeing OM nodes, pruning the
   reverse-dependency edges, deleting cached values — the inverse of
   `graft`. `buildRemoveFragment` is the validating mirror of
   `buildAppendFragment`: it decides whether removing a last child
   is a pure topological-tail subtraction and returns the `detach`
   inputs, or `null` for a rebuild.
4. **Regime-aware append (landed).** Appending into a
   flex-distributing / justified / wrapping parent additionally
   *rewrites* existing siblings' rules (their dependency sets grow
   to include the new child). `SpinelessRuntime.rebindRule` replaces
   a surviving field's rule and repairs its reverse-dependency
   edges; `buildAppendFragment` now returns those rewritten rules as
   `rebinds` alongside the graft inputs.
5. **Regime-aware removal + structural flips.** The mirror of slice
   4 for removal, plus `flex-direction` / `flex-wrap` /
   `positionType` flips, which re-key whole subtrees.

## Slice 1 — `SpinelessRuntime.graft`

`graft(additions: Grammar, newRoots: ReadonlyArray<Field>)`:

- Merges `additions` (rules for the new fields only — throws if any
  field already exists in the runtime) into the runtime's grammar.
- DFS from `newRoots` in the same topological manner as `init()`:
  for each not-yet-integrated field, recurse into its deps, record
  the reverse-dependency edges (including new → existing edges, so a
  later change to an existing field reaches the new ones), allocate
  an OM node **after the current tail** (`om.insertAfter(lastOm)`),
  run the rule, and cache the value.
- Fields already integrated (existing fields reached as deps of new
  fields) are boundaries: visited, edge recorded, not re-walked.

`init()` is refactored to share the DFS via a private `integrate`
helper, and the runtime now tracks `lastOm` (the OM tail) so `graft`
can append after it.

### Correctness contract

`graft` alone produces a correct layout **iff** the new fields are
pure topological additions: no existing field reads a new field, and
no existing rule needed to change. The caller guarantees this. For
the simple-regime append it holds by construction — appending a last
child can't move any prior sibling (their flex-start positions
depend only on *prior* siblings) and can't resize a non-flex parent.
Regimes where appending *does* perturb existing fields are slice 3.

Because the new fields are computed with correct inputs during the
graft itself, no `markDirty` / `recompute` is needed afterward in
the pure-additive case.

### Tests

`runtime-graft.test.ts`: hand-built grammars grafted field-by-field;
and a realistic path — build a tree, `buildFlexGrammar`, `init`;
append a child to a simple-regime parent; diff the rebuilt grammar
(`G2 \ G1`) for the additions; `graft`; assert the runtime's layout
is byte-identical to a fresh runtime over `G2`.

## Slice 2 — `buildAppendFragment`

`buildAppendFragment(prev, root, parent, child)` returns an
`AppendFragment | null`:

- **`null`** — the append is not a pure topological-tail graft and a
  full rebuild is required: `child` is not `parent`'s last child, or
  (for a non-absolute child) `parent` flex-distributes / uses a
  non-default `justify` / wraps.
- **`{ additions, newRoots, next }`** — the append is pure-additive.
  `additions` / `newRoots` feed `graft`; `next` is a fresh full
  `FlexGrammarOutput` the caller adopts for subsequent operations.

An absolute child is always pure-additive — it is filtered out of
every in-flow computation, so it perturbs no sibling regardless of
the parent's regime.

The current implementation rebuilds the grammar (cheap — Field
allocation + closures, no layout compute) and diffs it against
`prev` to isolate the new subtree's fields. The expensive layout
work stays incremental through `graft`. A fragment-only build that
walks just the appended subtree (O(subtree) instead of O(tree) for
the grammar pass) is a later optimisation.

### Tests

`append-fragment.test.ts`: simple-regime appends (row / column /
nested / absolute-into-flex / a run of successive appends) graft to
a layout byte-identical to a fresh build; the non-simple cases
(flex-distributing parent, non-default justify, wrap, child not
last) each return `null`.

## Slice 3 — `detach` + `buildRemoveFragment`

The mirror of slice 1 + 2 for child removal.

`SpinelessRuntime.detach(fields)` drops the exact set of a removed
subtree's fields: for each it frees the OM node (`om.delete`), drops
the cached value and reverse-dependency list, deletes the rule, and
prunes the field from the reverse-dependency list of everything it
read. It throws if any removed field still has a dependent *outside*
the set (a dangling cut). The OM tail (`lastOm`) is recomputed
afterward so a later `graft` still appends after every survivor.

`buildRemoveFragment(prev, parent, child)` returns
`RemoveFragment | null`. Call it **before** detaching `child` from
`parent` — the simple-regime validation (identical to
`buildAppendFragment`, and checking `parentNeedsFlexDistribution`
with `child` still attached) needs `child` in place. On success it
returns `removed` (the subtree's fields, for `detach`) and `next`
(a `FlexGrammarOutput` derived by filtering `prev` — no rebuild, the
simple regime leaves every survivor's rule unchanged).

### Tests

`runtime-graft.test.ts` gains `detach` primitive tests (remove a
grafted field, the reverse-dep prune, graft-after-detach, the
before-init and dangling-dependent throws). `remove-fragment.test.ts`
covers simple-regime removals (row / column / nested / absolute /
an append-then-remove round trip) detaching to a layout
byte-identical to a fresh build, and the non-simple `null` cases.

## Slice 4 — `rebindRule` + regime-aware append

Appending into a flex-distributing / justified / wrapping parent is
not a pure addition: every existing in-flow sibling's layout rule is
*rewritten*, because flex distribution, the justify leftover, and
wrap packing all read every sibling — so each sibling's rule gains
the new child's input fields as dependencies.

`SpinelessRuntime.rebindRule(field, newRule)` installs a new rule on
an existing field: it repairs the reverse-dependency edges (drops
`field` from deps it no longer reads, adds it to deps it now reads),
marks the field dirty, and keeps its OM node.

### The OM-order observation

A rebound sibling's OM node predates the just-grafted child's input
fields, so the sibling now depends on *later*-OM fields — the
topological invariant the OM gave us is broken. This is fine:

- **Correctness + termination** rest only on the dependency graph
  being acyclic. The worklist reaches the DAG's unique fixpoint in
  finitely many steps regardless of OM order.
- The **immediate** post-append `recompute` is still optimally
  ordered: only the rebound siblings are dirty, and they read the
  grafted child's inputs which are *not* dirty (computed during the
  graft) — so each recomputes once.
- A *later* mutation that dirties a grafted input together with a
  rebound sibling in one batch may recompute that sibling a bounded
  number of extra times. OM order is a performance property, not a
  correctness one.

True OM re-insertion / relabeling (restoring the O(affected) bound
for those later mutations) is deferred to a future slice.

### `buildAppendFragment` (extended)

It no longer returns `null` for non-simple parents. For any
last-child append into a row/column parent it returns
`{ additions, newRoots, rebinds, next }`: `rebinds` is empty in the
simple regime, and otherwise carries every existing in-flow
sibling's four layout fields paired with their rebuilt rules. The
caller applies `graft`, then `rebindRule` for each rebind, then
`recompute()`. `null` is returned only when a true rebuild is
needed — `child` is not the last child, or the parent uses a
reverse `flex-direction`.

### Tests

`runtime-graft.test.ts` gains `rebindRule` primitive tests (rule
replacement, the new-dependency edge, the dependency prune via a
recompute-count probe, the before-init / unknown-field /
unintegrated-dependency throws). `append-fragment.test.ts` covers
regime-aware appends — into flex-distributing / space-between /
centered / wrapping parents — each grafting + rebinding to a layout
byte-identical to a fresh build, plus a later-mutation case that
exercises the OM-disorder path.
