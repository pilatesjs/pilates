import { describe, expect, test } from 'vitest';
import { type CheckResult, evaluateBudgets } from './check-budgets.js';

const thresholds = {
  tiny: {
    '@pilates/core (layout)': {
      'linux-x64': { expectedMedianUs: 5.0, ci95Us: [4.0, 6.0] as [number, number] },
    },
  },
};

const env = {
  platformId: 'linux-x64',
  // The other env fields aren't read by evaluateBudgets — supply minimal stubs.
} as unknown as import('./harness/env.js').EnvSnapshot;

function makeReport(medianUs: number, ci95Us: [number, number]) {
  return {
    env,
    scenarios: [
      {
        name: 'tiny',
        notes: '10 nodes',
        engines: [
          {
            name: '@pilates/core (layout)',
            samples: [],
            stats: {
              median: medianUs * 1000, // ns
              p95: medianUs * 1000,
              mean: medianUs * 1000,
              stddev: 0,
              ci95: [ci95Us[0] * 1000, ci95Us[1] * 1000] as [number, number],
              n: 100,
              trimmedCount: 0,
            },
          },
        ],
      },
    ],
  };
}

describe('evaluateBudgets', () => {
  test('no regression when current CI95 overlaps threshold CI95', () => {
    const report = makeReport(5.0, [4.5, 5.5]); // overlaps [4.0, 6.0]
    const result = evaluateBudgets(report, thresholds);
    expect(result.regressions).toHaveLength(0);
    expect(result.checked).toBe(1);
  });

  test('regression when current CI95 lower bound exceeds threshold CI95 upper × 1.10', () => {
    // threshold upper × 1.10 = 6.6. Current lower at 7.0 → regression.
    const report = makeReport(8.0, [7.0, 9.0]);
    const result = evaluateBudgets(report, thresholds);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0]!.scenario).toBe('tiny');
    expect(result.regressions[0]!.engine).toBe('@pilates/core (layout)');
  });

  test('within headroom — no regression', () => {
    // threshold upper × 1.10 = 6.6. Current lower at 6.5 → within headroom.
    const report = makeReport(7.0, [6.5, 7.5]);
    const result = evaluateBudgets(report, thresholds);
    expect(result.regressions).toHaveLength(0);
  });

  test('improvement is logged but not flagged as regression', () => {
    const report = makeReport(2.0, [1.5, 2.5]);
    const result = evaluateBudgets(report, thresholds);
    expect(result.regressions).toHaveLength(0);
    expect(result.improvements).toHaveLength(1);
  });

  test('missing platform threshold emits a warning, not a regression', () => {
    const otherEnv = { ...env, platformId: 'darwin-arm64' } as typeof env;
    const report = { ...makeReport(5.0, [4.5, 5.5]), env: otherEnv };
    const result = evaluateBudgets(report, thresholds);
    expect(result.regressions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
