# Pilates benchmark results

Generated: 2026-05-22 · Node v22.21.0 · win32-x64

Reproduce: `pnpm bench`. Numbers vary by machine — relative positions are the interesting signal. `Median` is reported alongside its bootstrap CI95 (median ± max half-width) over a ~5-second measurement window.

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

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 4.50µs | ±0ns | 4.90µs | 222.2k ops/s |
| @pilates/render (full) | 68.50µs | ±300ns | 84.60µs | 14.6k ops/s |
| yoga-layout (WASM) | 19.20µs | ±0ns | 20.60µs | 52.1k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 125.00µs | ±400ns | 166.90µs | 8.0k ops/s |
| @pilates/render (full) | 344.30µs | ±900ns | 469.91µs | 2.9k ops/s |
| yoga-layout (WASM) | 327.90µs | ±200ns | 365.10µs | 3.0k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 642.25µs | ±2.30µs | 958.27µs | 1.6k ops/s |
| @pilates/render (full) | 1.87ms | ±14.71µs | 2.81ms | 536 ops/s |
| yoga-layout (WASM) | 1.92ms | ±2.70µs | 2.19ms | 522 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 3.44ms | ±68.80µs | 4.78ms | 291 ops/s |
| @pilates/render (full) | 10.60ms | ±404.10µs | 15.69ms | 94 ops/s |
| yoga-layout (WASM) | 10.17ms | ±35.20µs | 10.64ms | 98 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 9.04ms | ±152.30µs | 11.48ms | 111 ops/s |
| @pilates/render (full) | 25.63ms | ±310.20µs | 32.16ms | 39 ops/s |
| yoga-layout (WASM) | 20.14ms | ±75.00µs | 21.00ms | 50 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 22.10µs | ±0ns | 24.50µs | 45.2k ops/s |
| @pilates/render (full) | 22.00µs | ±0ns | 24.40µs | 45.5k ops/s |
| yoga-layout (WASM) | 85.00µs | ±100ns | 93.30µs | 11.8k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 20.90µs | ±0ns | 23.60µs | 47.8k ops/s |
| @pilates/render (full) | 20.90µs | ±100ns | 23.00µs | 47.8k ops/s |
| yoga-layout (WASM) | 79.20µs | ±100ns | 86.20µs | 12.6k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.60µs | ±100ns | 23.40µs | 46.3k ops/s |
| @pilates/render (full) | 21.60µs | ±100ns | 24.00µs | 46.3k ops/s |
| yoga-layout (WASM) | 75.30µs | ±100ns | 83.70µs | 13.3k ops/s |
| @pilates/core (spineless) | 200ns | ±0ns | 300ns | 5.00M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 211.70µs | ±10.72µs | 311.20µs | 4.7k ops/s |
| @pilates/render (full) | 212.55µs | ±10.55µs | 303.80µs | 4.7k ops/s |
| yoga-layout (WASM) | 94.40µs | ±200ns | 106.50µs | 10.6k ops/s |
| @pilates/core (spineless) | 199.20µs | ±9.00µs | 275.10µs | 5.0k ops/s |
| @pilates/core (spineless rebuild) | 32.36ms | ±969.40µs | 36.05ms | 31 ops/s |

## What's measured

Each iteration **runs one layout pass**. Persistent-tree
scenarios (`hot*`) build the tree once before warmup; the
measured iteration mutates and re-lays out. Throwaway-tree
scenarios (`tiny`, `realistic`, `stress`, `big`, `huge`)
build a fresh tree in the iteration and lay it out.

Statistics: median, CI95 (bootstrap, 1000 resamples, ±2.5%
to 97.5% percentiles of resampled medians), P95, throughput
(1/median). Light 5% outlier trim feeds derived stats; raw
samples are preserved in `bench/history/<sha>.json`.
