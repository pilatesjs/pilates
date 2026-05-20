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
