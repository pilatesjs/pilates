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

/**
 * Maximum number of samples to retain and pass to computeStats.
 * tinybench can collect millions of samples for fast sync functions;
 * bootstrap CI over millions is O(n) per resample × 1000 resamples
 * and becomes impractically slow. We downsample to this cap using
 * systematic (stride) sampling to preserve the distribution shape.
 */
const MAX_STATS_SAMPLES = 10_000;

/**
 * Downsample `arr` to at most `max` elements using a uniform stride.
 * If `arr.length <= max`, returns a copy without modification.
 */
function downsample(arr: number[], max: number): number[] {
  if (arr.length <= max) return arr.slice();
  const stride = arr.length / max;
  const out: number[] = new Array(max);
  for (let i = 0; i < max; i++) {
    out[i] = arr[Math.round(i * stride)]!;
  }
  return out;
}

export async function runScenarios(opts: RunOptions): Promise<ScenarioResult[]> {
  const warmupMs = opts.warmupMs ?? 500;
  const measureMs = opts.measureMs ?? 5000;
  const out: ScenarioResult[] = [];
  for (const scenario of opts.scenarios) {
    opts.onScenarioStart?.(scenario.name);
    const bench = new Bench({
      time: measureMs,
      warmupTime: warmupMs,
      warmup: true,
      retainSamples: true,
      // Use hrtime for nanosecond precision. performance.now() on Windows
      // has ~1 ms resolution, which floors fast-function samples to 0.
      timestampProvider: 'hrtimeNow',
    });
    for (const [name, fn] of Object.entries(scenario.engines)) {
      bench.add(name, fn);
    }
    bench.runSync();
    const engines: EngineResult[] = [];
    for (const task of bench.tasks) {
      const r = task.result;
      if (!r || r.state !== 'completed') continue;
      // tinybench stores samples in milliseconds; convert to nanoseconds
      // for consistency with how the rest of the harness reports.
      const rawSamples = (r.latency.samples ?? []).map((ms) => ms * 1_000_000);
      if (rawSamples.length === 0) continue;
      // Downsample before computing stats to keep bootstrap CI tractable.
      // The full rawSamples array is stored verbatim so callers can
      // perform their own analysis if needed.
      const statSamples = downsample(rawSamples, MAX_STATS_SAMPLES);
      engines.push({ name: task.name, samples: rawSamples, stats: computeStats(statSamples) });
    }
    out.push({ name: scenario.name, notes: scenario.notes, engines });
  }
  return out;
}
