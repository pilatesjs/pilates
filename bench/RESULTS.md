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
| @pilates/core (layout) | 2.5µs | 405.4k ops/s | 0 |
| @pilates/render (full) | 77.7µs | 12.9k ops/s | 0 |
| yoga-layout (WASM) | 29.6µs | 33.8k ops/s | 0 |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 66.6µs | 15.0k ops/s | 0 |
| @pilates/render (full) | 310.0µs | 3.2k ops/s | 0 |
| yoga-layout (WASM) | 460.2µs | 2.2k ops/s | 0 |

## stress

> ~1000 nodes, 2 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 298.8µs | 3.3k ops/s | 0 |
| @pilates/render (full) | 1.66ms | 601 ops/s | 0 |
| yoga-layout (WASM) | 2.65ms | 377 ops/s | 0 |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 1.52ms | 660 ops/s | 0 |
| @pilates/render (full) | 10.2ms | 98 ops/s | 0 |
| yoga-layout (WASM) | 11.7ms | 86 ops/s | 0 |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 3.12ms | 320 ops/s | 0 |
| @pilates/render (full) | 25.2ms | 40 ops/s | 0 |
| yoga-layout (WASM) | 22.3ms | 45 ops/s | 0 |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 199.2µs | 5.0k ops/s | 0 |
| @pilates/render (full) | 199.2µs | 5.0k ops/s | 0 |
| yoga-layout (WASM) | 100.0µs | 10.0k ops/s | 0 |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 10.8µs | 92.8k ops/s | 0 |
| @pilates/render (full) | 10.9µs | 91.4k ops/s | 0 |
| yoga-layout (WASM) | 95.4µs | 10.5k ops/s | 0 |

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

## When Yoga still wins

- **Long-lived trees with hot relayouts**: build the tree once,
  mutate-and-relayout in a loop. The build cost amortizes; only
  the layout pass is measured. WASM Yoga's compute advantage
  shows up here. See the `hotrelayout` scenario — Phase 3+
  relayout-boundary work targets this workload.
- **Concurrent layout of many independent trees**: WASM can
  unlock SharedArrayBuffer + worker patterns Pilates can't.

## What you also get with Pilates regardless

- **Zero WASM init cost** — first layout call returns immediately.
- **Any JS runtime** — pure TypeScript runs in Node, Bun, Deno,
  the browser, edge functions. Yoga's WASM bundle requires the
  loader and adds ~150 KB.
- **Zero runtime deps** — Pilates ships nothing transitive.
