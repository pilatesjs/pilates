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
| @pilates/core (layout) | 4.60µs | ±0ns | 5.60µs | 217.4k ops/s |
| @pilates/render (full) | 80.25µs | ±1.50µs | 108.10µs | 12.5k ops/s |
| yoga-layout (WASM) | 19.10µs | ±0ns | 30.00µs | 52.4k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 155.90µs | ±500ns | 211.50µs | 6.4k ops/s |
| @pilates/render (full) | 457.40µs | ±1.95µs | 607.40µs | 2.2k ops/s |
| yoga-layout (WASM) | 330.00µs | ±300ns | 512.70µs | 3.0k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 695.40µs | ±6.01µs | 1.06ms | 1.4k ops/s |
| @pilates/render (full) | 2.35ms | ±30.70µs | 3.29ms | 425 ops/s |
| yoga-layout (WASM) | 1.93ms | ±4.50µs | 2.81ms | 517 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 4.10ms | ±52.20µs | 5.46ms | 244 ops/s |
| @pilates/render (full) | 11.66ms | ±314.35µs | 16.10ms | 86 ops/s |
| yoga-layout (WASM) | 9.25ms | ±41.70µs | 10.88ms | 108 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 10.42ms | ±248.91µs | 13.26ms | 96 ops/s |
| @pilates/render (full) | 29.75ms | ±763.00µs | 35.77ms | 34 ops/s |
| yoga-layout (WASM) | 19.29ms | ±140.42µs | 22.92ms | 52 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 17.40µs | ±0ns | 23.40µs | 57.5k ops/s |
| @pilates/render (full) | 17.50µs | ±0ns | 24.00µs | 57.1k ops/s |
| yoga-layout (WASM) | 83.80µs | ±100ns | 105.20µs | 11.9k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 17.00µs | ±100ns | 23.90µs | 58.8k ops/s |
| @pilates/render (full) | 16.90µs | ±100ns | 23.40µs | 59.2k ops/s |
| yoga-layout (WASM) | 78.10µs | ±100ns | 96.90µs | 12.8k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 6.90µs | ±100ns | 9.40µs | 144.9k ops/s |
| @pilates/render (full) | 6.80µs | ±0ns | 9.30µs | 147.1k ops/s |
| yoga-layout (WASM) | 75.50µs | ±100ns | 91.40µs | 13.2k ops/s |
| @pilates/core (spineless) | 200ns | ±0ns | 200ns | 5.00M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 71.60µs | ±950ns | 124.40µs | 14.0k ops/s |
| @pilates/render (full) | 73.10µs | ±1.40µs | 113.00µs | 13.7k ops/s |
| yoga-layout (WASM) | 92.10µs | ±100ns | 105.80µs | 10.9k ops/s |
| @pilates/core (spineless) | 63.50µs | ±600ns | 121.40µs | 15.7k ops/s |
| @pilates/core (spineless rebuild) | 383.00ms | ±86.03ms | 548.43ms | 3 ops/s |

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
