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
| @pilates/render (full) | 64.50µs | ±100ns | 79.00µs | 15.5k ops/s |
| yoga-layout (WASM) | 18.90µs | ±0ns | 19.80µs | 52.9k ops/s |

## realistic

> ~100 nodes, 3-4 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 122.60µs | ±300ns | 159.20µs | 8.2k ops/s |
| @pilates/render (full) | 340.90µs | ±800ns | 450.41µs | 2.9k ops/s |
| yoga-layout (WASM) | 332.30µs | ±300ns | 501.30µs | 3.0k ops/s |

## stress

> ~1000 nodes, 2 levels

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 623.10µs | ±1.50µs | 925.80µs | 1.6k ops/s |
| @pilates/render (full) | 1.88ms | ±20.30µs | 3.22ms | 531 ops/s |
| yoga-layout (WASM) | 2.11ms | ±32.75µs | 3.17ms | 474 ops/s |

## big

> ~5000 nodes, 2 levels (50 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 4.04ms | ±64.75µs | 5.39ms | 248 ops/s |
| @pilates/render (full) | 11.87ms | ±245.66µs | 17.00ms | 84 ops/s |
| yoga-layout (WASM) | 10.29ms | ±139.10µs | 13.02ms | 97 ops/s |

## huge

> ~10000 nodes, 2 levels (100 × 100)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 10.64ms | ±262.25µs | 13.67ms | 94 ops/s |
| @pilates/render (full) | 27.28ms | ±477.80µs | 34.06ms | 37 ops/s |
| yoga-layout (WASM) | 19.87ms | ±279.80µs | 26.39ms | 50 ops/s |

## hotrelayout

> 1k-node persistent tree, mutate one leaf per pass

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.40µs | ±0ns | 25.30µs | 46.7k ops/s |
| @pilates/render (full) | 21.50µs | ±0ns | 28.80µs | 46.5k ops/s |
| yoga-layout (WASM) | 87.00µs | ±200ns | 105.80µs | 11.5k ops/s |

## hotrelayoutboundary

> 1k-node persistent tree with explicit-sized row boundaries, mutate one leaf

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 21.60µs | ±0ns | 30.40µs | 46.3k ops/s |
| @pilates/render (full) | 21.20µs | ±0ns | 28.00µs | 47.2k ops/s |
| yoga-layout (WASM) | 81.30µs | ±100ns | 95.20µs | 12.3k ops/s |

## hotrelayouttext

> 1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 20.10µs | ±100ns | 22.70µs | 49.8k ops/s |
| @pilates/render (full) | 20.00µs | ±0ns | 23.30µs | 50.0k ops/s |
| yoga-layout (WASM) | 73.90µs | ±100ns | 84.10µs | 13.5k ops/s |
| @pilates/core (spineless) | 200ns | ±0ns | 200ns | 5.00M ops/s |

## hotstructural

> ~1k-node table, append + remove a whole row per pass (Spineless graft / detach)

| Engine | Median | CI95 | P95 | Throughput |
|---|---:|---:|---:|---:|
| @pilates/core (layout) | 204.30µs | ±4.70µs | 286.50µs | 4.9k ops/s |
| @pilates/render (full) | 203.20µs | ±4.11µs | 272.10µs | 4.9k ops/s |
| yoga-layout (WASM) | 112.10µs | ±400ns | 133.80µs | 8.9k ops/s |
| @pilates/core (spineless) | 206.00µs | ±7.60µs | 334.40µs | 4.9k ops/s |
| @pilates/core (spineless rebuild) | 51.88ms | ±873.70µs | 58.11ms | 19 ops/s |

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
