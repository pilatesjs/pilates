/**
 * Layout devtools for `@pilates/react` — the first consumer of the
 * phase-9 `@pilates/core` observability API (`setLayoutProfiler`).
 *
 * `useLayoutProfiler()` is the data primitive; `<LayoutDevtools>` is a
 * ready-made overlay built on it. `sparkline` is the pure block-glyph
 * helper the panel renders its recent-cost row with.
 */

/** Block glyphs, lowest to highest, for `sparkline`. */
const SPARK_GLYPHS = '▁▂▃▄▅▆▇█';

/**
 * Map a series of non-negative numbers to a sparkline string — one
 * block glyph per value, scaled to the series maximum. An empty
 * series yields `''`; an all-zero series yields all-lowest glyphs.
 */
export function sparkline(values: readonly number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values);
  if (max === 0) return SPARK_GLYPHS[0]!.repeat(values.length);
  const last = SPARK_GLYPHS.length - 1;
  return values
    .map((v) => SPARK_GLYPHS[Math.min(last, Math.max(0, Math.round((v / max) * last)))]!)
    .join('');
}
