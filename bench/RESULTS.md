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
| @pilates/core (layout) | 4.40µs | ±0ns | 4.90µs | 227.3k ops/s |
| @pilates/render (full) | 67.50µs | ±200ns | 81.60µs | 14.8k ops/s |
| yoga-layout (WASM) | 18.90µs | ±0ns | 19.80µs | 52.9k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 121.90µs | ±400ns | 161.90µs | 8.2k ops/s |
| @pilates/render (full) | 333.20µs | ±900ns | 458.00µs | 3.0k ops/s |
| yoga-layout (WASM) | 325.00µs | ±200ns | 342.80µs | 3.1k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 613.80µs | ±1.70µs | 969.90µs | 1.6k ops/s |
| @pilates/render (full) | 1.93ms | ±13.80µs | 2.85ms | 518 ops/s |
| yoga-layout (WASM) | 1.89ms | ±2.10µs | 2.11ms | 528 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 3.41ms | ±68.75µs | 4.74ms | 293 ops/s |
| @pilates/render (full) | 10.60ms | ±274.90µs | 15.48ms | 94 ops/s |
| yoga-layout (WASM) | 9.61ms | ±33.19µs | 10.11ms | 104 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 8.83ms | ±129.50µs | 11.32ms | 113 ops/s |
| @pilates/render (full) | 25.54ms | ±447.93µs | 31.50ms | 39 ops/s |
| yoga-layout (WASM) | 18.37ms | ±95.05µs | 19.36ms | 54 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.30µs | ±0ns | 23.20µs | 46.9k ops/s |
| @pilates/render (full) | 21.30µs | ±0ns | 23.10µs | 46.9k ops/s |
| yoga-layout (WASM) | 83.80µs | ±100ns | 90.10µs | 11.9k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 20.70µs | ±0ns | 22.70µs | 48.3k ops/s |
| @pilates/render (full) | 20.60µs | ±0ns | 22.40µs | 48.5k ops/s |
| yoga-layout (WASM) | 78.50µs | ±100ns | 84.60µs | 12.7k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 20.40µs | ±100ns | 22.60µs | 49.0k ops/s |
| @pilates/render (full) | 20.40µs | ±100ns | 22.70µs | 49.0k ops/s |
| yoga-layout (WASM) | 74.60µs | ±100ns | 80.40µs | 13.4k ops/s |
| @pilates/core (spineless) | 200ns | ±0ns | 300ns | 5.00M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 478.30µs | ±3.61µs | 953.64µs | 2.1k ops/s |
| @pilates/render (full) | 394.30µs | ±2.20µs | 567.19µs | 2.5k ops/s |
| yoga-layout (WASM) | 92.60µs | ±200ns | 100.70µs | 10.8k ops/s |
| @pilates/core (spineless) | 259.00µs | ±1.05µs | 349.50µs | 3.9k ops/s |
| @pilates/core (spineless rebuild) | 29.46ms | ±614.85µs | 32.94ms | 34 ops/s |

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
