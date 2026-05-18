# Phase 9 — Incremental layout observability ("devtools")

## Problem

Phase 8 put the Spineless incremental engine behind the public
`calculateLayout` (`#114`, `3a3b5ab`). It is validated and fast — but
it is **invisible**. A consumer cannot tell whether a given
`calculateLayout` call rebuilt the grammar, grafted, relaid
incrementally, or fell back to the imperative path; cannot see how
much of the tree a mutation actually touched; and cannot profile a
slow frame.

The only observability that exists is `SpinelessLayout.stats` — an
`@internal` triple-counter (`fullBuilds` / `incrementalRelayouts` /
`graftRelayouts`) reachable from no public surface. The runtime
itself reports nothing: `recompute()` returns the changed Fields but
no count of Fields *visited*, and exposes no init size.

Phase 9 builds observability bottom-up so the engine's incremental
behaviour can be seen, measured, and debugged from the public API —
the foundation a future devtools panel or `pilates-doctor` CLI reads.

## Approach

Instrument from the runtime upward, each layer feeding the next:

```
runtime counters  →  driver per-call trace  →  public profiler hook  →  node inspector
   (v25)                  (v26)                     (v27)                  (v28)
```

The public surface is a single opt-in global hook,
`setLayoutProfiler(listener)`. When no profiler is registered, no
trace object is built and the hot path is byte-for-byte unchanged —
observability is strictly pay-for-what-you-use. The `LayoutTrace`
record and an `inspectLayout` formatter round out a devtools-console
surface.

### Not in scope — `setLayoutBoundary`

Phase 3's relayout boundaries were an artefact of the *imperative*
layout cache: an explicit-sized subtree could be skipped on a root
cache hit. Under Spineless the dependency graph **is** the
incrementality — a mutation propagates only along the Fields that
actually read it, with no explicit-sized boundary required (phase-8
spec, v24 bench note). An opt-in `setLayoutBoundary` would therefore
control a mechanism the production engine no longer uses. It is
dropped from Phase 9 rather than carried as dead API; if a future
need for consumer-directed relayout scoping appears it gets its own
spec.

## Slices

- **v25 — runtime recompute counters.** `SpinelessRuntime` gains a
  zero-allocation `stats` record — `initFields` (Fields integrated by
  `init`/`graft`), `recomputeVisited` / `recomputeChanged` for the
  last `recompute()`, and cumulative `totalVisited`. Plain integer
  increments on existing loops; always on.
- **v26 — `SpinelessLayout` per-call trace.** Each `layout()` records
  a `LayoutTrace`: the path taken (`build` / `graft` / `incremental`),
  dirty-region size, Fields visited / changed (from v25), and
  moved-subtree count. Exposed as `lastTrace`. The `stats`
  triple-counter is unchanged.
- **v27 — public profiler API.** `setLayoutProfiler(listener)` — a
  global opt-in hook invoked with `(root, trace)` after every public
  `calculateLayout`. `LayoutTrace` becomes a public type. Zero cost
  when unset. Exported from `@pilates/core`.
- **v28 — `inspectLayout` node dump.** A public
  `inspectLayout(node)` returning a formatted, indented subtree dump —
  each node's computed box, scroll extents, dirty state — plus the
  root's last engine path. Devtools-console-friendly. Exported.

## Slice v25 — runtime recompute counters

`SpinelessRuntime` gains a public readonly `stats`:

```ts
readonly stats = {
  /** Fields integrated so far (init + every graft). */
  initFields: 0,
  /** Fields popped from the PQ by the most recent recompute(). */
  recomputeVisited: 0,
  /** Of those, Fields whose value actually changed. */
  recomputeChanged: 0,
  /** Cumulative Fields visited across every recompute() since init. */
  totalVisited: 0,
};
```

- `integrate()` bumps `initFields` once per Field it allocates an OM
  node for — so it counts both the `init` pass and every `graft`.
- `recompute()` resets `recomputeVisited` / `recomputeChanged` to 0 at
  entry, increments `recomputeVisited` on each `popMin`, and
  `recomputeChanged` whenever it records a changed value;
  `totalVisited` accumulates.

The counters are plain number fields on a literal — no allocation per
call, no branch on an "enabled" flag. The existing `recompute()`
return value (the changed-Field array) is unchanged.

### Tests

`runtime.test.ts` gains a `stats` describe: after `init`,
`initFields` equals the grammar size and the recompute counters are
0; after a `markDirty` + `recompute` of a Field that propagates,
`recomputeVisited` ≥ `recomputeChanged` ≥ 1; a no-op `recompute()`
(dirty Field re-computes to the same value) visits 1 and changes 0;
a `graft` raises `initFields`; `totalVisited` is monotonic across
calls.

## Slice v26 — `SpinelessLayout` per-call trace

A `LayoutTrace` record lives in `spineless/layout.ts`:

```ts
export interface LayoutTrace {
  /** Engine path this layout() call took. */
  path: 'build' | 'graft' | 'incremental';
  /** Nodes the dirty-flag walk classified as dirty (0 on build). */
  dirtyNodes: number;
  /** Grammar Fields the runtime re-ran (0 on a pure build). */
  fieldsRecomputed: number;
  /** Of those, Fields whose value changed. */
  fieldsChanged: number;
  /** Maximal moved-subtree roots written back (0 on build/graft —
   *  those finish whole-tree). */
  movedSubtrees: number;
}
```

`SpinelessLayout` gains `private _lastTrace: LayoutTrace | null` and a
`get lastTrace()` accessor. Each `layout()` path fills one in before
returning:

- **build** — `path: 'build'`, `dirtyNodes: 0`,
  `fieldsRecomputed: 0`, `fieldsChanged: 0`, `movedSubtrees: 0`. (A
  build computes every Field once during `integrate`, which is
  counted by `initFields`, not `recomputeVisited`.)
- **graft** — `path: 'graft'`, `dirtyNodes` = the classified dirty
  count, `fieldsRecomputed` / `fieldsChanged` from the post-graft
  `recompute()`'s `stats`, `movedSubtrees: 0` (graft finishes
  whole-tree).
- **incremental** — `path: 'incremental'`, `dirtyNodes` =
  `dirty.length`, `fieldsRecomputed` / `fieldsChanged` from `stats`,
  `movedSubtrees` = the `relayoutValues` root count.

The `runtime.stats` reads happen right after the relevant
`recompute()`, before any further runtime call, so they reflect that
call only.

### Tests

`spineless-layout.test.ts` gains a `slice v26` describe: a persistent
driver run through a value mutation reports `path: 'incremental'`
with `dirtyNodes` matching the mutated count and
`fieldsChanged ≥ 1`; a no-op mutation (set a style to its current
value) reports `incremental` with `fieldsChanged: 0`; a child append
reports `graft`; a flex-direction flip reports `build`; the very
first `layout()` reports `build`; `movedSubtrees ≥ 1` for an
incremental relayout that shifts a subtree. The v19–v23 cases pass
unchanged.

## Slice v27 — public profiler API

`algorithm/index.ts` gains a module-level profiler hook:

```ts
export type LayoutProfiler = (root: Node, trace: LayoutTrace) => void;

let profiler: LayoutProfiler | null = null;

/** Register a profiler invoked after every calculateLayout, or null
 *  to disable. While unset, layout tracing is fully off. */
export function setLayoutProfiler(listener: LayoutProfiler | null): void {
  profiler = listener;
}
```

`calculateLayout` (non-differential branch only) invokes the profiler
once per call when one is registered:

- **imperative fallback / cold first layout** — synthesise a
  `LayoutTrace` with `path: 'imperative'` (a new `LayoutTrace.path`
  member) and all counters 0. The imperative path has no Spineless
  trace; reporting `imperative` is the honest signal that the engine
  did not run.
- **Spineless path** — after `driver.layout(...)`, read
  `driver.lastTrace` and forward it.

When `profiler` is `null` the function does nothing extra — no trace
object, no `lastTrace` read difference (the driver always sets
`_lastTrace`; that is one small allocation already paid by v26 and
independent of the profiler). The profiler hook adds zero cost when
unset: a single `if (profiler !== null)` guard.

Differential mode (`PILATES_DIFFERENTIAL_LAYOUT=1`) does not invoke
the profiler — it runs the imperative algorithm twice and is a test
harness, not a consumer path.

`LayoutTrace` and `LayoutProfiler` and `setLayoutProfiler` are
re-exported from `packages/core/src/index.ts`. `LayoutTrace.path`
gains the `'imperative'` member; `spineless/layout.ts` only ever sets
the other three, so the driver code is unchanged.

### Tests

`algorithm/index.test.ts` gains a `setLayoutProfiler` describe: a
registered profiler fires once per `calculateLayout` with the laid-out
root; the first call reports `path: 'imperative'`; a second call on
the same root reports `'build'` (Spineless adopts on the 2nd layout,
first Spineless call rebuilds); a third after a value mutation reports
`'incremental'`; `setLayoutProfiler(null)` stops the callbacks; a tree
the grammar cannot cover (`display: 'none'`) always reports
`'imperative'`. `core/index.test.ts` asserts the three symbols are on
the public surface.

## Slice v28 — `inspectLayout` node dump

A new `packages/core/src/inspect.ts` exports:

```ts
/** A human-readable, indented dump of `node`'s computed-layout
 *  subtree — box, scroll extents and dirty state per node — for
 *  devtools and console debugging. Pure; allocates only the string. */
export function inspectLayout(node: Node): string;
```

Each line is `<indent><box>  <flags>`:

- `box` — `left,top widthxheight` from `node._layout` (rounded
  integer cells, the same values `getComputedLayout` reports).
- `flags` — `scroll=WxH` when the scroll extent exceeds the box;
  `dirty` when `node.isDirty()`; `dirty-desc` when
  `_hasDirtyDescendant` without the node itself dirty.
- indent is two spaces per depth.

The root line is prefixed with the engine path the root last took, if
known — `inspectLayout` reads the same per-root state `calculateLayout`
records. To avoid `inspect.ts` importing the `algorithm` module's
`WeakMap`, the router exposes an `@internal`
`lastLayoutPath(root): LayoutTrace['path'] | undefined` (reading the
last forwarded trace, stored alongside `layoutEngines`). When no
layout has run, the prefix is omitted.

`inspectLayout` is exported from `packages/core/src/index.ts`.

### Tests

`inspect.test.ts`: a laid-out three-node tree dumps three indented
lines with correct boxes; a scrolling subtree shows the `scroll=`
flag; a node mutated but not yet relaid shows `dirty`; the root line
carries the engine path after a `calculateLayout`; an un-laid-out
tree dumps boxes of `0,0 0x0` with no path prefix. `core/index.test.ts`
asserts `inspectLayout` is exported.

## Validation

Each slice keeps the full suite green (`npx vitest run`), `pnpm
typecheck` clean, and `pnpm bench:budgets` within thresholds — the
profiler hook is the only hot-path change and is guarded behind a
null check, so the budgets must not move. Slices land one branch /
one PR each, in order v25 → v28.
