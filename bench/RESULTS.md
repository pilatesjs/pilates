# Pilates benchmark results

Generated: 2026-05-23 · Node v22.21.0 · win32-x64

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
| @pilates/core (layout) | 4.50µs | ±0ns | 5.00µs | 222.2k ops/s |
| @pilates/render (full) | 76.80µs | ±300ns | 126.40µs | 13.0k ops/s |
| yoga-layout (WASM) | 19.00µs | ±0ns | 19.90µs | 52.6k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 121.20µs | ±300ns | 155.50µs | 8.3k ops/s |
| @pilates/render (full) | 337.10µs | ±800ns | 439.20µs | 3.0k ops/s |
| yoga-layout (WASM) | 328.40µs | ±100ns | 342.70µs | 3.0k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 600.80µs | ±1.50µs | 882.55µs | 1.7k ops/s |
| @pilates/render (full) | 1.87ms | ±9.60µs | 2.71ms | 536 ops/s |
| yoga-layout (WASM) | 1.94ms | ±1.50µs | 2.18ms | 516 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 3.32ms | ±58.51µs | 4.60ms | 301 ops/s |
| @pilates/render (full) | 10.57ms | ±342.30µs | 14.86ms | 95 ops/s |
| yoga-layout (WASM) | 9.17ms | ±16.10µs | 9.59ms | 109 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 8.62ms | ±108.36µs | 11.03ms | 116 ops/s |
| @pilates/render (full) | 25.36ms | ±324.20µs | 30.58ms | 39 ops/s |
| yoga-layout (WASM) | 18.49ms | ±34.80µs | 19.32ms | 54 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 16.30µs | ±0ns | 17.50µs | 61.3k ops/s |
| @pilates/render (full) | 16.30µs | ±100ns | 17.40µs | 61.3k ops/s |
| yoga-layout (WASM) | 83.00µs | ±100ns | 89.20µs | 12.0k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 15.80µs | ±0ns | 16.90µs | 63.3k ops/s |
| @pilates/render (full) | 15.90µs | ±0ns | 17.10µs | 62.9k ops/s |
| yoga-layout (WASM) | 77.80µs | ±100ns | 84.40µs | 12.9k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 8.90µs | ±0ns | 9.30µs | 112.4k ops/s |
| @pilates/render (full) | 8.90µs | ±0ns | 9.30µs | 112.4k ops/s |
| yoga-layout (WASM) | 90.60µs | ±0ns | 93.50µs | 11.0k ops/s |
| @pilates/core (spineless) | 200ns | ±0ns | 300ns | 5.00M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 71.25µs | ±2.20µs | 107.90µs | 14.0k ops/s |
| @pilates/render (full) | 71.90µs | ±2.20µs | 110.20µs | 13.9k ops/s |
| yoga-layout (WASM) | 118.30µs | ±400ns | 123.10µs | 8.5k ops/s |
| @pilates/core (spineless) | 66.60µs | ±400ns | 127.20µs | 15.0k ops/s |
| @pilates/core (spineless rebuild) | 285.27ms | ±19.56ms | 492.72ms | 4 ops/s |

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
