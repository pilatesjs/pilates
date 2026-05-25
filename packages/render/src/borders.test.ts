/**
 * Direct unit tests for the border-character table.
 *
 * The painter is exercised end-to-end by `index.test.ts` and `snapshots.test.ts`,
 * which check the rendered output for each style. These tests lock the
 * `borderChars()` / `hasBorder()` contract so future style additions can't
 * silently shift the glyph map.
 */

import { describe, expect, it } from 'vitest';
import { borderChars, hasBorder } from './borders.js';
import type { BorderStyle } from './types.js';

describe('borderChars', () => {
  it('single uses light box-drawing glyphs', () => {
    expect(borderChars('single')).toEqual({
      tl: '┌',
      tr: '┐',
      bl: '└',
      br: '┘',
      h: '─',
      v: '│',
    });
  });

  it('double uses heavy double-line glyphs', () => {
    expect(borderChars('double')).toEqual({
      tl: '╔',
      tr: '╗',
      bl: '╚',
      br: '╝',
      h: '═',
      v: '║',
    });
  });

  it('rounded uses rounded corner glyphs with single edges', () => {
    expect(borderChars('rounded')).toEqual({
      tl: '╭',
      tr: '╮',
      bl: '╰',
      br: '╯',
      h: '─',
      v: '│',
    });
  });

  it('bold uses heavy box-drawing glyphs', () => {
    expect(borderChars('bold')).toEqual({
      tl: '┏',
      tr: '┓',
      bl: '┗',
      br: '┛',
      h: '━',
      v: '┃',
    });
  });

  it('none produces empty strings on every slot', () => {
    expect(borderChars('none')).toEqual({
      tl: '',
      tr: '',
      bl: '',
      br: '',
      h: '',
      v: '',
    });
  });

  it('every style returns the same six-slot shape', () => {
    const styles: BorderStyle[] = ['none', 'single', 'double', 'rounded', 'bold'];
    for (const s of styles) {
      const chars = borderChars(s);
      expect(Object.keys(chars).sort()).toEqual(['bl', 'br', 'h', 'tl', 'tr', 'v']);
    }
  });

  it('every non-none style emits exactly one grapheme per slot', () => {
    const styles: BorderStyle[] = ['single', 'double', 'rounded', 'bold'];
    for (const s of styles) {
      const chars = borderChars(s);
      for (const k of Object.keys(chars) as Array<keyof typeof chars>) {
        // [...str].length counts code points; box-drawing glyphs are single
        // codepoints in BMP so this should always be 1.
        expect([...chars[k]].length).toBe(1);
      }
    }
  });
});

describe('hasBorder', () => {
  it('returns false for undefined', () => {
    expect(hasBorder(undefined)).toBe(false);
  });

  it('returns false for "none"', () => {
    expect(hasBorder('none')).toBe(false);
  });

  it('returns true for every visible style', () => {
    expect(hasBorder('single')).toBe(true);
    expect(hasBorder('double')).toBe(true);
    expect(hasBorder('rounded')).toBe(true);
    expect(hasBorder('bold')).toBe(true);
  });
});
