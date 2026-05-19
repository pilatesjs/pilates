# Phase 11 — Structural differential fuzzer

## Problem

The Spineless engine has two differential fuzzers:

- `flex-grammar.fuzz.test.ts` (v17) — random STATIC trees, grammar vs
  imperative float layout.
- `runtime-incremental.fuzz.test.ts` (v18) — random VALUE mutation
  sequences at the **runtime** level (`markStyleDirty` + `recompute`)
  vs imperative.

Neither exercises the `SpinelessLayout` **driver's structural
fast-paths**. `tryGraftAppend` (v21, v32) and `tryDetachRemove` (v31)
— insert and remove at any index, the graft / detach / rebuild
classifier, the temporary re-attach in `tryDetachRemove`, the
value-diff-after-structural step — are covered only by hand-written
`spineless-layout.test.ts` cases and the fragment unit tests. A bug
in the classifier, in fragment application order, or in the
interaction of a structural mutation followed by a value mutation
would slip every fuzzer.

Fuzzers have paid off on this engine before — the phase-2/3 layout
cache fuzzer caught three real divergences theoretical analysis
missed. The structural fast-paths are the least-fuzzed, most
intricate part of the driver. Phase 11 builds the missing backstop.

## Approach

A new driver-level fuzzer, `spineless-structural.fuzz.test.ts`. For a
random initial tree it applies a random sequence of mutations —
insert / remove / move a subtree, plus value tweaks — and after every
step asserts the **incrementally-driven** `SpinelessLayout` produces a
layout byte-identical to a **cold** `SpinelessLayout` of the same
tree.

### Why incremental-vs-cold, not incremental-vs-imperative

Comparing a driver (which rounds to integer cells) against the
imperative algorithm reintroduces the `x.5`-boundary rounding
divergence the float-tolerance fuzzers were built to avoid — random
sizes land values exactly on a cell boundary, and sub-ULP noise
between two layout algorithms rounds them apart.

Two runs of the **same** engine have no such noise: a cold
`SpinelessLayout` and an incrementally-driven one compute each
Field through the identical `rule.compute`, reach the same
fixpoint, and round the same floats — so they must be **byte-
identical**. That is also the precise property under test: *do the
structural fast-paths drift from a cold rebuild?* Spineless-vs-
imperative correctness for any given tree is already the grammar
fuzzer's job, and a mutation-sequence-produced tree is just a tree
within its covered distribution — so `incremental == cold ≈
imperative` holds transitively.

## Slices

- **v33 — structural differential fuzzer.** The new fuzzer:
  random tree, random insert / remove / move / value sequence,
  incremental `SpinelessLayout` vs cold `SpinelessLayout` checked
  after every step. Any divergence is reproduced from its
  `fast-check` seed and pinned as a deterministic regression test.
- **v34 — reorder fast-path.** A child move (one parent's children
  permuted — no node added or removed) satisfied neither
  `tryGraftAppend` nor `tryDetachRemove`, so it fell to a full
  rebuild. `tryReorder` + `buildReorderFragment` patch the runtime
  instead: the grammar is rebuilt O(tree), then the reordered
  parent's + its in-flow children's `width / height / left / top`
  rules are rebound, with `graft` / `detach` for the input fields a
  reorder makes newly read / unread (a node's main-end margin, once
  it gains or loses a follower). The v33 fuzzer's `move` mutation
  validates it — and immediately caught a bug shared with the
  non-simple append / remove branches: they rebuilt the grammar with
  an empty `available`, so an `'auto'` root's size rule lost its
  clamp. All three fragment builders now thread the caller's
  `available` into the rebuild.

## Slice v33 — structural differential fuzzer

`packages/core/src/algorithm/spineless/spineless-structural.fuzz.test.ts`.

### Tree + mutation generators

The random-tree arbitrary is the one
`runtime-incremental.fuzz.test.ts` already uses (numeric-leaning
sizes, all flex features, `display: 'none'` and absolute leaves) —
extracted or copied so the structural fuzzer covers the same feature
surface.

Mutations (`fast-check` arbitraries, replayable as plain data so the
same sequence drives both trees):

- **insert** — `{ kind: 'insert', path, index, subtree: NodeSpec }`.
  `path` locates a node; `subtree` is a fresh small random tree
  inserted at `index` (clamped to `[0, childCount]`).
- **remove** — `{ kind: 'remove', path, index }`. Removes the child
  at `index` (clamped); a no-op when the node is childless.
- **move** — `{ kind: 'move', path, from, to }`. Detaches the child
  at `from` and re-inserts it at `to` — a reorder.
- **value** — the existing scalar / edge mutations
  (`setWidth` on a numeric axis, `setMin*`, `setGap`, …).

`buildTree(spec)` constructs an independent `Node` tree from a spec,
so insert subtrees and the two parallel trees are built from the same
spec data without aliasing.

### The property

```
build spec  →  tree A,  tree B  (independent, identical)
slA = new SpinelessLayout(A);  slA.layout()
new SpinelessLayout(B).layout()           // cold baseline
assert snapshot(A) == snapshot(B)

for each mutation m:
    apply(m, A);  apply(m, B)
    slA.layout()                          // incremental
    new SpinelessLayout(B).layout()       // fresh cold driver
    assert snapshot(A) == snapshot(B)      // byte-identical
```

`snapshot` is the existing `spineless-layout.test.ts` helper shape —
every node's `left / top / width / height / scrollWidth /
scrollHeight`. `apply` mutates a tree with `insertChild` /
`removeChild`; a `move` is `removeChild` then `insertChild`.

`numRuns` ≈ 300 (matching the sibling fuzzers), 1–15 mutations per
run. A failing run prints the seed; the divergence is minimised,
reproduced as a fixed tree + sequence, and pinned in
`spineless-layout.test.ts` before the underlying bug is fixed.

### Validation

The fuzzer is itself the validation. It joins `pnpm test` and the
`test:differential` chain like the other fuzz files. Any bug it
surfaces is fixed on the v33 branch with a pinned regression test, as
the phase-7 / phase-2 fuzzers' divergences were.

## Validation

Each slice keeps the full suite green (`npx vitest run`), `pnpm
typecheck` and `pnpm lint` clean, and `pnpm bench:budgets` within
thresholds. Slices land one branch / one PR each.
