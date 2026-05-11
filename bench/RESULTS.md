# Pilates benchmark results

Generated: 2026-05-11 · Node v26.0.0 · darwin/arm64

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

## tiny

> 10 nodes, 1 level

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 1.5µs | 671.9k ops/s | 0 |
| @pilates/render (full) | 18.1µs | 55.1k ops/s | 0 |
| yoga-layout (WASM) | 15.1µs | 66.4k ops/s | 0 |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 29.0µs | 34.5k ops/s | 0 |
| @pilates/render (full) | 103.3µs | 9.7k ops/s | 0 |
| yoga-layout (WASM) | 262.9µs | 3.8k ops/s | 0 |

## stress

> ~1000 nodes, 2 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 171.4µs | 5.8k ops/s | 0 |
| @pilates/render (full) | 623.0µs | 1.6k ops/s | 0 |
| yoga-layout (WASM) | 1.52ms | 657 ops/s | 0 |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 939.6µs | 1.1k ops/s | 0 |
| @pilates/render (full) | 3.80ms | 263 ops/s | 0 |
| yoga-layout (WASM) | 7.26ms | 138 ops/s | 0 |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 2.16ms | 463 ops/s | 0 |
| @pilates/render (full) | 8.89ms | 112 ops/s | 0 |
| yoga-layout (WASM) | 14.6ms | 68 ops/s | 0 |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 128.6µs | 7.8k ops/s | 0 |
| @pilates/render (full) | 127.9µs | 7.8k ops/s | 0 |
| yoga-layout (WASM) | 55.7µs | 18.0k ops/s | 0 |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 7.1µs | 140.1k ops/s | 0 |
| @pilates/render (full) | 7.1µs | 140.4k ops/s | 0 |
| yoga-layout (WASM) | 51.1µs | 19.6k ops/s | 0 |

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
  **Pilates is ~7× faster than Yoga** on this scenario.

The boundary path is opt-in by tree shape, not API: any
explicit-sized container with default flex grow/shrink
qualifies, which matches the idiomatic TUI pattern of
`<Box width={N} height={M}>` containers around dynamic
content. See `docs/superpowers/specs/2026-05-09-relayout-boundaries-design.md`.

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
