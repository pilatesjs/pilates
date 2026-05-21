# Pilates benchmark results

Generated: 2026-05-20 · Node v22.21.0 · win32-x64

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
| @pilates/core (layout) | 6.20µs | ±0ns | 7.20µs | 161.3k ops/s |
| @pilates/render (full) | 66.50µs | ±100ns | 80.00µs | 15.0k ops/s |
| yoga-layout (WASM) | 19.20µs | ±0ns | 20.20µs | 52.1k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 151.10µs | ±400ns | 196.70µs | 6.6k ops/s |
| @pilates/render (full) | 360.80µs | ±800ns | 472.34µs | 2.8k ops/s |
| yoga-layout (WASM) | 329.80µs | ±100ns | 344.30µs | 3.0k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 752.45µs | ±2.55µs | 1.33ms | 1.3k ops/s |
| @pilates/render (full) | 2.03ms | ±14.65µs | 3.31ms | 494 ops/s |
| yoga-layout (WASM) | 1.91ms | ±1.90µs | 2.10ms | 523 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 5.00ms | ±60.11µs | 5.87ms | 200 ops/s |
| @pilates/render (full) | 14.89ms | ±563.20µs | 18.78ms | 67 ops/s |
| yoga-layout (WASM) | 9.19ms | ±20.50µs | 9.63ms | 109 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 12.22ms | ±237.50µs | 16.16ms | 82 ops/s |
| @pilates/render (full) | 29.91ms | ±680.38µs | 36.62ms | 33 ops/s |
| yoga-layout (WASM) | 18.84ms | ±70.10µs | 19.58ms | 53 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 23.00µs | ±0ns | 25.40µs | 43.5k ops/s |
| @pilates/render (full) | 23.00µs | ±0ns | 25.80µs | 43.5k ops/s |
| yoga-layout (WASM) | 85.50µs | ±100ns | 92.90µs | 11.7k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 22.80µs | ±100ns | 25.50µs | 43.9k ops/s |
| @pilates/render (full) | 22.90µs | ±0ns | 25.50µs | 43.7k ops/s |
| yoga-layout (WASM) | 80.00µs | ±100ns | 86.30µs | 12.5k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 22.90µs | ±0ns | 24.70µs | 43.7k ops/s |
| @pilates/render (full) | 22.80µs | ±0ns | 24.50µs | 43.9k ops/s |
| yoga-layout (WASM) | 74.80µs | ±100ns | 80.50µs | 13.4k ops/s |
| @pilates/core (spineless) | 200ns | ±0ns | 200ns | 5.00M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 400.10µs | ±2.40µs | 561.00µs | 2.5k ops/s |
| @pilates/render (full) | 396.80µs | ±2.50µs | 539.83µs | 2.5k ops/s |
| yoga-layout (WASM) | 93.10µs | ±100ns | 101.00µs | 10.7k ops/s |
| @pilates/core (spineless) | 274.10µs | ±1.25µs | 362.40µs | 3.6k ops/s |
| @pilates/core (spineless rebuild) | 28.94ms | ±271.21µs | 32.46ms | 35 ops/s |

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
