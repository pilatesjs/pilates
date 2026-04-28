/**
 * Binary search over a flat range table of the shape:
 *   [start0, end0, start1, end1, ...]
 * where each [start, end] is inclusive. Returns true if `cp` falls in any range.
 */
export function inRanges(cp: number, ranges: readonly number[]): boolean {
  let lo = 0;
  let hi = ranges.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const start = ranges[mid * 2]!;
    const end = ranges[mid * 2 + 1]!;
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return true;
  }
  return false;
}
