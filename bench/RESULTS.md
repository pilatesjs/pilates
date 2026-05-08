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
| @pilates/core (layout) | 2.4µs | 421.2k ops/s | 0 |
| @pilates/render (full) | 72.3µs | 13.8k ops/s | 0 |
| yoga-layout (WASM) | 19.5µs | 51.2k ops/s | 0 |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 68.1µs | 14.7k ops/s | 0 |
| @pilates/render (full) | 256.5µs | 3.9k ops/s | 0 |
| yoga-layout (WASM) | 332.7µs | 3.0k ops/s | 0 |

## stress

> ~1000 nodes, 2 levels

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 278.6µs | 3.6k ops/s | 0 |
| @pilates/render (full) | 1.57ms | 636 ops/s | 0 |
| yoga-layout (WASM) | 2.03ms | 493 ops/s | 0 |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 1.41ms | 711 ops/s | 0 |
| @pilates/render (full) | 9.61ms | 104 ops/s | 0 |
| yoga-layout (WASM) | 9.34ms | 107 ops/s | 0 |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 2.92ms | 342 ops/s | 0 |
| @pilates/render (full) | 23.8ms | 42 ops/s | 0 |
| yoga-layout (WASM) | 18.6ms | 54 ops/s | 0 |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Mean latency | Throughput | Samples |
|---|---:|---:|---:|
| @pilates/core (layout) | 180.0µs | 5.6k ops/s | 0 |
| @pilates/render (full) | 178.9µs | 5.6k ops/s | 0 |
| yoga-layout (WASM) | 86.0µs | 11.6k ops/s | 0 |

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
