/**
 * Direct unit tests for the SGR helpers in `ansi.ts`.
 *
 * Snapshot tests in `snapshots.test.ts` exercise these indirectly, but
 * downstream packages (notably `@pilates/diff`) import these helpers as a
 * public API and rely on their exact return values. These tests lock the
 * shape so accidental refactors of the SGR emitter are caught immediately.
 */

import { describe, expect, it } from 'vitest';
import { Attr, SGR_RESET, attrsSgr, bgSgr, fgSgr, packAttrs, sgr } from './ansi.js';

describe('fgSgr', () => {
  it('maps named colors to standard 30-37', () => {
    expect(fgSgr('black')).toBe('30');
    expect(fgSgr('red')).toBe('31');
    expect(fgSgr('green')).toBe('32');
    expect(fgSgr('yellow')).toBe('33');
    expect(fgSgr('blue')).toBe('34');
    expect(fgSgr('magenta')).toBe('35');
    expect(fgSgr('cyan')).toBe('36');
    expect(fgSgr('white')).toBe('37');
  });

  it('maps bright variants to 90-97', () => {
    expect(fgSgr('gray')).toBe('90');
    expect(fgSgr('brightRed')).toBe('91');
    expect(fgSgr('brightGreen')).toBe('92');
    expect(fgSgr('brightYellow')).toBe('93');
    expect(fgSgr('brightBlue')).toBe('94');
    expect(fgSgr('brightMagenta')).toBe('95');
    expect(fgSgr('brightCyan')).toBe('96');
    expect(fgSgr('brightWhite')).toBe('97');
  });

  it('emits 256-color form for numeric inputs', () => {
    expect(fgSgr(0)).toBe('38;5;0');
    expect(fgSgr(208)).toBe('38;5;208');
    expect(fgSgr(255)).toBe('38;5;255');
  });

  it('truncates fractional numeric inputs via |0', () => {
    expect(fgSgr(208.9)).toBe('38;5;208');
  });

  it('emits 24-bit form for #RRGGBB hex', () => {
    expect(fgSgr('#ff5500')).toBe('38;2;255;85;0');
    expect(fgSgr('#000000')).toBe('38;2;0;0;0');
    expect(fgSgr('#ffffff')).toBe('38;2;255;255;255');
  });

  it('expands #RGB short form to 24-bit', () => {
    // #f50 → ff 55 00
    expect(fgSgr('#f50' as `#${string}`)).toBe('38;2;255;85;0');
    expect(fgSgr('#abc' as `#${string}`)).toBe('38;2;170;187;204');
  });

  it('falls back to default-fg (39) for unrecognized strings', () => {
    expect(fgSgr('not-a-color' as never)).toBe('39');
  });

  it('returns #000000 for malformed hex (non-3/6 length)', () => {
    // Defensive: malformed hex still goes through parseHex which returns [0,0,0]
    expect(fgSgr('#1234' as `#${string}`)).toBe('38;2;0;0;0');
  });
});

describe('bgSgr', () => {
  it('shifts named colors by +10 (40-47, 100-107)', () => {
    expect(bgSgr('black')).toBe('40');
    expect(bgSgr('white')).toBe('47');
    expect(bgSgr('gray')).toBe('100');
    expect(bgSgr('brightWhite')).toBe('107');
  });

  it('uses 48;5;N for 256-color', () => {
    expect(bgSgr(208)).toBe('48;5;208');
  });

  it('uses 48;2;R;G;B for 24-bit hex', () => {
    expect(bgSgr('#102030')).toBe('48;2;16;32;48');
  });

  it('falls back to default-bg (49) for unrecognized strings', () => {
    expect(bgSgr('not-a-color' as never)).toBe('49');
  });
});

describe('attrsSgr', () => {
  it('returns [] for attrs === 0', () => {
    expect(attrsSgr(0)).toEqual([]);
  });

  it('emits per-attribute codes in canonical order: bold, dim, italic, underline, inverse', () => {
    expect(attrsSgr(Attr.Bold)).toEqual(['1']);
    expect(attrsSgr(Attr.Dim)).toEqual(['2']);
    expect(attrsSgr(Attr.Italic)).toEqual(['3']);
    expect(attrsSgr(Attr.Underline)).toEqual(['4']);
    expect(attrsSgr(Attr.Inverse)).toEqual(['7']);
  });

  it('combines multiple flags in canonical order regardless of input bit order', () => {
    const all = Attr.Bold | Attr.Dim | Attr.Italic | Attr.Underline | Attr.Inverse;
    expect(attrsSgr(all)).toEqual(['1', '2', '3', '4', '7']);
  });

  it('ignores unknown bits', () => {
    // Set a bit outside the defined attr range.
    expect(attrsSgr(0x10000)).toEqual([]);
  });
});

describe('packAttrs', () => {
  it('returns 0 for an empty style', () => {
    expect(packAttrs({})).toBe(0);
  });

  it('packs each flag to its Attr constant', () => {
    expect(packAttrs({ bold: true })).toBe(Attr.Bold);
    expect(packAttrs({ italic: true })).toBe(Attr.Italic);
    expect(packAttrs({ underline: true })).toBe(Attr.Underline);
    expect(packAttrs({ dim: true })).toBe(Attr.Dim);
    expect(packAttrs({ inverse: true })).toBe(Attr.Inverse);
  });

  it('treats false / undefined flags as absent', () => {
    expect(packAttrs({ bold: false, italic: undefined })).toBe(0);
  });

  it('packs all flags into a single bitmask', () => {
    const mask = packAttrs({
      bold: true,
      italic: true,
      underline: true,
      dim: true,
      inverse: true,
    });
    expect(mask).toBe(Attr.Bold | Attr.Italic | Attr.Underline | Attr.Dim | Attr.Inverse);
    // Round-trip through attrsSgr to make sure no flags are dropped.
    expect(attrsSgr(mask)).toEqual(['1', '2', '3', '4', '7']);
  });
});

describe('sgr', () => {
  it('returns the empty string for no params', () => {
    expect(sgr([])).toBe('');
  });

  it('wraps a single param in CSI...m', () => {
    expect(sgr(['31'])).toBe('\x1b[31m');
  });

  it('joins multiple params with ;', () => {
    expect(sgr(['1', '31'])).toBe('\x1b[1;31m');
    expect(sgr(['38', '2', '255', '85', '0'])).toBe('\x1b[38;2;255;85;0m');
  });
});

describe('SGR_RESET', () => {
  it('is the canonical CSI 0 m reset sequence', () => {
    expect(SGR_RESET).toBe('\x1b[0m');
  });
});

describe('Attr constants', () => {
  it('are powers of two so they pack into a bitmask without overlap', () => {
    const values = [Attr.Bold, Attr.Italic, Attr.Underline, Attr.Dim, Attr.Inverse];
    for (const v of values) {
      expect(v & (v - 1)).toBe(0); // power-of-two check
    }
    // No duplicates.
    expect(new Set(values).size).toBe(values.length);
  });
});
