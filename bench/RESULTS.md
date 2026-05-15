# Pilates benchmark results

Generated: 2026-05-15 · Node v22.21.0 · win32/x64

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

## tiny

> 10 nodes, 1 level

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 6.1µs | 163.1k ops/s | 0 |
| @pilates/render (full) | 74.6µs | 13.4k ops/s | 0 |
| yoga-layout (WASM) | 19.8µs | 50.6k ops/s | 0 |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 97.4µs | 10.3k ops/s | 0 |
| @pilates/render (full) | 340.8µs | 2.9k ops/s | 0 |
| yoga-layout (WASM) | 336.9µs | 3.0k ops/s | 0 |

## stress

> ~1000 nodes, 2 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 565.9µs | 1.8k ops/s | 0 |
| @pilates/render (full) | 2.12ms | 472 ops/s | 0 |
| yoga-layout (WASM) | 1.92ms | 520 ops/s | 0 |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 3.02ms | 331 ops/s | 0 |
| @pilates/render (full) | 12.9ms | 78 ops/s | 0 |
| yoga-layout (WASM) | 9.47ms | 106 ops/s | 0 |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 12.9ms | 78 ops/s | 0 |
| @pilates/render (full) | 29.8ms | 34 ops/s | 0 |
| yoga-layout (WASM) | 18.8ms | 53 ops/s | 0 |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 214.2µs | 4.7k ops/s | 0 |
| @pilates/render (full) | 225.0µs | 4.4k ops/s | 0 |
| yoga-layout (WASM) | 98.4µs | 10.2k ops/s | 0 |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 11.3µs | 88.6k ops/s | 0 |
| @pilates/render (full) | 11.0µs | 90.5k ops/s | 0 |
| yoga-layout (WASM) | 100.2µs | 10.0k ops/s | 0 |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 9.2µs | 108.9k ops/s | 0 |
| @pilates/render (full) | 8.6µs | 115.9k ops/s | 0 |
| yoga-layout (WASM) | 76.1µs | 13.1k ops/s | 0 |
| @pilates/core (spineless) | 6.0µs | 167.8k ops/s | 0 |

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
