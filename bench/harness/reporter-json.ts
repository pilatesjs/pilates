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
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
}
