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
| @pilates/core (layout) | 5.10µs | ±0ns | 5.60µs | 196.1k ops/s |
| @pilates/render (full) | 67.40µs | ±100ns | 81.80µs | 14.8k ops/s |
| yoga-layout (WASM) | 19.30µs | ±0ns | 20.70µs | 51.8k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 138.20µs | ±400ns | 177.00µs | 7.2k ops/s |
| @pilates/render (full) | 353.30µs | ±900ns | 465.40µs | 2.8k ops/s |
| yoga-layout (WASM) | 334.80µs | ±200ns | 355.00µs | 3.0k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 700.10µs | ±2.90µs | 1.25ms | 1.4k ops/s |
| @pilates/render (full) | 2.03ms | ±20.31µs | 3.25ms | 493 ops/s |
| yoga-layout (WASM) | 1.90ms | ±1.40µs | 2.18ms | 527 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 4.31ms | ±80.45µs | 5.70ms | 232 ops/s |
| @pilates/render (full) | 14.34ms | ±521.30µs | 17.90ms | 70 ops/s |
| yoga-layout (WASM) | 9.27ms | ±23.55µs | 9.71ms | 108 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 11.92ms | ±474.85µs | 16.28ms | 84 ops/s |
| @pilates/render (full) | 29.07ms | ±499.65µs | 33.00ms | 34 ops/s |
| yoga-layout (WASM) | 18.41ms | ±83.25µs | 19.24ms | 54 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.30µs | ±100ns | 23.40µs | 46.9k ops/s |
| @pilates/render (full) | 21.30µs | ±100ns | 23.50µs | 46.9k ops/s |
| yoga-layout (WASM) | 83.00µs | ±100ns | 89.20µs | 12.0k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.20µs | ±0ns | 24.10µs | 47.2k ops/s |
| @pilates/render (full) | 20.80µs | ±100ns | 22.80µs | 48.1k ops/s |
| yoga-layout (WASM) | 77.50µs | ±100ns | 83.60µs | 12.9k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.40µs | ±0ns | 23.10µs | 46.7k ops/s |
| @pilates/render (full) | 22.20µs | ±0ns | 24.70µs | 45.0k ops/s |
| yoga-layout (WASM) | 73.50µs | ±100ns | 81.00µs | 13.6k ops/s |
| @pilates/core (spineless) | 200ns | ±0ns | 300ns | 5.00M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 377.40µs | ±2.40µs | 525.43µs | 2.6k ops/s |
| @pilates/render (full) | 393.70µs | ±2.70µs | 564.41µs | 2.5k ops/s |
| yoga-layout (WASM) | 92.10µs | ±100ns | 101.00µs | 10.9k ops/s |
| @pilates/core (spineless) | 265.40µs | ±1.30µs | 352.70µs | 3.8k ops/s |
| @pilates/core (spineless rebuild) | 28.60ms | ±534.88µs | 32.17ms | 35 ops/s |

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
