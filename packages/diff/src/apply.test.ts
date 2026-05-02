import { Attr, SGR_RESET } from '@pilates/render';
import { describe, expect, it } from 'vitest';
import { applyDiff } from './apply.js';
import type { CellChange } from './types.js';

const plain = (x: number, y: number, char: string): CellChange => ({
  x,
  y,
  char,
  width: 1,
  fg: undefined,
  bg: undefined,
  attrs: 0,
});

describe('applyDiff — empty input', () => {
  it('returns an empty string when there are no changes', () => {
    expect(applyDiff([])).toBe('');
  });
});

describe('applyDiff — cursor positioning', () => {
  it('emits a 1-indexed cursor-position before the character', () => {
    expect(applyDiff([plain(0, 0, 'A')])).toBe('\x1b[1;1HA');
  });

  it('translates (x, y) to CSI <y+1>;<x+1>H', () => {
    expect(applyDiff([plain(3, 2, 'Q')])).toBe('\x1b[3;4HQ');
  });

  it('emits one CSI move per non-contiguous change, in order', () => {
    const out = applyDiff([plain(0, 0, 'A'), plain(2, 0, 'B'), plain(0, 1, 'C')]);
    expect(out).toBe('\x1b[1;1HA\x1b[1;3HB\x1b[2;1HC');
  });

  it('skips redundant CSI moves on contiguous runs', () => {
    // After writing 'A' at (0,0,width=1) the cursor naturally advances
    // to (1,0); the next change at (1,0) needs no CSI move. Same for B→C.
    const out = applyDiff([plain(0, 0, 'A'), plain(1, 0, 'B'), plain(2, 0, 'C')]);
    expect(out).toBe('\x1b[1;1HABC');
  });

  it('skips CSI move across a wide grapheme', () => {
    // Wide chars advance the cursor by their width (2). After writing '你'
    // at (0,0,width=2) the cursor is at (2,0); a change at (2,0) is
    // contiguous and needs no CSI.
    const wide = (x: number, y: number, char: string): CellChange => ({
      x,
      y,
      char,
      width: 2,
      fg: undefined,
      bg: undefined,
      attrs: 0,
    });
    const out = applyDiff([wide(0, 0, '你'), plain(2, 0, 'a')]);
    expect(out).toBe('\x1b[1;1H你a');
  });

  it('emits CSI when the next change is on a new row even at column 0', () => {
    const out = applyDiff([plain(0, 0, 'A'), plain(0, 1, 'B')]);
    // Cursor was at (1,0) after 'A'; next is (0,1) — not contiguous.
    expect(out).toBe('\x1b[1;1HA\x1b[2;1HB');
  });
});

describe('applyDiff — SGR style changes', () => {
  it('emits no SGR sequences for a fully plain stream', () => {
    const out = applyDiff([plain(0, 0, 'A'), plain(1, 0, 'B')]);
    // Only one CSI cursor-position before the run (the second cell is
    // contiguous so no second CSI), no SGR (would terminate in 'm').
    expect(out).toBe('\x1b[1;1HAB');
  });

  it('emits SGR for a styled change and reuses it for the next same-style change', () => {
    const c1: CellChange = { x: 0, y: 0, char: 'A', width: 1, fg: 'red', bg: undefined, attrs: 0 };
    const c2: CellChange = { x: 1, y: 0, char: 'B', width: 1, fg: 'red', bg: undefined, attrs: 0 };
    const out = applyDiff([c1, c2]);

    // Only one '\x1b[31m' before the run, then a single trailing reset.
    expect(out.split('\x1b[31m').length - 1).toBe(1);
    expect(out.endsWith(SGR_RESET)).toBe(true);
  });

  it('re-emits SGR with a leading reset when the style changes', () => {
    const c1: CellChange = { x: 0, y: 0, char: 'A', width: 1, fg: 'red', bg: undefined, attrs: 0 };
    const c2: CellChange = {
      x: 1,
      y: 0,
      char: 'B',
      width: 1,
      fg: 'green',
      bg: undefined,
      attrs: 0,
    };
    const out = applyDiff([c1, c2]);

    // Second style begins with '0;' to reset the prior color before applying green.
    expect(out).toContain('\x1b[31m');
    expect(out).toContain('\x1b[0;32m');
  });

  it('emits a single SGR_RESET (no styling) when going from styled → plain', () => {
    const styled: CellChange = {
      x: 0,
      y: 0,
      char: 'A',
      width: 1,
      fg: 'red',
      bg: undefined,
      attrs: 0,
    };
    const out = applyDiff([styled, plain(1, 0, 'B')]);

    // After 'A' we emit reset, then no extra SGR for the plain 'B'.
    // Final terminal reset is suppressed because we're already clean by 'B'.
    expect(out.split(SGR_RESET).length - 1).toBe(1);
    expect(out.endsWith('B')).toBe(true);
  });

  it('does not emit a trailing reset when the last change was plain from the start', () => {
    const out = applyDiff([plain(0, 0, 'A'), plain(1, 0, 'B')]);
    expect(out.endsWith(SGR_RESET)).toBe(false);
    expect(out.endsWith('B')).toBe(true);
  });

  it('emits a trailing SGR_RESET when the last change was styled', () => {
    const styled: CellChange = {
      x: 0,
      y: 0,
      char: 'A',
      width: 1,
      fg: 'magenta',
      bg: undefined,
      attrs: 0,
    };
    expect(applyDiff([styled]).endsWith(SGR_RESET)).toBe(true);
  });
});

describe('applyDiff — color encodings', () => {
  it('emits a 24-bit foreground for a hex string', () => {
    const c: CellChange = {
      x: 0,
      y: 0,
      char: '#',
      width: 1,
      fg: '#ff5500',
      bg: undefined,
      attrs: 0,
    };
    expect(applyDiff([c])).toContain('38;2;255;85;0');
  });

  it('emits a 256-color foreground for a numeric color', () => {
    const c: CellChange = { x: 0, y: 0, char: '#', width: 1, fg: 208, bg: undefined, attrs: 0 };
    expect(applyDiff([c])).toContain('38;5;208');
  });

  it('emits the named-color background offset by 10 from the fg code', () => {
    const c: CellChange = {
      x: 0,
      y: 0,
      char: '#',
      width: 1,
      fg: undefined,
      bg: 'red',
      attrs: 0,
    };
    expect(applyDiff([c])).toContain('\x1b[41m');
  });
});

describe('applyDiff — attribute bitmask', () => {
  it('emits attribute params before color params', () => {
    const c: CellChange = {
      x: 0,
      y: 0,
      char: 'A',
      width: 1,
      fg: 'green',
      bg: undefined,
      attrs: Attr.Bold,
    };
    expect(applyDiff([c])).toContain('\x1b[1;32m');
  });

  it('emits multiple attribute codes in canonical order', () => {
    const c: CellChange = {
      x: 0,
      y: 0,
      char: 'A',
      width: 1,
      fg: undefined,
      bg: undefined,
      attrs: Attr.Bold | Attr.Italic | Attr.Underline,
    };
    // attrsSgr emits in order: bold(1), dim(2), italic(3), underline(4), inverse(7).
    expect(applyDiff([c])).toContain('\x1b[1;3;4m');
  });
});

describe('applyDiff — wide characters', () => {
  it('writes the wide grapheme exactly once after its cursor-move', () => {
    const c: CellChange = {
      x: 0,
      y: 0,
      char: '你',
      width: 2,
      fg: undefined,
      bg: undefined,
      attrs: 0,
    };
    const out = applyDiff([c]);
    expect(out).toBe('\x1b[1;1H你');
  });
});
