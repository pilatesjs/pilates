# Pilates benchmark results

Generated: 2026-05-17 · Node v22.21.0 · win32/x64

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
| @pilates/core (layout) | 6.6µs | 151.3k ops/s | 0 |
| @pilates/render (full) | 81.4µs | 12.3k ops/s | 0 |
| yoga-layout (WASM) | 20.3µs | 49.2k ops/s | 0 |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 177.2µs | 5.6k ops/s | 0 |
| @pilates/render (full) | 450.6µs | 2.2k ops/s | 0 |
| yoga-layout (WASM) | 356.8µs | 2.8k ops/s | 0 |

## stress

> ~1000 nodes, 2 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 887.5µs | 1.1k ops/s | 0 |
| @pilates/render (full) | 2.54ms | 394 ops/s | 0 |
| yoga-layout (WASM) | 2.03ms | 494 ops/s | 0 |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 4.69ms | 213 ops/s | 0 |
| @pilates/render (full) | 14.8ms | 67 ops/s | 0 |
| yoga-layout (WASM) | 9.63ms | 104 ops/s | 0 |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 12.8ms | 78 ops/s | 0 |
| @pilates/render (full) | 31.3ms | 32 ops/s | 0 |
| yoga-layout (WASM) | 19.6ms | 51 ops/s | 0 |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 217.8µs | 4.6k ops/s | 0 |
| @pilates/render (full) | 218.3µs | 4.6k ops/s | 0 |
| yoga-layout (WASM) | 87.6µs | 11.4k ops/s | 0 |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 11.6µs | 85.9k ops/s | 0 |
| @pilates/render (full) | 11.6µs | 86.4k ops/s | 0 |
| yoga-layout (WASM) | 83.1µs | 12.0k ops/s | 0 |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 10.5µs | 94.9k ops/s | 0 |
| @pilates/render (full) | 10.7µs | 93.2k ops/s | 0 |
| yoga-layout (WASM) | 78.6µs | 12.7k ops/s | 0 |
| @pilates/core (spineless) | 0.20µs | 5.12M ops/s | 0 |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 258.0µs | 3.9k ops/s | 0 |
| @pilates/render (full) | 255.6µs | 3.9k ops/s | 0 |
| yoga-layout (WASM) | 96.4µs | 10.4k ops/s | 0 |
| @pilates/core (spineless) | 290.2µs | 3.4k ops/s | 0 |
| @pilates/core (spineless rebuild) | 22.9ms | 44 ops/s | 0 |

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

Building the tree once and mutating-and-relayouting in a loop
is the workload Yoga's WASM compute advantage traditionally
shows up on. Two scenarios cover this shape:

- `hotrelayout` — 1k-node persistent tree with no boundary
  hints. Yoga still wins here because every leaf mutation
  walks the dirty bit to root, invalidating Pilates'
  layout cache.
- `hotrelayoutboundary` — same shape but with explicit-sized
  row containers (`width: N, height: M`, default flex). Each
  row acts as a relayout boundary: leaf mutations dirty the
  row but don't propagate to root, so Pilates' root layout
  cache hits and only the row subtree re-runs flex.
  **Pilates is ~9× faster than Yoga** on this scenario.
- `hotrelayouttext` — 1k-node fixed-size table; mutating one
  leaf's width per pass. Adds a fourth engine,
  `@pilates/core (spineless)`, the phase-5b incremental
  runtime: the flex grammar is built once, the leaf width
  is marked dirty, and `recompute()` ripples through only
  the downstream cells' positions in the same row. The
  imperative + Yoga columns measure the same mutation under
  a full `calculateLayout()` for comparison.

The boundary path is opt-in by tree shape, not API: any
explicit-sized container with default flex grow/shrink
qualifies, which matches the idiomatic TUI pattern of
`<Box width={N} height={M}>` containers around dynamic
content. See `docs/superpowers/specs/2026-05-09-relayout-boundaries-design.md`.
The Spineless runtime targets the same workload via a
different mechanism — see
`docs/superpowers/specs/2026-05-12-spineless-foundation.md`.

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
incremental path is **~70× faster than a full Spineless
rebuild** and now runs on par with the imperative
`calculateLayout()` itself — structural incrementality has
caught up to a tuned from-scratch relayout.

See `docs/superpowers/specs/2026-05-15-spineless-structural.md`.

## When Yoga still wins

- **Concurrent layout of many independent trees**: WASM can
  unlock SharedArrayBuffer + worker patterns Pilates can't.
- **Trees with no explicit-sized boundaries that hot-relayout
  per frame**: see `hotrelayout` scenario above. If your tree
  is fully fluid (no `width: N, height: M` containers) and
  every frame mutates a leaf, Yoga is faster.

## What you also get with Pilates regardless

- **Zero WASM init cost** — first layout call returns immediately.
- **Any JS runtime** — pure TypeScript runs in Node, Bun, Deno,
  the browser, edge functions. Yoga's WASM bundle requires the
  loader and adds ~150 KB.
- **Zero runtime deps** — Pilates ships nothing transitive.
