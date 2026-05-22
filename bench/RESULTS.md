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
| @pilates/core (layout) | 5.00µs | ±0ns | 6.10µs | 200.0k ops/s |
| @pilates/render (full) | 75.30µs | ±300ns | 104.70µs | 13.3k ops/s |
| yoga-layout (WASM) | 21.20µs | ±0ns | 31.90µs | 47.2k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 146.30µs | ±800ns | 211.40µs | 6.8k ops/s |
| @pilates/render (full) | 403.05µs | ±1.65µs | 569.00µs | 2.5k ops/s |
| yoga-layout (WASM) | 389.05µs | ±1.45µs | 558.80µs | 2.6k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 709.05µs | ±3.05µs | 1.03ms | 1.4k ops/s |
| @pilates/render (full) | 2.18ms | ±25.40µs | 3.40ms | 459 ops/s |
| yoga-layout (WASM) | 2.14ms | ±8.25µs | 2.59ms | 467 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 4.19ms | ±138.50µs | 5.85ms | 239 ops/s |
| @pilates/render (full) | 12.38ms | ±393.00µs | 18.12ms | 81 ops/s |
| yoga-layout (WASM) | 10.88ms | ±107.30µs | 13.46ms | 92 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 12.24ms | ±278.60µs | 15.44ms | 82 ops/s |
| @pilates/render (full) | 32.87ms | ±762.07µs | 39.41ms | 30 ops/s |
| yoga-layout (WASM) | 24.73ms | ±704.50µs | 28.79ms | 40 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 19.40µs | ±100ns | 27.10µs | 51.5k ops/s |
| @pilates/render (full) | 20.30µs | ±100ns | 28.20µs | 49.3k ops/s |
| yoga-layout (WASM) | 110.00µs | ±400ns | 133.10µs | 9.1k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.90µs | ±200ns | 29.30µs | 45.7k ops/s |
| @pilates/render (full) | 18.90µs | ±100ns | 26.50µs | 52.9k ops/s |
| yoga-layout (WASM) | 92.80µs | ±400ns | 119.30µs | 10.8k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 10.60µs | ±100ns | 14.30µs | 94.3k ops/s |
| @pilates/render (full) | 12.50µs | ±100ns | 15.90µs | 80.0k ops/s |
| yoga-layout (WASM) | 95.30µs | ±400ns | 119.90µs | 10.5k ops/s |
| @pilates/core (spineless) | 200ns | ±0ns | 300ns | 5.00M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 251.60µs | ±8.10µs | 402.40µs | 4.0k ops/s |
| @pilates/render (full) | 245.15µs | ±9.55µs | 387.80µs | 4.1k ops/s |
| yoga-layout (WASM) | 108.90µs | ±301ns | 145.70µs | 9.2k ops/s |
| @pilates/core (spineless) | 218.90µs | ±2.05µs | 443.00µs | 4.6k ops/s |
| @pilates/core (spineless rebuild) | 236.66ms | ±66.16ms | 442.93ms | 4 ops/s |

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
