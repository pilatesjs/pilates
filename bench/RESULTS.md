# Pilates benchmark results

Generated: 2026-05-09 · Node v22.21.0 · win32/x64

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
| @pilates/core (layout) | 3.1µs | 326.7k ops/s | 0 |
| @pilates/render (full) | 72.6µs | 13.8k ops/s | 0 |
| yoga-layout (WASM) | 19.9µs | 50.4k ops/s | 0 |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 64.1µs | 15.6k ops/s | 0 |
| @pilates/render (full) | 261.2µs | 3.8k ops/s | 0 |
| yoga-layout (WASM) | 329.2µs | 3.0k ops/s | 0 |

## stress

> ~1000 nodes, 2 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 320.1µs | 3.1k ops/s | 0 |
| @pilates/render (full) | 1.54ms | 648 ops/s | 0 |
| yoga-layout (WASM) | 1.95ms | 513 ops/s | 0 |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 2.22ms | 451 ops/s | 0 |
| @pilates/render (full) | 12.2ms | 82 ops/s | 0 |
| yoga-layout (WASM) | 13.3ms | 75 ops/s | 0 |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 7.50ms | 133 ops/s | 0 |
| @pilates/render (full) | 29.5ms | 34 ops/s | 0 |
| yoga-layout (WASM) | 27.1ms | 37 ops/s | 0 |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 238.8µs | 4.2k ops/s | 0 |
| @pilates/render (full) | 260.9µs | 3.8k ops/s | 0 |
| yoga-layout (WASM) | 112.5µs | 8.9k ops/s | 0 |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 11.4µs | 87.7k ops/s | 0 |
| @pilates/render (full) | 12.0µs | 83.3k ops/s | 0 |
| yoga-layout (WASM) | 104.1µs | 9.6k ops/s | 0 |

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
