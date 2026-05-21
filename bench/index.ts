/**
 * Benchmark harness for Pilates vs reference WASM flexbox.
 *
 * Usage:
 *   pnpm bench              — default run; writes RESULTS.md + history/<sha>.json
 *   pnpm bench:variance     — N=20 runs per scenario; reports per-scenario CI95
 *
 * Each scenario builds the same tree shape in three engines, runs each
 * via the bench harness (tinybench + bootstrap CI95), and writes
 * Markdown + JSON reports.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotEnv } from './harness/env.js';
import { writeJsonReport } from './harness/reporter-json.js';
import { writeMarkdownReport } from './harness/reporter-markdown.js';
import { type Scenario, runScenarios } from './harness/runner.js';
import { computeStats } from './harness/stats.js';
import * as big from './scenarios/big.js';
import * as hotRelayoutBoundary from './scenarios/hot-relayout-boundary.js';
import * as hotRelayoutText from './scenarios/hot-relayout-text.js';
import * as hotRelayout from './scenarios/hot-relayout.js';
import * as hotStructural from './scenarios/hot-structural.js';
import * as huge from './scenarios/huge.js';
import * as realistic from './scenarios/realistic.js';
import * as stress from './scenarios/stress.js';
import * as tiny from './scenarios/tiny.js';

const BENCH_DIR = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = resolve(BENCH_DIR, 'RESULTS.md');
const HISTORY_DIR = resolve(BENCH_DIR, 'history');

interface ScenarioModule {
  pilatesCoreLayout: () => void;
  pilatesFullRender: () => void;
  yogaLayout: () => void;
  pilatesSpinelessLayout?: () => void;
  pilatesSpinelessRebuild?: () => void;
}

function buildScenario(name: string, notes: string, mod: ScenarioModule): Scenario {
  const engines: Record<string, () => void> = {
    '@pilates/core (layout)': mod.pilatesCoreLayout,
    '@pilates/render (full)': mod.pilatesFullRender,
    'yoga-layout (WASM)': mod.yogaLayout,
  };
  if (mod.pilatesSpinelessLayout !== undefined) {
    engines['@pilates/core (spineless)'] = mod.pilatesSpinelessLayout;
  }
  if (mod.pilatesSpinelessRebuild !== undefined) {
    engines['@pilates/core (spineless rebuild)'] = mod.pilatesSpinelessRebuild;
  }
  return { name, notes, engines };
}

const SCENARIOS: Scenario[] = [
  buildScenario('tiny', '10 nodes, 1 level', tiny),
  buildScenario('realistic', '~100 nodes, 3-4 levels', realistic),
  buildScenario('stress', '~1000 nodes, 2 levels', stress),
  buildScenario('big', '~5000 nodes, 2 levels (50 × 100)', big),
  buildScenario('huge', '~10000 nodes, 2 levels (100 × 100)', huge),
  buildScenario('hotrelayout', '1k-node persistent tree, mutate one leaf per pass', hotRelayout),
  buildScenario(
    'hotrelayoutboundary',
    '1k-node persistent tree with explicit-sized row boundaries, mutate one leaf',
    hotRelayoutBoundary,
  ),
  buildScenario(
    'hotrelayouttext',
    '1k-node fixed-size table, mutate one leaf width per pass (Spineless incremental engine)',
    hotRelayoutText,
  ),
  buildScenario(
    'hotstructural',
    '~1k-node table, append + remove a whole row per pass (Spineless graft / detach)',
    hotStructural,
  ),
];

async function runDefault(): Promise<void> {
  const env = snapshotEnv();
  const scenarios = await runScenarios({
    scenarios: SCENARIOS,
    onScenarioStart: (name) => process.stderr.write(`benching ${name}…\n`),
  });
  const report = { env, scenarios };
  writeMarkdownReport(report, RESULTS_PATH);
  writeJsonReport(report, resolve(HISTORY_DIR, `${env.git.sha.slice(0, 12) || 'unknown'}.json`));
  process.stderr.write(`wrote ${RESULTS_PATH}\n`);
  process.stderr.write(
    `wrote ${resolve(HISTORY_DIR, `${env.git.sha.slice(0, 12) || 'unknown'}.json`)}\n`,
  );
}

async function runVariance(): Promise<void> {
  const N = 20;
  process.stderr.write(`bench:variance — running ${N} full passes\n`);
  // Collect per-(scenario, engine) sample-of-medians across N runs.
  const accum = new Map<string, number[]>();
  for (let i = 0; i < N; i++) {
    process.stderr.write(`  pass ${i + 1}/${N}\n`);
    const results = await runScenarios({ scenarios: SCENARIOS, measureMs: 1500, warmupMs: 250 });
    for (const s of results) {
      for (const e of s.engines) {
        const key = `${s.name}::${e.name}`;
        const arr = accum.get(key) ?? [];
        arr.push(e.stats.median);
        accum.set(key, arr);
      }
    }
  }
  // Report per-key distribution.
  const env = snapshotEnv();
  const lines: string[] = [];
  lines.push(`# bench:variance — ${N} runs · ${env.platformId} · ${env.node}`);
  lines.push('');
  lines.push('| Scenario | Engine | Median of medians | CI95 of medians | min | max |');
  lines.push('|---|---|---:|---:|---:|---:|');
  for (const [key, medians] of accum) {
    const [scenarioName, engineName] = key.split('::');
    const stats = computeStats(medians);
    const lo = Math.min(...medians);
    const hi = Math.max(...medians);
    const fmt = (ns: number): string => `${(ns / 1000).toFixed(2)}µs`;
    lines.push(
      `| ${scenarioName} | ${engineName} | ${fmt(stats.median)} | [${fmt(stats.ci95[0])}, ${fmt(stats.ci95[1])}] | ${fmt(lo)} | ${fmt(hi)} |`,
    );
  }
  const outPath = resolve(BENCH_DIR, 'VARIANCE.md');
  writeFileSync(outPath, `${lines.join('\n')}\n`);
  process.stderr.write(`wrote ${outPath}\n`);
}

async function main(): Promise<void> {
  const variance = process.argv.includes('--variance');
  if (variance) await runVariance();
  else await runDefault();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
