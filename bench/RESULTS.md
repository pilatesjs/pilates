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
| @pilates/core (layout) | 5.10µs | ±0ns | 5.70µs | 196.1k ops/s |
| @pilates/render (full) | 89.80µs | ±100ns | 113.70µs | 11.1k ops/s |
| yoga-layout (WASM) | 30.20µs | ±0ns | 31.80µs | 33.1k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 159.20µs | ±400ns | 208.90µs | 6.3k ops/s |
| @pilates/render (full) | 452.80µs | ±1.00µs | 579.04µs | 2.2k ops/s |
| yoga-layout (WASM) | 504.80µs | ±200ns | 538.79µs | 2.0k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 807.70µs | ±3.70µs | 1.18ms | 1.2k ops/s |
| @pilates/render (full) | 2.50ms | ±17.81µs | 3.65ms | 399 ops/s |
| yoga-layout (WASM) | 2.89ms | ±4.40µs | 3.44ms | 346 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 4.57ms | ±73.45µs | 6.12ms | 219 ops/s |
| @pilates/render (full) | 13.30ms | ±599.85µs | 18.52ms | 75 ops/s |
| yoga-layout (WASM) | 14.17ms | ±87.80µs | 14.76ms | 71 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 11.52ms | ±158.45µs | 14.33ms | 87 ops/s |
| @pilates/render (full) | 31.57ms | ±929.50µs | 37.30ms | 32 ops/s |
| yoga-layout (WASM) | 28.65ms | ±119.40µs | 29.75ms | 35 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 28.20µs | ±100ns | 31.70µs | 35.5k ops/s |
| @pilates/render (full) | 28.20µs | ±0ns | 31.90µs | 35.5k ops/s |
| yoga-layout (WASM) | 104.90µs | ±100ns | 114.40µs | 9.5k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 27.60µs | ±0ns | 32.00µs | 36.2k ops/s |
| @pilates/render (full) | 27.50µs | ±0ns | 31.80µs | 36.4k ops/s |
| yoga-layout (WASM) | 97.70µs | ±100ns | 105.90µs | 10.2k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 25.30µs | ±0ns | 27.50µs | 39.5k ops/s |
| @pilates/render (full) | 25.40µs | ±100ns | 27.80µs | 39.4k ops/s |
| yoga-layout (WASM) | 91.90µs | ±100ns | 99.80µs | 10.9k ops/s |
| @pilates/core (spineless) | 200ns | ±0ns | 200ns | 5.00M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 252.00µs | ±5.20µs | 398.90µs | 4.0k ops/s |
| @pilates/render (full) | 258.85µs | ±10.96µs | 372.20µs | 3.9k ops/s |
| yoga-layout (WASM) | 119.90µs | ±600ns | 129.10µs | 8.3k ops/s |
| @pilates/core (spineless) | 208.95µs | ±9.85µs | 313.50µs | 4.8k ops/s |
| @pilates/core (spineless rebuild) | 43.03ms | ±5.68ms | 55.55ms | 23 ops/s |

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
