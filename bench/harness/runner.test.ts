import { describe, expect, test } from 'vitest';
import { type Scenario, runScenarios } from './runner.js';

describe('runScenarios', () => {
  test('runs each engine for each scenario and produces stats', async () => {
    const scenario: Scenario = {
      name: 'trivial',
      notes: 'a no-op iteration',
      engines: {
        fast: () => {
          // Fast: a small numeric op.
          let s = 0;
          for (let i = 0; i < 100; i++) s += i;
          if (s < 0) throw new Error('unreachable');
        },
        slow: () => {
          // Slower: more numeric work.
          let s = 0;
          for (let i = 0; i < 10_000; i++) s += i;
          if (s < 0) throw new Error('unreachable');
        },
      },
    };
    const results = await runScenarios({
      scenarios: [scenario],
      warmupMs: 50,
      measureMs: 200,
    });
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.name).toBe('trivial');
    expect(r.notes).toBe('a no-op iteration');
    expect(r.engines).toHaveLength(2);
    const fast = r.engines.find((e) => e.name === 'fast')!;
    const slow = r.engines.find((e) => e.name === 'slow')!;
    expect(fast.stats.median).toBeGreaterThan(0);
    expect(fast.stats.ci95[0]).toBeLessThanOrEqual(fast.stats.median);
    expect(fast.stats.ci95[1]).toBeGreaterThanOrEqual(fast.stats.median);
    expect(fast.stats.median).toBeLessThan(slow.stats.median);
    expect(fast.samples.length).toBeGreaterThan(10);
  });

  test('respects an empty scenarios list', async () => {
    const results = await runScenarios({ scenarios: [], warmupMs: 1, measureMs: 1 });
    expect(results).toEqual([]);
  });
});
