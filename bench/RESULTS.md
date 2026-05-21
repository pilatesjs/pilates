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
| @pilates/core (layout) | 5.60µs | ±0ns | 6.10µs | 178.6k ops/s |
| @pilates/render (full) | 70.30µs | ±100ns | 82.20µs | 14.2k ops/s |
| yoga-layout (WASM) | 19.30µs | ±0ns | 20.20µs | 51.8k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 144.70µs | ±300ns | 190.70µs | 6.9k ops/s |
| @pilates/render (full) | 372.80µs | ±900ns | 506.60µs | 2.7k ops/s |
| yoga-layout (WASM) | 334.10µs | ±100ns | 348.10µs | 3.0k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 750.00µs | ±2.15µs | 1.29ms | 1.3k ops/s |
| @pilates/render (full) | 2.04ms | ±20.70µs | 3.36ms | 489 ops/s |
| yoga-layout (WASM) | 1.93ms | ±1.75µs | 2.14ms | 519 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 4.55ms | ±58.60µs | 5.40ms | 220 ops/s |
| @pilates/render (full) | 13.91ms | ±337.10µs | 17.53ms | 72 ops/s |
| yoga-layout (WASM) | 9.14ms | ±27.85µs | 9.69ms | 109 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 11.92ms | ±223.60µs | 15.76ms | 84 ops/s |
| @pilates/render (full) | 30.02ms | ±535.70µs | 36.22ms | 33 ops/s |
| yoga-layout (WASM) | 18.50ms | ±66.00µs | 19.30ms | 54 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.90µs | ±0ns | 23.90µs | 45.7k ops/s |
| @pilates/render (full) | 22.00µs | ±100ns | 24.00µs | 45.5k ops/s |
| yoga-layout (WASM) | 82.10µs | ±100ns | 87.50µs | 12.2k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.60µs | ±0ns | 24.20µs | 46.3k ops/s |
| @pilates/render (full) | 21.80µs | ±0ns | 23.80µs | 45.9k ops/s |
| yoga-layout (WASM) | 77.70µs | ±100ns | 84.10µs | 12.9k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.50µs | ±100ns | 23.90µs | 46.5k ops/s |
| @pilates/render (full) | 22.00µs | ±100ns | 24.10µs | 45.5k ops/s |
| yoga-layout (WASM) | 73.30µs | ±100ns | 79.50µs | 13.6k ops/s |
| @pilates/core (spineless) | 200ns | ±0ns | 200ns | 5.00M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 392.20µs | ±3.20µs | 549.20µs | 2.5k ops/s |
| @pilates/render (full) | 402.20µs | ±2.75µs | 600.31µs | 2.5k ops/s |
| yoga-layout (WASM) | 90.90µs | ±200ns | 98.50µs | 11.0k ops/s |
| @pilates/core (spineless) | 262.50µs | ±1.10µs | 361.50µs | 3.8k ops/s |
| @pilates/core (spineless rebuild) | 27.39ms | ±486.00µs | 31.51ms | 37 ops/s |

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
