import { describe, expect, it } from 'vitest';
import { sparkline } from './layout-devtools.js';

describe('sparkline', () => {
  it('returns an empty string for an empty series', () => {
    expect(sparkline([])).toBe('');
  });

  it('returns all-low glyphs for an all-zero series', () => {
    expect(sparkline([0, 0, 0])).toBe('▁▁▁');
  });

  it('scales values to block glyphs against the series max', () => {
    // max 8 → 0 maps to the lowest glyph, 8 to the highest.
    expect(sparkline([0, 8])).toBe('▁█');
  });

  it('emits exactly one glyph per value', () => {
    expect(sparkline([1, 2, 3, 4, 5])).toHaveLength(5);
  });
});
