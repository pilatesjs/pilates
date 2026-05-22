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
| @pilates/render (full) | 73.30µs | ±300ns | 92.20µs | 13.6k ops/s |
| yoga-layout (WASM) | 19.30µs | ±0ns | 21.50µs | 51.8k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 125.30µs | ±400ns | 168.40µs | 8.0k ops/s |
| @pilates/render (full) | 351.65µs | ±850ns | 495.51µs | 2.8k ops/s |
| yoga-layout (WASM) | 332.40µs | ±200ns | 405.82µs | 3.0k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 628.50µs | ±1.80µs | 970.45µs | 1.6k ops/s |
| @pilates/render (full) | 1.90ms | ±17.10µs | 2.83ms | 526 ops/s |
| yoga-layout (WASM) | 1.92ms | ±3.25µs | 2.18ms | 521 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 3.46ms | ±115.50µs | 4.85ms | 289 ops/s |
| @pilates/render (full) | 10.91ms | ±376.20µs | 15.90ms | 92 ops/s |
| yoga-layout (WASM) | 9.59ms | ±46.35µs | 10.24ms | 104 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 9.23ms | ±127.95µs | 12.07ms | 108 ops/s |
| @pilates/render (full) | 25.91ms | ±229.90µs | 33.00ms | 39 ops/s |
| yoga-layout (WASM) | 19.22ms | ±78.30µs | 20.22ms | 52 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 22.60µs | ±100ns | 25.30µs | 44.2k ops/s |
| @pilates/render (full) | 22.30µs | ±100ns | 25.10µs | 44.8k ops/s |
| yoga-layout (WASM) | 84.70µs | ±100ns | 92.80µs | 11.8k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.70µs | ±0ns | 25.20µs | 46.1k ops/s |
| @pilates/render (full) | 21.80µs | ±0ns | 24.40µs | 45.9k ops/s |
| yoga-layout (WASM) | 80.00µs | ±100ns | 89.20µs | 12.5k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.60µs | ±0ns | 23.50µs | 46.3k ops/s |
| @pilates/render (full) | 21.90µs | ±0ns | 24.50µs | 45.7k ops/s |
| yoga-layout (WASM) | 78.70µs | ±200ns | 92.20µs | 12.7k ops/s |
| @pilates/core (spineless) | 200ns | ±0ns | 300ns | 5.00M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 234.25µs | ±9.35µs | 373.41µs | 4.3k ops/s |
| @pilates/render (full) | 228.00µs | ±7.01µs | 375.11µs | 4.4k ops/s |
| yoga-layout (WASM) | 96.60µs | ±200ns | 116.00µs | 10.4k ops/s |
| @pilates/core (spineless) | 193.65µs | ±4.95µs | 279.80µs | 5.2k ops/s |
| @pilates/core (spineless rebuild) | 29.83ms | ±606.00µs | 34.11ms | 34 ops/s |

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
