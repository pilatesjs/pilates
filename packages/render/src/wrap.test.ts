import { describe, expect, it } from 'vitest';
import { truncateLine, wrapText } from './wrap.js';

describe('wrapText', () => {
  it('returns [] for non-positive width', () => {
    expect(wrapText('hello', 0)).toEqual([]);
    expect(wrapText('hello', -1)).toEqual([]);
  });

  it('returns the input as a single line when it fits', () => {
    expect(wrapText('hello', 10)).toEqual(['hello']);
  });

  it('preserves a single empty paragraph', () => {
    expect(wrapText('', 4)).toEqual(['']);
  });

  it('preserves blank lines (consecutive newlines)', () => {
    expect(wrapText('a\n\nb', 4)).toEqual(['a', '', 'b']);
  });

  it('wraps at word boundaries', () => {
    expect(wrapText('aaaa bbbb', 4)).toEqual(['aaaa', 'bbbb']);
  });

  it('drops whitespace at the wrap point', () => {
    expect(wrapText('aaaa  bbbb', 4)).toEqual(['aaaa', 'bbbb']);
    expect(wrapText('aaaa    bbbb', 4)).toEqual(['aaaa', 'bbbb']);
  });

  it('trims trailing whitespace at wrap boundary when ws fits but next word does not', () => {
    // Tokens: hello, ' ', world. Space fits (w=6), 'world' would push to 11.
    // Wrap fires; line 1 must NOT carry the trailing space into rendered cells.
    expect(wrapText('hello world', 6)).toEqual(['hello', 'world']);
  });

  it('breaks a single overlong word at grapheme boundaries', () => {
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('regression: leading whitespace longer than width does not emit a blank line', () => {
    // 5 leading spaces at width 4 used to emit '' as the first line
    // because the wrap-point branch pushed an empty `current`.
    expect(wrapText('     bbbb', 4)).toEqual(['bbbb']);
  });

  it('preserves leading whitespace that fits', () => {
    expect(wrapText('  bbbb', 4)).toEqual(['  ', 'bbbb']);
  });

  it('preserves trailing whitespace within a line', () => {
    expect(wrapText('a  ', 4)).toEqual(['a  ']);
  });

  it('handles single-cell width with mixed words and spaces', () => {
    expect(wrapText('a b c', 1)).toEqual(['a', 'b', 'c']);
  });

  it('hard newlines force breaks regardless of width', () => {
    expect(wrapText('aa\nbb', 10)).toEqual(['aa', 'bb']);
  });
});

describe('truncateLine', () => {
  it('returns empty string for non-positive width', () => {
    expect(truncateLine('hello', 0)).toBe('');
  });

  it('returns the input untouched when it fits', () => {
    expect(truncateLine('hi', 4)).toBe('hi');
  });

  it('truncates with ellipsis at exact boundary', () => {
    expect(truncateLine('hello world', 8)).toBe('hello w…');
  });

  it('produces best-effort ellipsis when width is too small', () => {
    expect(truncateLine('hello', 1)).toBe('…');
  });
});
