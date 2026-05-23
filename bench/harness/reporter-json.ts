/**
 * JSON reporter for one bench run. Writes a single file at
 * `bench/history/<sha>.json` (or wherever the caller specifies) so
 * downstream tools (regression detection, the future history
 * dashboard) can load runs by SHA.
 *
 * @internal
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EnvSnapshot } from './env.js';
import type { ScenarioResult } from './runner.js';

export interface BenchRunReport {
  env: EnvSnapshot;
  scenarios: ScenarioResult[];
}

export function writeJsonReport(report: BenchRunReport, outPath: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  // Strip raw per-iteration samples before serializing. tinybench
  // collects millions of samples for fast sync functions; JSON-
  // stringifying them blows past V8's max string length
  // (RangeError: Invalid string length). The history file only needs
  // the computed stats — that is what check-budgets + the history
  // dashboard consume.
  const slim = {
    env: report.env,
    scenarios: report.scenarios.map((s) => ({
      name: s.name,
      notes: s.notes,
      engines: s.engines.map((e) => ({ name: e.name, stats: e.stats })),
    })),
  };
  writeFileSync(outPath, `${JSON.stringify(slim, null, 2)}\n`);
}
