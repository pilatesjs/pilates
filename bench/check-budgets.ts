/**
 * Compares the latest `bench/RESULTS.md` numbers against
 * `bench/thresholds.json`. Phase 1 (this script): warn-only — exits 0
 * even on regression but prints a clear notice. Phase 2 will flip to
 * exit-non-zero.
 *
 * Usage: `pnpm bench:budgets` (after running `pnpm bench`).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RESULTS = resolve(here, 'RESULTS.md');
const THRESHOLDS = resolve(here, 'thresholds.json');

interface Threshold {
  maxMeanMs: number;
}
type Thresholds = Record<string, Record<string, Threshold>>;

interface MeasuredRow {
  engine: string;
  meanMs: number;
}
type MeasuredScenarios = Record<string, MeasuredRow[]>;

function parseResults(md: string): MeasuredScenarios {
  // RESULTS.md sections start with "## <scenario>" then have a table:
  //   | Engine | Mean latency | Throughput | Samples |
  //   |---|---:|---:|---:|
  //   | @pilates/core (layout) | 2.0µs | ... |
  // Real scenarios are lowercase one-word identifiers we control.
  const out: MeasuredScenarios = {};
  const lines = md.split('\n');

  let currentScenario: string | null = null;
  for (const line of lines) {
    const heading = /^## (\w+)$/.exec(line);
    if (heading !== null) {
      const name = heading[1]!;
      currentScenario = /^[a-z]+$/.test(name) ? name : null;
      if (currentScenario !== null) out[currentScenario] = [];
      continue;
    }
    if (currentScenario === null) continue;
    const row = /^\|\s*([^|]+?)\s*\|\s*([0-9.]+)(µs|ms)\s*\|/.exec(line);
    if (row === null) continue;
    const engine = row[1]!.trim();
    const value = Number.parseFloat(row[2]!);
    const unit = row[3]!;
    const meanMs = unit === 'µs' ? value / 1000 : value;
    out[currentScenario]!.push({ engine, meanMs });
  }
  return out;
}

function main(): void {
  const thresholds = JSON.parse(readFileSync(THRESHOLDS, 'utf8')) as Thresholds;
  const measured = parseResults(readFileSync(RESULTS, 'utf8'));

  const violations: string[] = [];
  for (const [scenario, engines] of Object.entries(thresholds)) {
    const rows = measured[scenario];
    if (rows === undefined) {
      violations.push(`scenario "${scenario}" has thresholds but no results`);
      continue;
    }
    for (const [engine, threshold] of Object.entries(engines)) {
      const row = rows.find((r) => r.engine === engine);
      if (row === undefined) {
        violations.push(`scenario "${scenario}" engine "${engine}" missing from results`);
        continue;
      }
      if (row.meanMs > threshold.maxMeanMs) {
        violations.push(
          `[${scenario}] ${engine}: ${row.meanMs.toFixed(3)}ms > ${threshold.maxMeanMs}ms budget`,
        );
      }
    }
  }

  if (violations.length === 0) {
    process.stderr.write('all bench budgets within threshold\n');
    return;
  }

  process.stderr.write('=== bench budget WARNINGS (Phase 1: warn-only) ===\n');
  for (const v of violations) process.stderr.write(`  ${v}\n`);
  process.stderr.write(`(${violations.length} violation${violations.length === 1 ? '' : 's'})\n`);
  // Phase 1 — do NOT exit non-zero. Phase 2 will change this to:
  //   process.exit(1);
}

main();
