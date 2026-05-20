import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { EnvSnapshot } from './env.js';
import { type BenchRunReport, writeJsonReport } from './reporter-json.js';
import type { ScenarioResult } from './runner.js';

function makeEnv(): EnvSnapshot {
  return {
    node: 'v22.21.0',
    platform: 'linux',
    arch: 'x64',
    platformId: 'linux-x64',
    cpu: { model: 'test', cores: 4 },
    os: 'test',
    git: { sha: 'abc1234', branch: 'main', dirty: false },
    timestamp: '2026-05-21T00:00:00.000Z',
    packages: { '@pilates/core': '1.1.0' },
  };
}

function makeScenarioResult(): ScenarioResult {
  return {
    name: 'tiny',
    notes: '10 nodes',
    engines: [
      {
        name: '@pilates/core (layout)',
        samples: [100, 110, 105, 108, 102],
        stats: {
          median: 105,
          p95: 110,
          mean: 105,
          stddev: 4,
          ci95: [102, 108],
          n: 5,
          trimmedCount: 0,
        },
      },
    ],
  };
}

describe('writeJsonReport', () => {
  test('writes a JSON file matching the BenchRunReport shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-test-'));
    try {
      const report: BenchRunReport = { env: makeEnv(), scenarios: [makeScenarioResult()] };
      const out = join(dir, 'abc1234.json');
      writeJsonReport(report, out);
      const text = readFileSync(out, 'utf8');
      const parsed = JSON.parse(text) as BenchRunReport;
      expect(parsed.env.platformId).toBe('linux-x64');
      expect(parsed.scenarios).toHaveLength(1);
      expect(parsed.scenarios[0]!.engines[0]!.stats.median).toBe(105);
      // Samples are preserved as-is (no truncation in Phase A).
      expect(parsed.scenarios[0]!.engines[0]!.samples).toHaveLength(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('uses 2-space indent (human-readable)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-test-'));
    try {
      const report: BenchRunReport = { env: makeEnv(), scenarios: [] };
      const out = join(dir, 'abc1234.json');
      writeJsonReport(report, out);
      const text = readFileSync(out, 'utf8');
      // First field should be on its own line with 2-space indent.
      expect(text).toContain('\n  "env":');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
