/**
 * Benchmark harness for Pilates vs reference WASM flexbox.
 *
 * Usage: `pnpm bench` — builds, runs, writes `bench/RESULTS.md`.
 *
 * Each scenario builds the same tree shape in three engines, runs each
 * via tinybench (with warmup), and writes a markdown report.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bench } from 'tinybench';
import * as big from './scenarios/big.js';
import * as hotRelayoutBoundary from './scenarios/hot-relayout-boundary.js';
import * as hotRelayoutText from './scenarios/hot-relayout-text.js';
import * as hotRelayout from './scenarios/hot-relayout.js';
import * as huge from './scenarios/huge.js';
import * as realistic from './scenarios/realistic.js';
import * as stress from './scenarios/stress.js';
import * as tiny from './scenarios/tiny.js';

const RESULTS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'RESULTS.md');

interface Scenario {
  name: string;
  notes: string;
  pilatesCoreLayout: () => void;
  pilatesFullRender: () => void;
  yogaLayout: () => void;
  // Optional fourth engine: the Spineless incremental runtime (phase 5b).
  // Only the scenarios that exercise its sweet spot wire this in.
  pilatesSpinelessLayout?: () => void;
}

const SCENARIOS: Scenario[] = [
  { name: 'tiny', notes: '10 nodes, 1 level', ...tiny },
  { name: 'realistic', notes: '~100 nodes, 3-4 levels', ...realistic },
  { name: 'stress', notes: '~1000 nodes, 2 levels', ...stress },
  { name: 'big', notes: '~5000 nodes, 2 levels (50 × 100)', ...big },
  { name: 'huge', notes: '~10000 nodes, 2 levels (100 × 100)', ...huge },
  {
    name: 'hotrelayout',
    notes: '1k-node persistent tree, mutate one leaf per pass',
    ...hotRelayout,
  },
  {
    name: 'hotrelayoutboundary',
    notes: '1k-node persistent tree with explicit-sized row boundaries, mutate one leaf',
    ...hotRelayoutBoundary,
  },
  {
    name: 'hotrelayouttext',
    notes:
      '1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)',
    ...hotRelayoutText,
  },
];

async function runScenario(s: Scenario): Promise<{
  name: string;
  notes: string;
  results: Record<string, { mean: number; hz: number; samples: number }>;
}> {
  const bench = new Bench({ time: 1000, warmupTime: 250, warmup: true });
  bench
    .add('@pilates/core (layout)', s.pilatesCoreLayout)
    .add('@pilates/render (full)', s.pilatesFullRender)
    .add('yoga-layout (WASM)', s.yogaLayout);
  if (s.pilatesSpinelessLayout !== undefined) {
    bench.add('@pilates/core (spineless)', s.pilatesSpinelessLayout);
  }

  await bench.run();

  const results: Record<string, { mean: number; hz: number; samples: number }> = {};
  for (const task of bench.tasks) {
    const r = task.result;
    if (!r || r.state !== 'completed') continue;
    const meanMs = r.latency.mean;
    const hz = meanMs > 0 ? 1000 / meanMs : 0;
    const samples = r.latency.samples?.length ?? 0;
    results[task.name] = { mean: meanMs, hz, samples };
  }
  return { name: s.name, notes: s.notes, results };
}

function fmtMs(ms: number): string {
  if (ms < 0.001) return `${(ms * 1000).toFixed(2)}µs`;
  if (ms < 1) return `${(ms * 1000).toFixed(1)}µs`;
  if (ms < 10) return `${ms.toFixed(2)}ms`;
  return `${ms.toFixed(1)}ms`;
}

function fmtHz(hz: number): string {
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)}M ops/s`;
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(1)}k ops/s`;
  return `${hz.toFixed(0)} ops/s`;
}

async function main(): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const node = process.version;
  const platform = `${process.platform}/${process.arch}`;
  const out: string[] = [];

  out.push('# Pilates benchmark results');
  out.push('');
  out.push(`Generated: ${date} · Node ${node} · ${platform}`);
  out.push('');
  out.push('Reproduce: `pnpm bench`. Numbers vary by machine — relative');
  out.push('positions are the interesting signal.');
  out.push('');
  out.push('## Scenarios');
  out.push('');
  out.push('| Scenario | Tree shape |');
  out.push('|---|---|');
  for (const s of SCENARIOS) {
    out.push(`| **${s.name}** | ${s.notes} |`);
  }
  out.push('');

  for (const s of SCENARIOS) {
    process.stderr.write(`benching ${s.name}…\n`);
    const result = await runScenario(s);
    out.push(`## ${result.name}`);
    out.push('');
    out.push(`> ${result.notes}`);
    out.push('');
    out.push('| Engine | Mean latency | Throughput | Samples |');
    out.push('|---|---:|---:|---:|');
    for (const [name, r] of Object.entries(result.results)) {
      out.push(`| ${name} | ${fmtMs(r.mean)} | ${fmtHz(r.hz)} | ${r.samples} |`);
    }
    out.push('');
  }

  out.push("## What's measured");
  out.push('');
  out.push('Each iteration **builds a fresh tree and runs the layout pass**.');
  out.push('This is representative of how TUIs use a layout engine in');
  out.push('practice — every frame redraw constructs (or reconstructs) the');
  out.push('tree from declarative state.');
  out.push('');
  out.push('- `@pilates/core (layout)` — build a Pilates `Node` tree,');
  out.push('  call `calculateLayout()`. No painting.');
  out.push('- `@pilates/render (full)` — build a declarative `RenderNode`,');
  out.push('  call `renderToFrame()` (= build core tree, calculate layout,');
  out.push('  paint cells into the Frame). Closest analog to Yoga doing');
  out.push('  layout *plus* a render layer on top.');
  out.push('- `yoga-layout (WASM)` — build a Yoga `Node` tree (same shape),');
  out.push('  call `calculateLayout()`. Layout-only baseline. The reference');
  out.push('  implementation Pilates is validated against cell-for-cell in');
  out.push('  `packages/core/test/yoga-oracle.test.ts`.');
  out.push('');
  out.push('## Why Pilates wins on tree-build-then-layout');
  out.push('');
  out.push("WASM Yoga's C++ layout pass is fast in isolation, but every");
  out.push('Node.create / setProperty crosses the JS↔WASM boundary. At');
  out.push('typical TUI tree sizes (10–1000 nodes per frame) the marshalling');
  out.push('cost dominates the compute. Pure-TS Pilates pays no such cost;');
  out.push('every operation is a property assignment on a JS object.');
  out.push('');
  out.push('## Long-lived trees with hot relayouts');
  out.push('');
  out.push('Building the tree once and mutating-and-relayouting in a loop');
  out.push("is the workload Yoga's WASM compute advantage traditionally");
  out.push('shows up on. Two scenarios cover this shape:');
  out.push('');
  out.push('- `hotrelayout` — 1k-node persistent tree with no boundary');
  out.push('  hints. Yoga still wins here because every leaf mutation');
  out.push("  walks the dirty bit to root, invalidating Pilates'");
  out.push('  layout cache.');
  out.push('- `hotrelayoutboundary` — same shape but with explicit-sized');
  out.push('  row containers (`width: N, height: M`, default flex). Each');
  out.push('  row acts as a relayout boundary: leaf mutations dirty the');
  out.push("  row but don't propagate to root, so Pilates' root layout");
  out.push('  cache hits and only the row subtree re-runs flex.');
  out.push('  **Pilates is ~9× faster than Yoga** on this scenario.');
  out.push('- `hotrelayouttext` — 1k-node fixed-size table; mutating one');
  out.push("  leaf's width per pass. Adds a fourth engine,");
  out.push('  `@pilates/core (spineless)`, the phase-5b incremental');
  out.push('  runtime: the flex grammar is built once, the leaf width');
  out.push('  is marked dirty, and `recompute()` ripples through only');
  out.push("  the downstream cells' positions in the same row. The");
  out.push('  imperative + Yoga columns measure the same mutation under');
  out.push('  a full `calculateLayout()` for comparison.');
  out.push('');
  out.push('The boundary path is opt-in by tree shape, not API: any');
  out.push('explicit-sized container with default flex grow/shrink');
  out.push('qualifies, which matches the idiomatic TUI pattern of');
  out.push('`<Box width={N} height={M}>` containers around dynamic');
  out.push('content. See `docs/superpowers/specs/2026-05-09-relayout-boundaries-design.md`.');
  out.push('The Spineless runtime targets the same workload via a');
  out.push('different mechanism — see');
  out.push('`docs/superpowers/specs/2026-05-12-spineless-foundation.md`.');
  out.push('');
  out.push('## When Yoga still wins');
  out.push('');
  out.push('- **Concurrent layout of many independent trees**: WASM can');
  out.push("  unlock SharedArrayBuffer + worker patterns Pilates can't.");
  out.push('- **Trees with no explicit-sized boundaries that hot-relayout');
  out.push('  per frame**: see `hotrelayout` scenario above. If your tree');
  out.push('  is fully fluid (no `width: N, height: M` containers) and');
  out.push('  every frame mutates a leaf, Yoga is faster.');
  out.push('');
  out.push('## What you also get with Pilates regardless');
  out.push('');
  out.push('- **Zero WASM init cost** — first layout call returns immediately.');
  out.push('- **Any JS runtime** — pure TypeScript runs in Node, Bun, Deno,');
  out.push("  the browser, edge functions. Yoga's WASM bundle requires the");
  out.push('  loader and adds ~150 KB.');
  out.push('- **Zero runtime deps** — Pilates ships nothing transitive.');

  writeFileSync(RESULTS_PATH, `${out.join('\n')}\n`);
  process.stderr.write(`wrote ${RESULTS_PATH}\n`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
