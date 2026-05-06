/**
 * Suggest the closest match from `candidates` to `input`, or undefined if
 * none is close enough. Heuristic ported from TypeScript's
 * `getSpellingSuggestionForName` (src/compiler/checker.ts):
 *
 *   - n < 3:      only a case-insensitive exact match counts
 *   - maxLenDiff: min(2, floor(0.34 * n))   reject candidates too far in length
 *   - maxDist:    floor(0.4 * n) + 1        max edit distance accepted
 *
 * Comparison is case-insensitive.
 */
export function didYouMean(input: string, candidates: readonly string[]): string | undefined {
  if (input.length === 0) return undefined;
  if (input.length < 3) {
    const lower = input.toLowerCase();
    return candidates.find((c) => c.toLowerCase() === lower);
  }
  const n = input.length;
  const maxLenDiff = Math.min(2, Math.floor(n * 0.34));
  const maxDist = Math.floor(n * 0.4) + 1;
  let bestDist = Number.POSITIVE_INFINITY;
  let best: string | undefined;
  const lowered = input.toLowerCase();
  for (const c of candidates) {
    if (Math.abs(c.length - n) > maxLenDiff) continue;
    const d = levenshtein(lowered, c.toLowerCase());
    if (d <= maxDist && d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = new Array(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const left = curr[j - 1] as number;
      const up = prev[j] as number;
      const diag = prev[j - 1] as number;
      curr[j] = Math.min(left + 1, up + 1, diag + cost);
    }
    prev = curr;
  }
  return prev[n] as number;
}
