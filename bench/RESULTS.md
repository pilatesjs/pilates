# Pilates benchmark results

Generated: 2026-05-08 · Node v22.21.0 · win32/x64

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

## tiny

> 10 nodes, 1 level

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 2.5µs | 404.4k ops/s | 0 |
| @pilates/render (full) | 73.6µs | 13.6k ops/s | 0 |
| yoga-layout (WASM) | 19.3µs | 51.9k ops/s | 0 |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 61.5µs | 16.3k ops/s | 0 |
| @pilates/render (full) | 251.6µs | 4.0k ops/s | 0 |
| yoga-layout (WASM) | 329.8µs | 3.0k ops/s | 0 |

## stress

> ~1000 nodes, 2 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 292.2µs | 3.4k ops/s | 0 |
| @pilates/render (full) | 1.59ms | 630 ops/s | 0 |
| yoga-layout (WASM) | 1.93ms | 517 ops/s | 0 |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 1.35ms | 740 ops/s | 0 |
| @pilates/render (full) | 9.48ms | 105 ops/s | 0 |
| yoga-layout (WASM) | 9.29ms | 108 ops/s | 0 |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 3.00ms | 333 ops/s | 0 |
| @pilates/render (full) | 23.8ms | 42 ops/s | 0 |
| yoga-layout (WASM) | 18.5ms | 54 ops/s | 0 |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 209.7µs | 4.8k ops/s | 0 |
| @pilates/render (full) | 197.3µs | 5.1k ops/s | 0 |
| yoga-layout (WASM) | 83.8µs | 11.9k ops/s | 0 |

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
