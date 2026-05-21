# Pilates benchmark results

Generated: 2026-05-21 · Node v22.21.0 · win32-x64

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
| @pilates/core (layout) | 6.70µs | ±100ns | 7.50µs | 149.3k ops/s |
| @pilates/render (full) | 88.70µs | ±100ns | 106.20µs | 11.3k ops/s |
| yoga-layout (WASM) | 29.50µs | ±0ns | 30.40µs | 33.9k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 174.20µs | ±400ns | 217.90µs | 5.7k ops/s |
| @pilates/render (full) | 461.10µs | ±800ns | 569.81µs | 2.2k ops/s |
| yoga-layout (WASM) | 492.20µs | ±300ns | 515.80µs | 2.0k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 899.65µs | ±1.85µs | 1.48ms | 1.1k ops/s |
| @pilates/render (full) | 2.47ms | ±12.60µs | 3.89ms | 405 ops/s |
| yoga-layout (WASM) | 2.79ms | ±2.45µs | 3.02ms | 358 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 5.41ms | ±62.25µs | 6.35ms | 185 ops/s |
| @pilates/render (full) | 15.74ms | ±380.50µs | 20.12ms | 64 ops/s |
| yoga-layout (WASM) | 13.50ms | ±44.60µs | 14.01ms | 74 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 13.98ms | ±255.00µs | 18.77ms | 72 ops/s |
| @pilates/render (full) | 32.86ms | ±759.50µs | 38.40ms | 30 ops/s |
| yoga-layout (WASM) | 27.38ms | ±190.50µs | 28.53ms | 37 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 30.80µs | ±100ns | 32.90µs | 32.5k ops/s |
| @pilates/render (full) | 30.70µs | ±0ns | 32.70µs | 32.6k ops/s |
| yoga-layout (WASM) | 104.50µs | ±100ns | 108.40µs | 9.6k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 29.80µs | ±100ns | 32.10µs | 33.6k ops/s |
| @pilates/render (full) | 29.80µs | ±1ns | 31.60µs | 33.6k ops/s |
| yoga-layout (WASM) | 97.60µs | ±0ns | 101.10µs | 10.2k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 30.40µs | ±0ns | 33.00µs | 32.9k ops/s |
| @pilates/render (full) | 31.00µs | ±100ns | 33.20µs | 32.3k ops/s |
| yoga-layout (WASM) | 93.00µs | ±100ns | 96.40µs | 10.8k ops/s |
| @pilates/core (spineless) | 300ns | ±0ns | 300ns | 3.33M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 483.60µs | ±4.50µs | 687.73µs | 2.1k ops/s |
| @pilates/render (full) | 467.10µs | ±4.81µs | 681.58µs | 2.1k ops/s |
| yoga-layout (WASM) | 118.50µs | ±1.95µs | 125.60µs | 8.4k ops/s |
| @pilates/core (spineless) | 312.60µs | ±1.85µs | 453.70µs | 3.2k ops/s |
| @pilates/core (spineless rebuild) | 34.41ms | ±403.03µs | 37.97ms | 29 ops/s |

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
