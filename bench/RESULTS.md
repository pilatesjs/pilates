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
| @pilates/core (layout) | 4.40µs | ±0ns | 4.80µs | 227.3k ops/s |
| @pilates/render (full) | 65.20µs | ±100ns | 79.60µs | 15.3k ops/s |
| yoga-layout (WASM) | 18.90µs | ±0ns | 19.90µs | 52.9k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 123.20µs | ±300ns | 165.20µs | 8.1k ops/s |
| @pilates/render (full) | 336.80µs | ±800ns | 462.30µs | 3.0k ops/s |
| yoga-layout (WASM) | 325.20µs | ±200ns | 350.60µs | 3.1k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 610.10µs | ±1.40µs | 933.82µs | 1.6k ops/s |
| @pilates/render (full) | 1.88ms | ±12.40µs | 3.09ms | 531 ops/s |
| yoga-layout (WASM) | 1.91ms | ±2.35µs | 2.16ms | 524 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 3.46ms | ±73.79µs | 4.80ms | 289 ops/s |
| @pilates/render (full) | 10.42ms | ±256.16µs | 15.08ms | 96 ops/s |
| yoga-layout (WASM) | 9.23ms | ±34.75µs | 9.82ms | 108 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 8.81ms | ±110.80µs | 11.33ms | 114 ops/s |
| @pilates/render (full) | 25.86ms | ±475.25µs | 31.58ms | 39 ops/s |
| yoga-layout (WASM) | 18.74ms | ±93.36µs | 19.64ms | 53 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.40µs | ±100ns | 23.60µs | 46.7k ops/s |
| @pilates/render (full) | 21.30µs | ±100ns | 23.10µs | 46.9k ops/s |
| yoga-layout (WASM) | 82.80µs | ±100ns | 88.90µs | 12.1k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 20.80µs | ±100ns | 23.10µs | 48.1k ops/s |
| @pilates/render (full) | 20.50µs | ±0ns | 22.20µs | 48.8k ops/s |
| yoga-layout (WASM) | 77.80µs | ±100ns | 83.60µs | 12.9k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 20.90µs | ±100ns | 22.90µs | 47.8k ops/s |
| @pilates/render (full) | 20.60µs | ±100ns | 22.80µs | 48.5k ops/s |
| yoga-layout (WASM) | 73.40µs | ±100ns | 79.30µs | 13.6k ops/s |
| @pilates/core (spineless) | 200ns | ±0ns | 200ns | 5.00M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 275.00µs | ±900ns | 337.40µs | 3.6k ops/s |
| @pilates/render (full) | 269.70µs | ±1.00µs | 336.30µs | 3.7k ops/s |
| yoga-layout (WASM) | 92.40µs | ±200ns | 100.70µs | 10.8k ops/s |
| @pilates/core (spineless) | 175.70µs | ±5.45µs | 231.40µs | 5.7k ops/s |
| @pilates/core (spineless rebuild) | 27.36ms | ±447.90µs | 31.65ms | 37 ops/s |

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
