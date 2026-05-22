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
| @pilates/core (layout) | 5.20µs | ±0ns | 5.70µs | 192.3k ops/s |
| @pilates/render (full) | 77.00µs | ±0ns | 87.70µs | 13.0k ops/s |
| yoga-layout (WASM) | 19.00µs | ±100ns | 19.80µs | 52.6k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 144.90µs | ±300ns | 184.20µs | 6.9k ops/s |
| @pilates/render (full) | 373.20µs | ±900ns | 498.91µs | 2.7k ops/s |
| yoga-layout (WASM) | 332.90µs | ±200ns | 408.11µs | 3.0k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 711.60µs | ±2.20µs | 1.22ms | 1.4k ops/s |
| @pilates/render (full) | 2.07ms | ±17.75µs | 3.41ms | 483 ops/s |
| yoga-layout (WASM) | 1.98ms | ±10.90µs | 2.34ms | 505 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 4.10ms | ±92.75µs | 6.03ms | 244 ops/s |
| @pilates/render (full) | 12.46ms | ±329.00µs | 17.42ms | 80 ops/s |
| yoga-layout (WASM) | 9.30ms | ±28.10µs | 9.94ms | 108 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 11.66ms | ±1.02ms | 15.40ms | 86 ops/s |
| @pilates/render (full) | 28.79ms | ±2.24ms | 33.22ms | 35 ops/s |
| yoga-layout (WASM) | 18.67ms | ±98.04µs | 19.65ms | 54 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.50µs | ±100ns | 23.80µs | 46.5k ops/s |
| @pilates/render (full) | 21.60µs | ±0ns | 24.20µs | 46.3k ops/s |
| yoga-layout (WASM) | 83.10µs | ±100ns | 89.90µs | 12.0k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 20.70µs | ±100ns | 22.80µs | 48.3k ops/s |
| @pilates/render (full) | 20.40µs | ±100ns | 22.30µs | 49.0k ops/s |
| yoga-layout (WASM) | 77.10µs | ±100ns | 82.60µs | 13.0k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 20.90µs | ±100ns | 23.30µs | 47.8k ops/s |
| @pilates/render (full) | 20.70µs | ±100ns | 23.10µs | 48.3k ops/s |
| yoga-layout (WASM) | 73.50µs | ±100ns | 79.00µs | 13.6k ops/s |
| @pilates/core (spineless) | 200ns | ±0ns | 200ns | 5.00M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 387.90µs | ±3.60µs | 537.30µs | 2.6k ops/s |
| @pilates/render (full) | 388.80µs | ±2.20µs | 547.51µs | 2.6k ops/s |
| yoga-layout (WASM) | 91.00µs | ±200ns | 99.00µs | 11.0k ops/s |
| @pilates/core (spineless) | 268.00µs | ±1.30µs | 352.92µs | 3.7k ops/s |
| @pilates/core (spineless rebuild) | 27.28ms | ±401.40µs | 31.02ms | 37 ops/s |

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
