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
export function bootstrapMedianCi95(samples: number[], resamples = 1000): [number, number] {
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
  const variance = n > 1 ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const stddev = Math.sqrt(variance);
  const ci95 = bootstrapMedianCi95(sorted, 1000);
  return { median, p95, mean, stddev, ci95, n, trimmedCount };
}
