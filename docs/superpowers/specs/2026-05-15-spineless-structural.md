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
4. **Regime-aware patching.** Appending into / removing from a
   flex-distributing / justified / wrapping parent additionally
   *rewrites* existing siblings' rules (their dep sets change).
   Direction / wrap / positionType flips re-key whole subtrees.

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
