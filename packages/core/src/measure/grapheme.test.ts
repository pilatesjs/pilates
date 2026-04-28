import { describe, expect, it } from 'vitest';
import { graphemes } from './grapheme.js';

function clusters(s: string): string[] {
  return [...graphemes(s)].map((g) => g.text);
}

describe('graphemes', () => {
  it('returns nothing for an empty string', () => {
    expect([...graphemes('')]).toEqual([]);
  });

  it('treats ASCII as one cluster per char', () => {
    expect(clusters('abc')).toEqual(['a', 'b', 'c']);
  });

  it('treats CR LF as a single cluster (GB3)', () => {
    expect(clusters('a\r\nb')).toEqual(['a', '\r\n', 'b']);
  });

  it('breaks before and after lone CR / LF (GB4/5)', () => {
    expect(clusters('a\rb\nc')).toEqual(['a', '\r', 'b', '\n', 'c']);
  });

  it('keeps combining marks attached to their base (GB9)', () => {
    // 'e' + COMBINING ACUTE ACCENT (U+0301)
    expect(clusters('éf')).toEqual(['é', 'f']);
  });

  it('keeps VS16 (emoji presentation) attached to its base (GB9)', () => {
    // ❤️ = ❤ (U+2764) + VS16 (U+FE0F)
    expect(clusters('❤️x')).toEqual(['❤️', 'x']);
  });

  it('joins ZWJ emoji families into one cluster (GB11)', () => {
    // 👨‍👩‍👧 — man, ZWJ, woman, ZWJ, girl
    expect(clusters('👨‍👩‍👧!')).toEqual(['👨‍👩‍👧', '!']);
  });

  it('pairs regional indicators into a flag (GB12/13)', () => {
    // 🇯🇵 (Japan) + 🇺🇸 (US) → two flags, two clusters
    expect(clusters('🇯🇵🇺🇸')).toEqual(['🇯🇵', '🇺🇸']);
  });

  it('handles odd-count regional indicators by pairing eagerly', () => {
    // Three RIs: first two pair, third is its own cluster.
    const ri = '\u{1F1E6}'; // RI A
    expect(clusters(ri + ri + ri)).toEqual([ri + ri, ri]);
  });

  it('joins Hangul L + V + T into one syllable (GB6/7/8)', () => {
    // 한 = ᄒ (L) + ᅡ (V) + ᆫ (T)
    expect(clusters('한x')).toEqual(['한', 'x']);
  });

  it('reports correct start index for each cluster', () => {
    const s = '🇯🇵a';
    const list = [...graphemes(s)];
    expect(list[0]?.start).toBe(0);
    // 🇯🇵 is 4 UTF-16 units (two surrogate pairs).
    expect(list[1]?.start).toBe(4);
  });
});
