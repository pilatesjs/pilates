import { describe, expect, it } from 'vitest';
import { cellWidth, stringWidth } from './width.js';

describe('cellWidth', () => {
  it('returns 1 for ASCII printable', () => {
    expect(cellWidth(0x41)).toBe(1); // 'A'
    expect(cellWidth(0x20)).toBe(1); // space
    expect(cellWidth(0x7e)).toBe(1); // '~'
  });

  it('returns 0 for C0/C1 controls', () => {
    expect(cellWidth(0x00)).toBe(0);
    expect(cellWidth(0x09)).toBe(0); // TAB — caller handles
    expect(cellWidth(0x1b)).toBe(0); // ESC
    expect(cellWidth(0x7f)).toBe(0); // DEL
    expect(cellWidth(0x9b)).toBe(0); // CSI
  });

  it('returns 2 for East Asian Wide ideographs', () => {
    expect(cellWidth('你'.codePointAt(0)!)).toBe(2);
    expect(cellWidth('好'.codePointAt(0)!)).toBe(2);
    expect(cellWidth('日'.codePointAt(0)!)).toBe(2);
  });

  it('returns 2 for fullwidth Latin', () => {
    expect(cellWidth(0xff21)).toBe(2); // FULLWIDTH LATIN CAPITAL LETTER A
  });

  it('returns 2 for default-emoji-presentation code points', () => {
    expect(cellWidth(0x1f525)).toBe(2); // 🔥 FIRE
    expect(cellWidth(0x1f600)).toBe(2); // 😀 GRINNING FACE
  });

  it('returns 0 for combining marks', () => {
    expect(cellWidth(0x0301)).toBe(0); // COMBINING ACUTE ACCENT
    expect(cellWidth(0x200d)).toBe(0); // ZWJ
    expect(cellWidth(0xfe0f)).toBe(0); // VS16 (zero-width on its own)
  });
});

describe('stringWidth', () => {
  it('is 0 for empty string', () => {
    expect(stringWidth('')).toBe(0);
  });

  it('counts ASCII as one cell each', () => {
    expect(stringWidth('hello')).toBe(5);
  });

  it('counts CJK as two cells each', () => {
    expect(stringWidth('你好')).toBe(4);
    expect(stringWidth('日本語')).toBe(6);
  });

  it('counts mixed ASCII + CJK', () => {
    expect(stringWidth('hi 你好')).toBe(7);
  });

  it('counts emoji as 2 cells', () => {
    expect(stringWidth('🔥')).toBe(2);
    expect(stringWidth('🔥🔥')).toBe(4);
  });

  it('treats VS16-promoted text emoji as 2 cells', () => {
    // ❤ alone is text presentation (1 cell); ❤️ with VS16 is emoji (2 cells).
    expect(stringWidth('❤️')).toBe(2);
  });

  it('counts ZWJ emoji families as 2 cells', () => {
    expect(stringWidth('👨‍👩‍👧')).toBe(2);
  });

  it('counts flags as 2 cells', () => {
    expect(stringWidth('🇯🇵')).toBe(2);
    expect(stringWidth('🇯🇵🇺🇸')).toBe(4);
  });

  it('strips ANSI before measuring', () => {
    expect(stringWidth('\x1b[31mhello\x1b[0m')).toBe(5);
    expect(stringWidth('\x1b[1m你好\x1b[0m')).toBe(4);
  });

  it('counts combining marks as zero', () => {
    // 'café' as 'c', 'a', 'f', 'e' + U+0301 → 4 cells, not 5.
    expect(stringWidth('café')).toBe(4);
  });

  it('does not double-count surrogate pairs', () => {
    // Single emoji is 2 surrogate code units but 1 grapheme of width 2.
    const fire = '🔥';
    expect(fire.length).toBe(2); // UTF-16 length
    expect(stringWidth(fire)).toBe(2);
  });
});
