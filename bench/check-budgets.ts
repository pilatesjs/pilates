/**
 * Regression detector for `pnpm bench`. Loads the most recent
 * bench/history/<sha>.json, compares each (scenario, engine) median
 * + CI95 to the expectation in bench/thresholds.json for the current
 * platform.
 *
 * A regression is flagged when the current CI95 LOWER bound is above
 * the threshold's CI95 UPPER bound × 1.10 — i.e. the distributions
 * don't overlap AND the gap exceeds 10% of the upper bound. This is
 * tighter than the pre-overhaul "single ceiling" rule and catches
 * smaller regressions.
 *
 * @internal
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EnvSnapshot } from './harness/env.js';
import type { BenchRunReport } from './harness/reporter-json.js';

interface ThresholdEntry {
  expectedMedianUs: number;
  ci95Us: [number, number];
}
type Thresholds = Record<string, Record<string, Record<string, ThresholdEntry>>>;

export interface Regression {
  scenario: string;
  engine: string;
  platformId: string;
  observed: { medianUs: number; ci95Us: [number, number] };
  threshold: ThresholdEntry;
  ratio: number;
}

export interface Improvement {
  scenario: string;
  engine: string;
  observedMedianUs: number;
  thresholdMedianUs: number;
}

export interface CheckResult {
  checked: number;
  regressions: Regression[];
  improvements: Improvement[];
  warnings: string[];
}

const BENCH_DIR = dirname(fileURLToPath(import.meta.url));

const HEADROOM = 1.1; // 10% above threshold upper before regression fails

function loadReport(): BenchRunReport {
  const historyDir = resolve(BENCH_DIR, 'history');
  const files = readdirSync(historyDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error(`[check-budgets] no history files in ${historyDir}; run \`pnpm bench\` first`);
  }
  const newest = files
    .map((f) => ({ f, mtime: statSync(resolve(historyDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]!;
  return JSON.parse(readFileSync(resolve(historyDir, newest.f), 'utf8')) as BenchRunReport;
}

function loadThresholds(): Thresholds {
  const path = resolve(BENCH_DIR, 'thresholds.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Thresholds;
}

export function evaluateBudgets(report: BenchRunReport, thresholds: Thresholds): CheckResult {
  const platformId = report.env.platformId;
  const regressions: Regression[] = [];
  const improvements: Improvement[] = [];
  const warnings: string[] = [];
  let checked = 0;
  for (const s of report.scenarios) {
    const scenarioThr = thresholds[s.name];
    if (scenarioThr === undefined) continue;
    for (const e of s.engines) {
      const engineThr = scenarioThr[e.name];
      if (engineThr === undefined) continue;
      const thr = engineThr[platformId];
      if (thr === undefined) {
        warnings.push(
          `no threshold for ${s.name} · ${e.name} on ${platformId} — populate via \`pnpm bench:variance\``,
        );
        continue;
      }
      checked++;
      const observedMedianUs = e.stats.median / 1000;
      const observedCi95Us: [number, number] = [e.stats.ci95[0] / 1000, e.stats.ci95[1] / 1000];
      const ceiling = thr.ci95Us[1] * HEADROOM;
      if (observedCi95Us[0] > ceiling) {
        regressions.push({
          scenario: s.name,
          engine: e.name,
          platformId,
          observed: { medianUs: observedMedianUs, ci95Us: observedCi95Us },
          threshold: thr,
          ratio: observedCi95Us[0] / thr.ci95Us[1],
        });
      } else if (observedCi95Us[1] < thr.ci95Us[0]) {
        improvements.push({
          scenario: s.name,
          engine: e.name,
          observedMedianUs,
          thresholdMedianUs: thr.expectedMedianUs,
        });
      }
    }
  }
  return { checked, regressions, improvements, warnings };
}

async function main(): Promise<void> {
  const report = loadReport();
  const thresholds = loadThresholds();
  const result = evaluateBudgets(report, thresholds);
  process.stderr.write(
    `checked ${result.checked} (scenario, engine) pairs on ${report.env.platformId}\n`,
  );
  for (const w of result.warnings) process.stderr.write(`warn: ${w}\n`);
  for (const i of result.improvements) {
    process.stderr.write(
      `improvement: ${i.scenario} · ${i.engine}: ${i.observedMedianUs.toFixed(2)}µs (was ${i.thresholdMedianUs.toFixed(2)}µs)\n`,
    );
  }
  if (result.regressions.length > 0) {
    for (const r of result.regressions) {
      process.stderr.write(
        `REGRESSION: ${r.scenario} · ${r.engine} on ${r.platformId}: median ${r.observed.medianUs.toFixed(2)}µs (CI95 [${r.observed.ci95Us[0].toFixed(2)}, ${r.observed.ci95Us[1].toFixed(2)}]) vs threshold CI95 [${r.threshold.ci95Us[0].toFixed(2)}, ${r.threshold.ci95Us[1].toFixed(2)}] · ratio ${r.ratio.toFixed(2)}×\n`,
      );
    }
    process.exit(1);
  }
  process.stderr.write('all bench budgets within threshold\n');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
