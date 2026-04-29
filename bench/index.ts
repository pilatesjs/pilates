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
}

const SCENARIOS: Scenario[] = [
  { name: 'tiny', notes: '10 nodes, 1 level', ...tiny },
  { name: 'realistic', notes: '~100 nodes, 3-4 levels', ...realistic },
  { name: 'stress', notes: '~1000 nodes, 2 levels', ...stress },
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
  out.push('## When Yoga still wins');
  out.push('');
  out.push('- **Long-lived trees with hot relayouts**: build the tree once,');
  out.push('  mutate-and-relayout in a loop. The build cost amortizes; only');
  out.push("  the layout pass is measured. WASM Yoga's compute advantage");
  out.push('  shows up here. (Not benchmarked in this suite — an issue if');
  out.push('  your use case looks like that.)');
  out.push('- **Concurrent layout of many independent trees**: WASM can');
  out.push("  unlock SharedArrayBuffer + worker patterns Pilates can't.");
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
