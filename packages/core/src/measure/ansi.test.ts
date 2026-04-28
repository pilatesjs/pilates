import { describe, expect, it } from 'vitest';
import { stripAnsi } from './ansi.js';

describe('stripAnsi', () => {
  it('returns empty for empty input', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('passes through plain text untouched', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('strips a single SGR sequence', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('strips chained SGR sequences', () => {
    expect(stripAnsi('\x1b[1;31;47mhi\x1b[0m there')).toBe('hi there');
  });

  it('strips OSC hyperlink with BEL terminator', () => {
    const link = '\x1b]8;;https://example.com\x07click\x1b]8;;\x07';
    expect(stripAnsi(link)).toBe('click');
  });

  it('strips OSC with ST (ESC \\) terminator', () => {
    const s = '\x1b]0;title\x1b\\after';
    expect(stripAnsi(s)).toBe('after');
  });

  it('strips bare CSI C1 (0x9B)', () => {
    expect(stripAnsi('31mred0m')).toBe('red');
  });

  it('preserves non-escape control characters', () => {
    // BEL, BS, HT, LF, CR are passed through (caller decides).
    expect(stripAnsi('a\tb\nc')).toBe('a\tb\nc');
  });

  it('handles ESC followed by character set selection', () => {
    // ESC ( B → designate G0 as ASCII; common in old TTYs.
    expect(stripAnsi('\x1b(Bhello')).toBe('hello');
  });

  it('drops a lone trailing ESC', () => {
    expect(stripAnsi('hello\x1b')).toBe('hello');
  });

  it('strips an unterminated CSI to end of string', () => {
    expect(stripAnsi('\x1b[31m')).toBe('');
  });
});
