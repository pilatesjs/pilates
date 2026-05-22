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
| @pilates/core (layout) | 4.50µs | ±0ns | 5.00µs | 222.2k ops/s |
| @pilates/render (full) | 69.80µs | ±100ns | 85.00µs | 14.3k ops/s |
| yoga-layout (WASM) | 19.60µs | ±100ns | 20.60µs | 51.0k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 125.70µs | ±400ns | 171.00µs | 8.0k ops/s |
| @pilates/render (full) | 352.80µs | ±950ns | 473.00µs | 2.8k ops/s |
| yoga-layout (WASM) | 345.10µs | ±200ns | 395.30µs | 2.9k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 633.70µs | ±2.40µs | 962.16µs | 1.6k ops/s |
| @pilates/render (full) | 1.98ms | ±13.41µs | 3.33ms | 506 ops/s |
| yoga-layout (WASM) | 2.04ms | ±3.20µs | 2.35ms | 491 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 3.86ms | ±98.30µs | 5.38ms | 259 ops/s |
| @pilates/render (full) | 11.35ms | ±319.75µs | 16.72ms | 88 ops/s |
| yoga-layout (WASM) | 9.27ms | ±39.90µs | 9.84ms | 108 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 9.04ms | ±140.26µs | 11.70ms | 111 ops/s |
| @pilates/render (full) | 29.14ms | ±845.55µs | 36.33ms | 34 ops/s |
| yoga-layout (WASM) | 19.31ms | ±148.20µs | 21.14ms | 52 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 16.30µs | ±0ns | 18.20µs | 61.3k ops/s |
| @pilates/render (full) | 16.20µs | ±0ns | 18.00µs | 61.7k ops/s |
| yoga-layout (WASM) | 83.50µs | ±100ns | 92.80µs | 12.0k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 15.70µs | ±0ns | 17.70µs | 63.7k ops/s |
| @pilates/render (full) | 15.70µs | ±0ns | 17.40µs | 63.7k ops/s |
| yoga-layout (WASM) | 79.30µs | ±100ns | 86.10µs | 12.6k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 6.80µs | ±0ns | 7.50µs | 147.1k ops/s |
| @pilates/render (full) | 6.80µs | ±100ns | 7.40µs | 147.1k ops/s |
| yoga-layout (WASM) | 73.90µs | ±100ns | 80.10µs | 13.5k ops/s |
| @pilates/core (spineless) | 200ns | ±0ns | 200ns | 5.00M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 115.25µs | ±9.05µs | 161.10µs | 8.7k ops/s |
| @pilates/render (full) | 120.85µs | ±10.50µs | 171.40µs | 8.3k ops/s |
| yoga-layout (WASM) | 92.70µs | ±200ns | 100.90µs | 10.8k ops/s |
| @pilates/core (spineless) | 106.00µs | ±703ns | 239.90µs | 9.4k ops/s |
| @pilates/core (spineless rebuild) | 522.60ms | ±6.82ms | 559.88ms | 2 ops/s |

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
