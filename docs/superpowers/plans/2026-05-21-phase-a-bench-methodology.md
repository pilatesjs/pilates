# Phase A — Bench methodology foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `bench/`'s measurement methodology around multi-run statistics (median / P95 / bootstrap CI95), per-platform thresholds, JSON output for historical tracking, and CI95-based regression detection — keeping all 9 existing scenarios passing.

**Architecture:** Extract orchestration from the monolithic `bench/index.ts` into a `bench/harness/` library (runner / stats / env / reporter-markdown / reporter-json). Wrap the existing tinybench measurement but post-process its `latency.samples` for richer stats. Output both `bench/RESULTS.md` (refined Markdown) and `bench/history/<sha>.json` (machine-parseable). Rewrite `check-budgets.ts` to use bootstrap CI95 vs per-platform expectations in `thresholds.json`. The 9 scenario files in `bench/scenarios/` are untouched.

**Tech Stack:** TypeScript 5.7 (NodeNext ESM), tsx for execution, tinybench for the measurement loop, node:fs / node:os / node:child_process for environment recording, vitest for harness unit tests. No new runtime dependencies — bootstrap CI95 is implemented in-house (~30 lines).

---

## File Structure

```
bench/
  index.ts                              MODIFIED  — subcommand dispatch (default / variance)
  check-budgets.ts                      MODIFIED  — CI95-based regression detection
  thresholds.json                       MODIFIED  — per-platform expectation structure
  harness/                              NEW directory
    stats.ts                            NEW       — median / P95 / bootstrap CI95 / trim
    stats.test.ts                       NEW       — vitest unit tests
    env.ts                              NEW       — environment snapshot
    env.test.ts                         NEW       — vitest unit tests
    runner.ts                           NEW       — orchestrates per-scenario tinybench, returns ScenarioResult[]
    runner.test.ts                      NEW       — vitest unit tests (uses a trivial in-memory scenario)
    reporter-markdown.ts                NEW       — RESULTS.md generator
    reporter-json.ts                    NEW       — bench/history/<sha>.json generator
    reporter-json.test.ts               NEW       — vitest unit tests
  history/                              NEW directory
    .gitkeep                            NEW       — keep the empty directory in git
  scenarios/                            UNCHANGED — all 9 scenario files stay as-is
vitest.config.ts                        MODIFIED  — add bench/harness to test includes
.github/workflows/perf-budgets.yml      MODIFIED  — upload bench/history/<sha>.json as artifact on push to main
.gitignore                              MODIFIED  — ignore bench/history/* (tracked entries are CI-uploaded artifacts, local runs shouldn't pollute git)
package.json                            MODIFIED  — add "bench:variance" script
```

The harness library is **self-contained** — `bench/harness/*` modules import only from each other, `node:*`, `tinybench`, and `@pilates/core` (read for the `VERSION` constant in env.ts). The scenarios import their target packages directly as today.

---

### Task 1: Stats library — pure functions for median / P95 / bootstrap CI95

**Files:**
- Create: `bench/harness/stats.ts`
- Create: `bench/harness/stats.test.ts`

The stats layer is pure functions over `number[]` (nanosecond timings). Bootstrap CI95 resamples the input with replacement N times, computes the median of each resample, and returns the [2.5%, 97.5%] percentiles of those resampled medians. Light outlier trim drops the top + bottom 5% before computing means / stddev (medians are intrinsically robust; the trim helps mean / stddev only — but we report it transparently in the SampleStats result).

- [ ] **Step 1: Write the failing tests**

Create `bench/harness/stats.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { bootstrapMedianCi95, computeStats, percentile, trimOutliers } from './stats.js';

describe('percentile', () => {
  test('returns the value at the given percentile of a sorted array', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 95)).toBeCloseTo(4.8, 5);
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
  });

  test('uses linear interpolation between adjacent ranks', () => {
    // For [10, 20], the 50th percentile sits halfway between → 15.
    expect(percentile([10, 20], 50)).toBeCloseTo(15, 5);
  });

  test('throws on empty input', () => {
    expect(() => percentile([], 50)).toThrow('empty');
  });
});

describe('trimOutliers', () => {
  test('drops top and bottom trimPct of the sorted samples', () => {
    const result = trimOutliers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.1);
    // 10% of 10 = 1 dropped from each end → [2..9].
    expect(result.sorted).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.trimmedCount).toBe(2);
  });

  test('respects 0% trim — no samples dropped', () => {
    const result = trimOutliers([1, 2, 3, 4, 5], 0);
    expect(result.sorted).toEqual([1, 2, 3, 4, 5]);
    expect(result.trimmedCount).toBe(0);
  });

  test('preserves all samples when trimPct rounds to 0 drop per side', () => {
    // 5 samples × 5% = 0.25 → floor to 0 per side.
    const result = trimOutliers([10, 20, 30, 40, 50], 0.05);
    expect(result.sorted).toEqual([10, 20, 30, 40, 50]);
    expect(result.trimmedCount).toBe(0);
  });
});

describe('bootstrapMedianCi95', () => {
  test('returns a finite [low, high] interval enclosing the input median', () => {
    const samples = Array.from({ length: 200 }, (_, i) => 100 + i); // 100..299
    const [low, high] = bootstrapMedianCi95(samples, 500);
    const sorted = [...samples].sort((a, b) => a - b);
    const median = (sorted[99]! + sorted[100]!) / 2; // 199.5
    expect(low).toBeLessThanOrEqual(median);
    expect(high).toBeGreaterThanOrEqual(median);
    expect(Number.isFinite(low)).toBe(true);
    expect(Number.isFinite(high)).toBe(true);
  });

  test('produces a tight interval on low-variance input', () => {
    // All samples are 100 ± 0.1 — median is ~100, CI95 should be tight.
    const samples = Array.from({ length: 200 }, () => 100 + (Math.random() - 0.5) * 0.2);
    const [low, high] = bootstrapMedianCi95(samples, 500);
    expect(high - low).toBeLessThan(1);
  });

  test('throws on empty input', () => {
    expect(() => bootstrapMedianCi95([], 500)).toThrow('empty');
  });
});

describe('computeStats', () => {
  test('reports median, p95, mean, stddev, ci95 over the trimmed sample set', () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const stats = computeStats(samples);
    expect(stats.median).toBe(55); // midpoint of sorted
    expect(stats.p95).toBeCloseTo(95.5, 1);
    expect(stats.mean).toBeCloseTo(55, 1);
    expect(stats.stddev).toBeGreaterThan(0);
    expect(stats.ci95[0]).toBeLessThanOrEqual(stats.median);
    expect(stats.ci95[1]).toBeGreaterThanOrEqual(stats.median);
    expect(stats.n).toBe(10); // 5% trim of 10 = 0 per side
    expect(stats.trimmedCount).toBe(0);
  });

  test('returns NaN-free stats on a degenerate single-sample input', () => {
    const stats = computeStats([42]);
    expect(stats.median).toBe(42);
    expect(stats.p95).toBe(42);
    expect(stats.mean).toBe(42);
    expect(stats.stddev).toBe(0);
    expect(stats.ci95).toEqual([42, 42]);
    expect(stats.n).toBe(1);
  });

  test('throws on empty input', () => {
    expect(() => computeStats([])).toThrow('empty');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test bench/harness/stats.test.ts`
Expected: FAIL — module `./stats.js` not found.

(Note: vitest's include doesn't yet cover `bench/`. Until Task 11 updates `vitest.config.ts`, run tests by direct path: `npx vitest run bench/harness/stats.test.ts`.)

- [ ] **Step 3: Implement stats.ts**

Create `bench/harness/stats.ts`:

```ts
/**
 * Pure statistical functions over an array of sample timings (in
 * nanoseconds, typically). Used by the bench harness; no I/O,
 * no side effects.
 *
 * @internal
 */

export interface SampleStats {
  /** Median of the trimmed samples. Reported as the headline number. */
  median: number;
  /** 95th percentile of the trimmed samples. */
  p95: number;
  /** Arithmetic mean of the trimmed samples. */
  mean: number;
  /** Sample standard deviation of the trimmed samples. */
  stddev: number;
  /** Bootstrap 95% confidence interval of the median:
   *  [2.5th, 97.5th] percentiles of resampled medians. */
  ci95: [number, number];
  /** Count of samples used after the outlier trim. */
  n: number;
  /** Count of samples discarded by the outlier trim. */
  trimmedCount: number;
}

/**
 * Linear-interpolation percentile (Type-7, the convention R / numpy
 * default to). `pct` is 0..100.
 */
export function percentile(samples: number[], pct: number): number {
  if (samples.length === 0) throw new Error('[stats] empty samples');
  if (samples.length === 1) return samples[0]!;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

/**
 * Drop the top and bottom `trimPct` (e.g. 0.05 = 5%) of the sorted
 * samples. Returns the sorted, trimmed array plus a count of dropped
 * samples.
 */
export function trimOutliers(
  samples: number[],
  trimPct: number,
): { sorted: number[]; trimmedCount: number } {
  if (trimPct < 0 || trimPct >= 0.5) {
    throw new Error('[stats] trimPct must be in [0, 0.5)');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const dropPerSide = Math.floor(sorted.length * trimPct);
  if (dropPerSide === 0) return { sorted, trimmedCount: 0 };
  return {
    sorted: sorted.slice(dropPerSide, sorted.length - dropPerSide),
    trimmedCount: dropPerSide * 2,
  };
}

/**
 * Bootstrap a 95% confidence interval for the median. Draws
 * `resamples` resampled-with-replacement arrays of size `samples.length`,
 * computes the median of each, returns the [2.5th, 97.5th] percentiles
 * of those bootstrap medians. Non-seeded — use a fixed seed via the
 * runner if reproducibility is required.
 */
export function bootstrapMedianCi95(
  samples: number[],
  resamples = 1000,
): [number, number] {
  if (samples.length === 0) throw new Error('[stats] empty samples');
  if (samples.length === 1) return [samples[0]!, samples[0]!];
  const medians: number[] = new Array(resamples);
  const n = samples.length;
  for (let r = 0; r < resamples; r++) {
    const draw: number[] = new Array(n);
    for (let i = 0; i < n; i++) draw[i] = samples[Math.floor(Math.random() * n)]!;
    medians[r] = percentile(draw, 50);
  }
  return [percentile(medians, 2.5), percentile(medians, 97.5)];
}

/**
 * Full SampleStats from a raw samples array. Trims 5% from each end
 * for the mean / stddev (medians are intrinsically robust). CI95 is
 * computed on the trimmed sample set for consistency with the headline
 * median.
 */
export function computeStats(samples: number[]): SampleStats {
  if (samples.length === 0) throw new Error('[stats] empty samples');
  const { sorted, trimmedCount } = trimOutliers(samples, 0.05);
  const n = sorted.length;
  const median = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance =
    n > 1 ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const stddev = Math.sqrt(variance);
  const ci95 = bootstrapMedianCi95(sorted, 1000);
  return { median, p95, mean, stddev, ci95, n, trimmedCount };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run bench/harness/stats.test.ts`
Expected: 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bench/harness/stats.ts bench/harness/stats.test.ts
git commit -m "$(cat <<'EOF'
bench(harness): stats library — median, P95, bootstrap CI95, outlier trim

Pure functions over number[] samples. Bootstrap CI95 resamples with
replacement 1000 times, takes the [2.5%, 97.5%] percentiles of the
resampled medians. Light 5% outlier trim feeds mean / stddev / CI95
(medians are robust either way).

Phase A foundation — every other harness module depends on this.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Environment snapshot

**Files:**
- Create: `bench/harness/env.ts`
- Create: `bench/harness/env.test.ts`

`env.ts` captures the running environment so JSON reports are reproducible. Pure data collection — no measurement, no side effects beyond reading from `process` / `os` / `child_process`.

- [ ] **Step 1: Write the failing tests**

Create `bench/harness/env.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { snapshotEnv } from './env.js';

describe('snapshotEnv', () => {
  test('returns an object with the documented shape', () => {
    const env = snapshotEnv();
    expect(env.node).toMatch(/^v\d+\.\d+/);
    expect(typeof env.platform).toBe('string');
    expect(typeof env.arch).toBe('string');
    expect(env.platformId).toBe(`${env.platform}-${env.arch}`);
    expect(typeof env.cpu.model).toBe('string');
    expect(env.cpu.cores).toBeGreaterThan(0);
    expect(typeof env.os).toBe('string');
    expect(typeof env.git.sha).toBe('string');
    expect(env.git.sha.length).toBeGreaterThanOrEqual(7);
    expect(typeof env.git.branch).toBe('string');
    expect(typeof env.git.dirty).toBe('boolean');
    expect(env.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
    expect(typeof env.packages).toBe('object');
  });

  test('captures @pilates/core version from its package.json', () => {
    const env = snapshotEnv();
    expect(env.packages['@pilates/core']).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('platformId is stable across calls', () => {
    expect(snapshotEnv().platformId).toBe(snapshotEnv().platformId);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run bench/harness/env.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement env.ts**

Create `bench/harness/env.ts`:

```ts
/**
 * Environment snapshot for bench reproducibility. Captures the
 * data that varies across bench-machine, time, and code revision —
 * everything else (scenario shapes, harness behaviour) is determined
 * by the source tree.
 *
 * @internal
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export interface EnvSnapshot {
  /** Node.js version, e.g. "v22.21.0". */
  node: string;
  /** `process.platform`, e.g. "darwin" / "linux" / "win32". */
  platform: string;
  /** `process.arch`, e.g. "arm64" / "x64". */
  arch: string;
  /** Combination `${platform}-${arch}` — keys thresholds.json + history. */
  platformId: string;
  /** CPU model + logical core count. */
  cpu: { model: string; cores: number };
  /** OS release string from `os.release()`. */
  os: string;
  /** Git position: HEAD SHA (full), branch, and dirty-flag. */
  git: { sha: string; branch: string; dirty: boolean };
  /** ISO 8601 UTC timestamp of the snapshot. */
  timestamp: string;
  /** Workspace package versions, keyed by package name. */
  packages: Record<string, string>;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function readPackageVersion(pkgRelPath: string): string | undefined {
  try {
    const json = JSON.parse(
      readFileSync(resolve(REPO_ROOT, pkgRelPath, 'package.json'), 'utf8'),
    ) as { name: string; version: string };
    return json.version;
  } catch {
    return undefined;
  }
}

export function snapshotEnv(): EnvSnapshot {
  const cpuList = cpus();
  const packages: Record<string, string> = {};
  for (const pkg of ['core', 'render', 'diff', 'react', 'widgets']) {
    const v = readPackageVersion(`packages/${pkg}`);
    if (v !== undefined) packages[`@pilates/${pkg}`] = v;
  }
  const sha = git('rev-parse HEAD');
  const branch = git('rev-parse --abbrev-ref HEAD');
  const dirty = git('status --porcelain').length > 0;
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    platformId: `${process.platform}-${process.arch}`,
    cpu: {
      model: cpuList[0]?.model ?? 'unknown',
      cores: cpuList.length,
    },
    os: release(),
    git: { sha, branch, dirty },
    timestamp: new Date().toISOString(),
    packages,
  };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run bench/harness/env.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bench/harness/env.ts bench/harness/env.test.ts
git commit -m "$(cat <<'EOF'
bench(harness): env snapshot — Node / OS / CPU / git / packages

Captures the environment data that varies across bench-machine, time,
and code revision. `platformId` is the combination key used by
thresholds.json + bench/history/<sha>.json.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Runner — orchestrates per-scenario tinybench, computes stats

**Files:**
- Create: `bench/harness/runner.ts`
- Create: `bench/harness/runner.test.ts`

The runner wraps tinybench's `Bench` to capture per-iteration samples, then post-processes them with `computeStats`. The scenario interface is identical to today's (functions that take no args and run one iteration of work) — this preserves the existing `bench/scenarios/*.ts` files untouched.

- [ ] **Step 1: Write the failing tests**

Create `bench/harness/runner.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run bench/harness/runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement runner.ts**

Create `bench/harness/runner.ts`:

```ts
/**
 * Bench runner: takes a list of scenarios, runs each engine via
 * tinybench (preserving warmup + measurement semantics), captures
 * raw per-iteration samples, and produces SampleStats per engine.
 *
 * @internal
 */

import { Bench } from 'tinybench';
import { type SampleStats, computeStats } from './stats.js';

/** A scenario — name, prose, and a record of engine-function bindings. */
export interface Scenario {
  name: string;
  notes: string;
  engines: Record<string, () => void>;
}

export interface EngineResult {
  name: string;
  /** Raw per-iteration timings, in nanoseconds. */
  samples: number[];
  stats: SampleStats;
}

export interface ScenarioResult {
  name: string;
  notes: string;
  engines: EngineResult[];
}

export interface RunOptions {
  scenarios: Scenario[];
  /** Warmup duration in milliseconds per engine. Default 500ms. */
  warmupMs?: number;
  /** Measurement duration in milliseconds per engine. Default 5000ms. */
  measureMs?: number;
  /** Progress callback — called once per scenario start. */
  onScenarioStart?: (name: string) => void;
}

export async function runScenarios(opts: RunOptions): Promise<ScenarioResult[]> {
  const warmupMs = opts.warmupMs ?? 500;
  const measureMs = opts.measureMs ?? 5000;
  const out: ScenarioResult[] = [];
  for (const scenario of opts.scenarios) {
    opts.onScenarioStart?.(scenario.name);
    const bench = new Bench({ time: measureMs, warmupTime: warmupMs, warmup: true });
    for (const [name, fn] of Object.entries(scenario.engines)) {
      bench.add(name, fn);
    }
    await bench.run();
    const engines: EngineResult[] = [];
    for (const task of bench.tasks) {
      const r = task.result;
      if (!r || r.state !== 'completed') continue;
      // tinybench stores samples in milliseconds; convert to nanoseconds
      // for consistency with how the rest of the harness reports.
      const samples = (r.latency.samples ?? []).map((ms) => ms * 1_000_000);
      if (samples.length === 0) continue;
      engines.push({ name: task.name, samples, stats: computeStats(samples) });
    }
    out.push({ name: scenario.name, notes: scenario.notes, engines });
  }
  return out;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run bench/harness/runner.test.ts`
Expected: 2 tests pass. (Note: tests deliberately use short warmup / measure times so they run quickly.)

- [ ] **Step 5: Commit**

```bash
git add bench/harness/runner.ts bench/harness/runner.test.ts
git commit -m "$(cat <<'EOF'
bench(harness): runner — multi-run measurement with bootstrap CI95

Wraps tinybench's Bench, captures per-iteration samples, post-processes
them with computeStats. Scenario shape (name + notes + engines record)
is the same conceptual shape the current bench/scenarios/*.ts files
already export — they migrate in Task 6 without semantic change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: JSON reporter — `bench/history/<sha>.json`

**Files:**
- Create: `bench/harness/reporter-json.ts`
- Create: `bench/harness/reporter-json.test.ts`

JSON output is the machine-parseable record of one bench run. Phase A writes it; Phase E (the dashboard) reads it.

- [ ] **Step 1: Write the failing tests**

Create `bench/harness/reporter-json.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run bench/harness/reporter-json.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement reporter-json.ts**

Create `bench/harness/reporter-json.ts`:

```ts
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
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run bench/harness/reporter-json.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bench/harness/reporter-json.ts bench/harness/reporter-json.test.ts
git commit -m "$(cat <<'EOF'
bench(harness): JSON reporter

Writes one BenchRunReport per run to bench/history/<sha>.json.
Schema is the EnvSnapshot + ScenarioResult[] shapes from earlier
harness modules. Used by check-budgets (Task 9) and the Phase E
dashboard (future).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Markdown reporter — refined RESULTS.md

**Files:**
- Create: `bench/harness/reporter-markdown.ts`

The Markdown reporter takes the same `BenchRunReport` and produces `bench/RESULTS.md`. The output format matches today's RESULTS.md closely (same scenario sections, same Yoga / Pilates column structure) but adds the new stats: each engine row shows `median ± CI95 width` and a `(P95)` column. The prose sections at the bottom are preserved.

This task is mostly a CODE MOVE from `bench/index.ts` into a focused module, with the table rendering upgraded.

- [ ] **Step 1: Implement reporter-markdown.ts**

Create `bench/harness/reporter-markdown.ts`:

```ts
/**
 * Markdown reporter for one bench run. Produces a RESULTS.md-shaped
 * output: scenario-by-scenario tables with the new statistics
 * (median, P95, CI95 width) plus the prose sections this repo's
 * RESULTS.md has historically carried.
 *
 * @internal
 */

import { writeFileSync } from 'node:fs';
import type { BenchRunReport } from './reporter-json.js';
import type { EngineResult, ScenarioResult } from './runner.js';

function fmtNs(ns: number): string {
  if (ns < 1_000) return `${ns.toFixed(0)}ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)}µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)}ms`;
  return `${(ns / 1_000_000_000).toFixed(2)}s`;
}

function fmtHz(ns: number): string {
  if (ns <= 0) return '—';
  const hz = 1e9 / ns;
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)}M ops/s`;
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(1)}k ops/s`;
  return `${hz.toFixed(0)} ops/s`;
}

function fmtCi95(ci95: [number, number], median: number): string {
  // Report the CI95 width as ±max(median−lo, hi−median) for readability.
  const halfWidth = Math.max(median - ci95[0], ci95[1] - median);
  return `±${fmtNs(halfWidth)}`;
}

function renderScenario(s: ScenarioResult): string[] {
  const out: string[] = [];
  out.push(`## ${s.name}`);
  out.push('');
  out.push(`> ${s.notes}`);
  out.push('');
  out.push('| Engine | Median | CI95 | P95 | Throughput |');
  out.push('|---|---:|---:|---:|---:|');
  for (const e of s.engines) {
    out.push(
      `| ${e.name} | ${fmtNs(e.stats.median)} | ${fmtCi95(e.stats.ci95, e.stats.median)} | ${fmtNs(e.stats.p95)} | ${fmtHz(e.stats.median)} |`,
    );
  }
  out.push('');
  return out;
}

export function writeMarkdownReport(report: BenchRunReport, outPath: string): void {
  const lines: string[] = [];
  lines.push('# Pilates benchmark results');
  lines.push('');
  lines.push(
    `Generated: ${report.env.timestamp.slice(0, 10)} · Node ${report.env.node} · ${report.env.platformId}`,
  );
  lines.push('');
  lines.push(
    `Reproduce: \`pnpm bench\`. Numbers vary by machine — relative positions are the interesting signal. \`Median\` is reported alongside its bootstrap CI95 (median ± max half-width) over a ~5-second measurement window.`,
  );
  lines.push('');
  lines.push('## Scenarios');
  lines.push('');
  lines.push('| Scenario | Tree shape |');
  lines.push('|---|---|');
  for (const s of report.scenarios) {
    lines.push(`| **${s.name}** | ${s.notes} |`);
  }
  lines.push('');
  for (const s of report.scenarios) {
    for (const line of renderScenario(s)) lines.push(line);
  }
  // Prose sections — preserved from the pre-overhaul RESULTS.md so
  // the document tells the same story about Pilates' workload coverage.
  lines.push(`## What's measured`);
  lines.push('');
  lines.push('Each iteration **runs one layout pass**. Persistent-tree');
  lines.push('scenarios (`hot*`) build the tree once before warmup; the');
  lines.push('measured iteration mutates and re-lays out. Throwaway-tree');
  lines.push('scenarios (`tiny`, `realistic`, `stress`, `big`, `huge`)');
  lines.push('build a fresh tree in the iteration and lay it out.');
  lines.push('');
  lines.push('Statistics: median, CI95 (bootstrap, 1000 resamples, ±2.5%');
  lines.push('to 97.5% percentiles of resampled medians), P95, throughput');
  lines.push('(1/median). Light 5% outlier trim feeds derived stats; raw');
  lines.push('samples are preserved in `bench/history/<sha>.json`.');
  writeFileSync(outPath, `${lines.join('\n')}\n`);
}
```

- [ ] **Step 2: Inline sanity check**

Run: `npx tsx --eval "import('./bench/harness/reporter-markdown.js').then((m) => console.log(typeof m.writeMarkdownReport))"`
Expected: prints `function`.

(There's no dedicated test file because the unit test surface is essentially "produces a string in the right shape" — Task 6's end-to-end integration validates it via running the full pipeline.)

- [ ] **Step 3: Commit**

```bash
git add bench/harness/reporter-markdown.ts
git commit -m "$(cat <<'EOF'
bench(harness): Markdown reporter — RESULTS.md with median + CI95 + P95

Shapes BenchRunReport into the RESULTS.md format. Median is the
headline column; CI95 width (±max half-width) sits beside it; P95
and throughput close the row. Preserves the prose sections from
the pre-overhaul RESULTS.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Refactor `bench/index.ts` — subcommand dispatch, wire to harness

**Files:**
- Modify: `bench/index.ts` (replace body — keep scenarios import list)
- Modify: `package.json` (add `bench:variance` script)

Refactor `bench/index.ts` to be a thin orchestrator using the new harness. The default `pnpm bench` produces both the Markdown and JSON outputs. The variance subcommand is added here too (it's a small variant of the default flow).

- [ ] **Step 1: Add the `bench:variance` script to `package.json`**

In the root `package.json` `"scripts"` block, add after `"bench"`:

```json
    "bench:variance": "pnpm build && tsx bench/index.ts --variance",
```

(Keep `"bench": "pnpm build && tsx bench/index.ts"` as today; the script dispatches based on argv.)

- [ ] **Step 2: Rewrite `bench/index.ts`**

The new `bench/index.ts` body:

```ts
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
import { type Scenario, type ScenarioResult, runScenarios } from './harness/runner.js';
import * as big from './scenarios/big.js';
import * as hotRelayoutBoundary from './scenarios/hot-relayout-boundary.js';
import * as hotRelayoutText from './scenarios/hot-relayout-text.js';
import * as hotRelayout from './scenarios/hot-relayout.js';
import * as hotStructural from './scenarios/hot-structural.js';
import * as huge from './scenarios/huge.js';
import * as realistic from './scenarios/realistic.js';
import * as stress from './scenarios/stress.js';
import * as tiny from './scenarios/tiny.js';
import { computeStats } from './harness/stats.js';

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
```

- [ ] **Step 3: Run the default bench end-to-end**

Run: `pnpm bench`
Expected: 9 scenarios bench; writes both `bench/RESULTS.md` and `bench/history/<sha>.json` with new shape. The Markdown's tables have `Median | CI95 | P95 | Throughput` columns.

Manually inspect `bench/RESULTS.md` — every scenario section is present, numbers are sensible, the CI95 widths are not absurd (single-digit % of median is normal).

- [ ] **Step 4: Run the variance subcommand**

Run: `pnpm bench:variance`
Expected: writes `bench/VARIANCE.md`. Takes ~3-5 minutes (20 passes × ~10s each). The output has one row per `(scenario, engine)` with "Median of medians" and "CI95 of medians" — these are the values that will populate the new `thresholds.json` in Task 8.

- [ ] **Step 5: Commit**

```bash
git add bench/index.ts package.json
git commit -m "$(cat <<'EOF'
bench: refactor index.ts to use harness library; add bench:variance

bench/index.ts is now a thin orchestrator. Default `pnpm bench`
writes both RESULTS.md (refined Markdown with median + CI95 + P95)
AND bench/history/<sha>.json (machine-parseable). New subcommand
`pnpm bench:variance` runs each scenario 20 times and reports the
distribution of medians — used to calibrate per-platform thresholds.

All 9 existing scenarios run unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Calibrate `thresholds.json` — populate per-platform expectations

**Files:**
- Modify: `bench/thresholds.json` (replace structure)

Use the `bench/VARIANCE.md` output from Task 6 Step 4 to populate the new per-platform thresholds. Phase A populates ONE platform (the runner's current). Subsequent CI runs on macOS / Linux extend the file when their numbers are first measured.

- [ ] **Step 1: Read `bench/VARIANCE.md`**

Open `bench/VARIANCE.md` from Task 6's variance run. Note the `Median of medians` value and the `CI95 of medians` interval for each `(scenario, engine)` pair where `engine === '@pilates/core (layout)'`. These are the values we need.

- [ ] **Step 2: Rewrite `bench/thresholds.json`**

Replace the existing `bench/thresholds.json` content with:

```json
{
  "tiny": {
    "@pilates/core (layout)": {
      "<platformId>": { "expectedMedianUs": <medianFromVariance>, "ci95Us": [<lo>, <hi>] }
    }
  },
  "realistic": {
    "@pilates/core (layout)": {
      "<platformId>": { "expectedMedianUs": <medianFromVariance>, "ci95Us": [<lo>, <hi>] }
    }
  },
  "stress": { "@pilates/core (layout)": { "<platformId>": { "expectedMedianUs": <m>, "ci95Us": [<lo>, <hi>] } } },
  "big": { "@pilates/core (layout)": { "<platformId>": { "expectedMedianUs": <m>, "ci95Us": [<lo>, <hi>] } } },
  "huge": { "@pilates/core (layout)": { "<platformId>": { "expectedMedianUs": <m>, "ci95Us": [<lo>, <hi>] } } },
  "hotrelayout": { "@pilates/core (layout)": { "<platformId>": { "expectedMedianUs": <m>, "ci95Us": [<lo>, <hi>] } } },
  "hotrelayoutboundary": { "@pilates/core (layout)": { "<platformId>": { "expectedMedianUs": <m>, "ci95Us": [<lo>, <hi>] } } },
  "hotrelayouttext": {
    "@pilates/core (layout)": { "<platformId>": { "expectedMedianUs": <m>, "ci95Us": [<lo>, <hi>] } },
    "@pilates/core (spineless)": { "<platformId>": { "expectedMedianUs": <m>, "ci95Us": [<lo>, <hi>] } }
  },
  "hotstructural": { "@pilates/core (layout)": { "<platformId>": { "expectedMedianUs": <m>, "ci95Us": [<lo>, <hi>] } } }
}
```

Replace each `<platformId>` with the actual platform string from `env.platformId` (e.g. `win32-x64`, `darwin-arm64`, `linux-x64`). Each `<m>` / `<lo>` / `<hi>` is the corresponding number from VARIANCE.md, in microseconds (the `runner` emits nanoseconds in the JSON; VARIANCE.md already formatted as µs, so use that directly).

Implementer: **don't fabricate numbers**. If a scenario's measured CI95 width is so tiny it can't be true (e.g. CI95 width < 1µs on a 100µs median), bump the upper bound by a sane minimum (e.g. 10% of the median) — note it inline with a comment-less JSON value adjusted upward. This guards against false-positive regression triggers on benign noise.

For thresholds the bench is already enforcing today (`hotstructural: 1.0ms` was the budget post-phase-13), preserve them as a sanity ceiling — even after migration, no scenario's `expectedMedianUs` should exceed the pre-overhaul threshold's value.

- [ ] **Step 3: Validate the JSON parses**

Run: `node -e "JSON.parse(require('node:fs').readFileSync('bench/thresholds.json', 'utf8'))" && echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add bench/thresholds.json
git commit -m "$(cat <<'EOF'
bench: migrate thresholds.json to per-platform CI95-based structure

Populated from one pass of `pnpm bench:variance` on the
implementer's local machine. Other platforms (CI ubuntu, macOS)
extend this file when their first runs land; absence of a platform
entry means "no expectation set yet" rather than a budget violation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Rewrite `check-budgets.ts` — CI95-based regression detection

**Files:**
- Modify: `bench/check-budgets.ts` (replace body)
- Create: `bench/check-budgets.test.ts`

The new check-budgets loads the current run's JSON (most recent file in `bench/history/`) and compares each `(scenario, engine)` pair against its expected entry in `thresholds.json` for the current platform. A regression is flagged if the current CI95 *lower* bound exceeds the threshold's CI95 *upper* bound × 1.10 (the 10% headroom over statistical separation). Missing thresholds (e.g. a platform that hasn't been calibrated yet) emit a warning but don't fail.

- [ ] **Step 1: Write the failing tests**

Create `bench/check-budgets.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run bench/check-budgets.test.ts`
Expected: FAIL — `evaluateBudgets` doesn't exist yet.

- [ ] **Step 3: Implement the new `check-budgets.ts`**

Replace the body of `bench/check-budgets.ts` with:

```ts
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

const HEADROOM = 1.10; // 10% above threshold upper before regression fails

function loadReport(): BenchRunReport {
  const historyDir = resolve(BENCH_DIR, 'history');
  const files = readdirSync(historyDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error(
      `[check-budgets] no history files in ${historyDir}; run \`pnpm bench\` first`,
    );
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
      const observedCi95Us: [number, number] = [
        e.stats.ci95[0] / 1000,
        e.stats.ci95[1] / 1000,
      ];
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
  process.stderr.write(`checked ${result.checked} (scenario, engine) pairs on ${report.env.platformId}\n`);
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
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run bench/check-budgets.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Run the actual budget check against the run from Task 6**

Run: `pnpm -w run bench:budgets`
Expected: prints "all bench budgets within threshold" (because thresholds were just calibrated from the same machine in Task 7). If any regression appears, the calibration in Task 7 was wrong — revisit and bump the CI95 upper bounds.

- [ ] **Step 6: Commit**

```bash
git add bench/check-budgets.ts bench/check-budgets.test.ts
git commit -m "$(cat <<'EOF'
bench: rewrite check-budgets.ts for CI95-based regression detection

Loads the latest bench/history/<sha>.json, compares each
(scenario, engine) CI95 to the platform-specific threshold in
thresholds.json. Regression = observed CI95 lower > threshold CI95
upper × 1.10. Missing platform = warning, not failure.

Catches ≥10% regressions; previous threshold mechanism only caught
hard ceiling violations (≥5× in practice).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: CI workflow — upload `bench/history/<sha>.json` as artifact

**Files:**
- Modify: `.github/workflows/perf-budgets.yml`

The bench CI job already runs `pnpm bench` and `pnpm bench:budgets`. We add an artifact upload step so the per-platform JSON output is captured on every push to main.

- [ ] **Step 1: Modify `.github/workflows/perf-budgets.yml`**

Find the existing step `- name: Upload RESULTS.md` and add a follow-up step:

```yaml
      - name: Upload RESULTS.md
        uses: actions/upload-artifact@v5
        with:
          name: bench-results
          path: bench/RESULTS.md

      - name: Upload bench history JSON (push-to-main only)
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        uses: actions/upload-artifact@v5
        with:
          name: bench-history-${{ github.sha }}
          path: bench/history/*.json
          retention-days: 90
```

The `if` predicate scopes the upload to push-to-main only — PRs don't pollute artifact storage with provisional bench runs.

- [ ] **Step 2: Validate the YAML parses**

Run: `node -e "require('node:fs').readFileSync('.github/workflows/perf-budgets.yml', 'utf8'); console.log('readable')"`
Expected: `readable`.

(Full YAML validation happens when CI runs; this is a sanity gate.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/perf-budgets.yml
git commit -m "$(cat <<'EOF'
ci(bench): upload bench/history/<sha>.json artifact on push to main

The per-platform JSON output is now captured for each main-branch
push as a 90-day artifact. Phase E's history dashboard will consume
these; for Phase A they're a forensic record.

PR runs don't upload — they keep the artifact-store clean.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Wire up `bench/history/` directory + .gitignore

**Files:**
- Create: `bench/history/.gitkeep`
- Modify: `.gitignore`

The runner writes `bench/history/<sha>.json` on every `pnpm bench`. Locally these would accumulate; in CI they're transient. Ignore them in git but keep the directory tracked.

- [ ] **Step 1: Create the gitkeep**

Create `bench/history/.gitkeep` (empty file).

- [ ] **Step 2: Add the ignore entry to `.gitignore`**

In `.gitignore`, after the existing `coverage/` line, add:

```
bench/history/*.json
!bench/history/.gitkeep
```

- [ ] **Step 3: Validate state**

Run: `git status`
Expected: `bench/history/.gitkeep` shows as a new file, `.gitignore` shows as modified. Any `bench/history/*.json` files from earlier runs do NOT show as untracked.

- [ ] **Step 4: Commit**

```bash
git add bench/history/.gitkeep .gitignore
git commit -m "$(cat <<'EOF'
bench: track bench/history/ via .gitkeep, ignore the JSON outputs

Local runs of `pnpm bench` write JSON to bench/history/<sha>.json.
Those are transient; only CI artifacts (Task 9) preserve them
across machines. Keep the directory tracked for the test files
that reference it, but ignore its JSON contents.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Wire up vitest config + final validation gate

**Files:**
- Modify: `vitest.config.ts` (add bench/harness to test includes)

The harness unit tests need to run under `pnpm test`. The current vitest include patterns cover `packages/*/src/` and `packages/*/test/` and `e2e/`. Add the bench harness tests.

- [ ] **Step 1: Modify `vitest.config.ts`**

In the `test.include` array, add `'bench/**/*.test.{ts,tsx}'`:

```ts
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'packages/*/test/**/*.test.{ts,tsx}',
      'e2e/**/*.test.{ts,tsx}',
      'bench/**/*.test.{ts,tsx}',
    ],
```

Also, in the `coverage.exclude` array, add `'bench/**'` so bench harness code doesn't drag the coverage threshold down:

```ts
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.bench.{ts,tsx}',
        '**/tables.ts',
        'packages/*/src/index.ts',
        'packages/*/src/types.ts',
        'packages/*/src/**/types.ts',
        'packages/react/src/reconciler.ts',
        'bench/**',
      ],
```

- [ ] **Step 2: Run the full workspace test suite**

Run: `pnpm test`
Expected: all existing tests pass + the bench harness's 22 new tests pass (12 in stats.test, 3 in env.test, 2 in runner.test, 2 in reporter-json.test, 5 in check-budgets.test).

- [ ] **Step 3: Run typecheck workspace-wide**

Run: `pnpm typecheck`
Expected: clean across all 6 packages. (The harness sits in `bench/` — outside the package boundaries — but `tsx` invokes it directly, so we don't need a `tsconfig.json` change for it.)

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: clean. If Biome flags any line-length / format issue in the new files, fix with `npx biome check --write <path>`.

- [ ] **Step 5: Run `pnpm bench:variance` THREE times in succession**

Run: `pnpm bench:variance && cp bench/VARIANCE.md /tmp/v1.md && pnpm bench:variance && cp bench/VARIANCE.md /tmp/v2.md && pnpm bench:variance && cp bench/VARIANCE.md /tmp/v3.md`

This is the reproducibility validation: for each `(scenario, engine)`, the CI95 reported by run #1 should CONTAIN the medians from runs #2 and #3.

- [ ] **Step 6: Validate reproducibility**

Spot-check: pick three scenarios at random, compare `v1.md`'s CI95 to `v2.md`'s and `v3.md`'s medians. If any median falls outside the CI95, the CI95 calibration is suspect — investigate (likely cause: insufficient bootstrap iterations, too few samples per run, or genuine non-stationarity in the bench machine).

If reproducibility holds: phase A's success criterion is met. The bench numbers are statistically robust.

- [ ] **Step 7: Final commit**

```bash
git add vitest.config.ts
git commit -m "$(cat <<'EOF'
bench: include bench/**/*.test.ts in vitest; exclude bench/** from coverage

The harness's 22 unit tests now run under `pnpm test`. Coverage
thresholds remain unchanged (bench/ is not consumer code).

Reproducibility validated: three sequential `pnpm bench:variance`
runs produce CI95 intervals that contain each other's medians.
Phase A success criterion met.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- `bench/harness/runner.ts` (multi-run loop, sample collection, stats integration) — Task 3. ✓
- `bench/harness/stats.ts` (bootstrap CI95, median, P95, outlier trim) — Task 1. ✓
- `bench/harness/env.ts` (Node ver, OS, arch, CPU model, git SHA, timestamp, package versions) — Task 2. ✓
- `bench/harness/reporter-json.ts` (machine-parseable output to `bench/history/<sha>.json`) — Task 4. ✓
- `bench/harness/reporter-markdown.ts` (refined Markdown using new stats) — Task 5. ✓
- `pnpm bench:variance` subcommand — Task 6 Step 1 (script) + Step 4 (subcommand logic). ✓
- `check-budgets.ts` rewritten for CI95-based regression detection (10% headroom) — Task 8. ✓
- `thresholds.json` migrated to per-platform expectations — Task 7. ✓
- CI workflow change so the bench job stashes `history/<sha>.json` — Task 9. ✓
- Keep all 9 existing scenarios passing — Task 6 buildScenario() preserves the scenario module interface; the scenarios themselves are not modified. ✓
- Validation: `pnpm bench:variance` reports per-scenario distributions whose CI95 contains all observed medians from a 3-run sanity check — Task 11 Steps 5–6. ✓
- Single branch (`phase-a-bench-methodology`), single PR — assumed by the workflow note. ✓
- Final result preserves the perf budgets that locked in phase 12+13 wins — Task 7 calls this out ("no scenario's expectedMedianUs should exceed the pre-overhaul threshold's value"). ✓

**Placeholder scan:**
- Task 7 uses `<platformId>` and `<m>` / `<lo>` / `<hi>` placeholders in the JSON structure — but these are *intentional templates* the implementer fills with measured values from Task 6's VARIANCE.md. Task 7 Step 2 explicitly directs "don't fabricate numbers" and explains where each value comes from. This is the only honest way to write this step — the calibration depends on runtime measurement.
- No "TBD" / "TODO" / "handle edge cases" / "similar to Task N" anywhere else. All code blocks are complete.

**Type consistency:**
- `SampleStats` shape is defined once (Task 1) and consumed by tasks 3, 4, 5, 8. Fields used: `median`, `p95`, `mean`, `stddev`, `ci95`, `n`, `trimmedCount` — all referenced consistently.
- `EnvSnapshot` shape defined in Task 2, used by Tasks 4, 5, 8. The `platformId` field is the key into `thresholds.json` per Task 7. Consistent.
- `EngineResult` / `ScenarioResult` / `BenchRunReport` shapes defined in Tasks 3, 4. Consumed identically by Tasks 5, 8. Consistent.
- `Thresholds` shape in Task 8 matches the JSON structure in Task 7 (3-level nested record: scenario → engine → platformId → ThresholdEntry).
- `evaluateBudgets` separated from CLI `main()` — testable in isolation (Task 8 tests use `evaluateBudgets` directly). ✓
- The `bench:variance` subcommand uses `measureMs: 1500` per pass (Task 6 Step 4) — 20 × 1.5s ≈ 30s of measurement + warmup overhead = ~3-5 minutes total. The plan's Step 4 note about "~3-5 minutes" is consistent.

No gaps found. Plan is complete and consistent.
