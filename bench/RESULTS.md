# Pilates benchmark results

Generated: 2026-05-20 · Node v26.0.0 · darwin/arm64

Reproduce: `pnpm bench`. Numbers vary by machine — relative
positions are the interesting signal.

## Scenarios

| Scenario | Tree shape |
|---|---|
| **tiny** | 10 nodes, 1 level |
| **realistic** | ~100 nodes, 3-4 levels |
| **stress** | ~1000 nodes, 2 levels |
| **big** | ~5000 nodes, 2 levels (50 × 100) |
| **huge** | ~10000 nodes, 2 levels (100 × 100) |
| **hotrelayout** | 1k-node persistent tree, mutate one leaf per pass |
| **hotrelayoutboundary** | 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf |
| **hotrelayouttext** | 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine) |
| **hotstructural** | ~1k-node table, append + remove a whole row per pass (Spineless graft / detach) |

## tiny

> 10 nodes, 1 level

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 2.9µs | 349.2k ops/s | 0 |
| @pilates/render (full) | 20.0µs | 50.0k ops/s | 0 |
| yoga-layout (WASM) | 15.4µs | 65.1k ops/s | 0 |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 32.3µs | 30.9k ops/s | 0 |
| @pilates/render (full) | 105.8µs | 9.5k ops/s | 0 |
| yoga-layout (WASM) | 268.0µs | 3.7k ops/s | 0 |

## stress

> ~1000 nodes, 2 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 180.9µs | 5.5k ops/s | 0 |
| @pilates/render (full) | 699.1µs | 1.4k ops/s | 0 |
| yoga-layout (WASM) | 1.56ms | 643 ops/s | 0 |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 1.05ms | 950 ops/s | 0 |
| @pilates/render (full) | 3.54ms | 283 ops/s | 0 |
| yoga-layout (WASM) | 7.39ms | 135 ops/s | 0 |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 2.40ms | 416 ops/s | 0 |
| @pilates/render (full) | 9.64ms | 104 ops/s | 0 |
| yoga-layout (WASM) | 15.3ms | 65 ops/s | 0 |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 19.1µs | 52.2k ops/s | 0 |
| @pilates/render (full) | 19.1µs | 52.4k ops/s | 0 |
| yoga-layout (WASM) | 57.9µs | 17.3k ops/s | 0 |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 18.5µs | 54.1k ops/s | 0 |
| @pilates/render (full) | 18.1µs | 55.4k ops/s | 0 |
| yoga-layout (WASM) | 51.5µs | 19.4k ops/s | 0 |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 20.1µs | 49.7k ops/s | 0 |
| @pilates/render (full) | 20.1µs | 49.8k ops/s | 0 |
| yoga-layout (WASM) | 47.0µs | 21.3k ops/s | 0 |
| @pilates/core (spineless) | 0.20µs | 4.99M ops/s | 0 |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 1.83ms | 548 ops/s | 0 |
| @pilates/render (full) | 1.98ms | 505 ops/s | 0 |
| yoga-layout (WASM) | 59.5µs | 16.8k ops/s | 0 |
| @pilates/core (spineless) | 188.5µs | 5.3k ops/s | 0 |
| @pilates/core (spineless rebuild) | 15.3ms | 66 ops/s | 0 |

## What's measured

Each iteration **builds a fresh tree and runs the layout pass**.
This is representative of how TUIs use a layout engine in
practice — every frame redraw constructs (or reconstructs) the
tree from declarative state.

- `@pilates/core (layout)` — build a Pilates `Node` tree,
  call `calculateLayout()`. No painting.
- `@pilates/render (full)` — build a declarative `RenderNode`,
  call `renderToFrame()` (= build core tree, calculate layout,
  paint cells into the Frame). Closest analog to Yoga doing
  layout *plus* a render layer on top.
- `yoga-layout (WASM)` — build a Yoga `Node` tree (same shape),
  call `calculateLayout()`. Layout-only baseline. The reference
  implementation Pilates is validated against cell-for-cell in
  `packages/core/test/yoga-oracle.test.ts`.

## Why Pilates wins on tree-build-then-layout

WASM Yoga's C++ layout pass is fast in isolation, but every
Node.create / setProperty crosses the JS↔WASM boundary. At
typical TUI tree sizes (10–1000 nodes per frame) the marshalling
cost dominates the compute. Pure-TS Pilates pays no such cost;
every operation is a property assignment on a JS object.

## Long-lived trees with hot relayouts

Building the tree once and mutating-and-relayouting in a loop is
the workload Yoga's WASM compute advantage traditionally shows
up on. Three scenarios cover this shape, and Pilates is now
faster than Yoga on **all three** — the incremental Spineless
engine (phases 8–12) is what makes this possible.

- `hotrelayout` — 1k-node persistent tree with no boundary
  hints. The Spineless grammar refactor (phase 12) drops the
  per-cell flex-distribution recompute from O(N²) to O(N) by
  hoisting the row's distribution into one intermediate field
  that every in-flow child reads from. **~3× faster than Yoga.**
- `hotrelayoutboundary` — same shape but with explicit-sized
  row containers (`width: N, height: M`, default flex). The
  Spineless engine treats this and the no-boundary case
  uniformly — both ride the same incremental field-propagation
  path. **~3× faster than Yoga.**
- `hotrelayouttext` — 1k-node fixed-size table; mutating one
  leaf's width per pass. Exposes the Spineless runtime directly
  through `@pilates/core (spineless)`: the flex grammar is built
  once, the leaf width is marked dirty, and `recompute()` ripples
  through only the downstream cells' positions in the same row.
  **~235× faster than Yoga via the direct API**, or ~2.3× via
  `calculateLayout`. The imperative + Yoga columns measure the
  same mutation under a full `calculateLayout()` for comparison.

The boundary shape is no longer the *opt-in* tipping point it
once was — the Spineless engine wins both with and without
explicit-sized containers. The boundary shape still has small
allocation / setup advantages but does not unlock a categorical
faster path.

See `docs/superpowers/specs/2026-05-12-spineless-foundation.md`
for the engine's foundation and
`docs/superpowers/specs/2026-05-20-spineless-flex-distribution-design.md`
for the phase-12 grammar refactor.

## Structural mutation — growing and shrinking trees

`hotstructural` covers the workload where the tree *shape*
changes each frame — a row appended to a list, a panel shown
or hidden. A ~1k-node table appends then removes a whole row
per pass. Four engines:

- `@pilates/core (layout)` — mutate the tree, full
  `calculateLayout()`.
- `@pilates/core (spineless)` — the phase-5c incremental
  structural path: `buildAppendFragment` / `buildRemoveFragment`
  produce the patch, `graft` / `detach` splice the dependency
  graph, `recompute()` settles it — no fresh runtime, no
  `init()`.
- `@pilates/core (spineless rebuild)` — the naive Spineless
  path: a full `buildFlexGrammar()` + new runtime + `init()`
  every pass. The baseline the incremental ops are measured
  against.
- `yoga-layout (WASM)` — mutate, full `calculateLayout()`.

What the numbers show: the incremental structural path
builds its patch in **O(subtree)**, not O(tree).
`buildAppendFragment` emits just the appended subtree against
the runtime grammar as a boundary; `buildRemoveFragment`
collects the removed subtree directly and `detach` cleans
any orphaned input — neither rebuilds the whole grammar. The
incremental path is **~80× faster than a full Spineless
rebuild**, but the public `calculateLayout` entry still goes
through a grammar build on a fresh tree at this size, so Yoga
wins this scenario at the top-level API.

See `docs/superpowers/specs/2026-05-15-spineless-structural.md`.

## When Yoga still wins

- **Concurrent layout of many independent trees**: WASM can
  unlock SharedArrayBuffer + worker patterns Pilates can't.
- **Tree-rebuilding structural mutation through the public API**:
  see `hotstructural` above. Yoga handles structural mutation
  through the same `calculateLayout` path with cheaper internal
  bookkeeping; Pilates' top-level `calculateLayout` rebuilds the
  grammar on structural change. The direct Spineless API ships
  this incrementally already (`@pilates/core (spineless)` column
  above), but it's `@internal` for now.

## What you also get with Pilates regardless

- **Zero WASM init cost** — first layout call returns immediately.
- **Any JS runtime** — pure TypeScript runs in Node, Bun, Deno,
  the browser, edge functions. Yoga's WASM bundle requires the
  loader and adds ~150 KB.
- **Zero runtime deps** — Pilates ships nothing transitive.
