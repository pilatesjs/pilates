/**
 * Round-trip property test for diff + apply.
 *
 * The whole point of this layer is the invariant that, given any pair of
 * frames `prev` and `next`,
 *
 *     applyDiff(diff(prev, next))
 *
 * applied to a terminal seeded with `prev`'s cell grid produces a grid
 * equal to `next`'s. Without this test we'd be asserting only the *shape*
 * of the emitted ANSI (cursor codes here, SGR there) — never that the
 * pipeline actually keeps a real terminal in sync.
 *
 * We replay the emitted ANSI through a tiny virtual terminal that handles
 * the three sequence types `applyDiff` can emit:
 *
 *   - CSI cursor-position    `ESC [ <row>;<col> H`
 *   - SGR                    `ESC [ <params> m`
 *   - plain glyph writes
 *
 * Generated frames stick to NamedColor + simple ASCII / one-wide CJK char,
 * so the SGR parser only needs to know the codes that `attrsSgr` / `fgSgr`
 * / `bgSgr` actually emit for those inputs.
 */

import { graphemes, stringWidth } from '@pilates/core';
import { Attr, type Cell, type Color, Frame, type NamedColor } from '@pilates/render';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyDiff } from './apply.js';
import { diff } from './diff.js';

const NAMED_FG_BY_CODE: Record<number, NamedColor> = {
  30: 'black',
  31: 'red',
  32: 'green',
  33: 'yellow',
  34: 'blue',
  35: 'magenta',
  36: 'cyan',
  37: 'white',
  90: 'gray',
  91: 'brightRed',
  92: 'brightGreen',
  93: 'brightYellow',
  94: 'brightBlue',
  95: 'brightMagenta',
  96: 'brightCyan',
  97: 'brightWhite',
};

class VTerm {
  readonly width: number;
  readonly height: number;
  readonly cells: Cell[];
  cursorX = 0;
  cursorY = 0;
  fg: Color | undefined = undefined;
  bg: Color | undefined = undefined;
  attrs = 0;

  constructor(width: number, height: number, seed: Frame) {
    this.width = width;
    this.height = height;
    this.cells = new Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = seed.getCell(x, y)!;
        this.cells[y * width + x] = { ...c };
      }
    }
  }

  apply(s: string): void {
    let i = 0;
    while (i < s.length) {
      if (s[i] === '\x1b' && s[i + 1] === '[') {
        let j = i + 2;
        while (j < s.length && s[j] !== undefined && /[0-9;]/.test(s[j]!)) j++;
        const params = s.slice(i + 2, j);
        const final = s[j];
        i = j + 1;
        if (final === 'H' || final === 'f') {
          const [row = '1', col = '1'] = params.split(';');
          this.cursorY = (Number.parseInt(row, 10) || 1) - 1;
          this.cursorX = (Number.parseInt(col, 10) || 1) - 1;
        } else if (final === 'm') {
          this.applySgr(params === '' ? '0' : params);
        }
        continue;
      }
      // Plain text up to the next ESC.
      let j = i;
      while (j < s.length && s[j] !== '\x1b') j++;
      const text = s.slice(i, j);
      for (const g of graphemes(text)) {
        const w = stringWidth(g.text);
        if (w === 0) continue;
        this.writeCell(g.text, w === 2 ? 2 : 1);
        this.cursorX += w === 2 ? 2 : 1;
      }
      i = j;
    }
  }

  private applySgr(params: string): void {
    const parts = params.split(';');
    let i = 0;
    while (i < parts.length) {
      const code = Number.parseInt(parts[i] ?? '0', 10);
      if (code === 0) {
        this.fg = undefined;
        this.bg = undefined;
        this.attrs = 0;
      } else if (code === 1) this.attrs |= Attr.Bold;
      else if (code === 2) this.attrs |= Attr.Dim;
      else if (code === 3) this.attrs |= Attr.Italic;
      else if (code === 4) this.attrs |= Attr.Underline;
      else if (code === 7) this.attrs |= Attr.Inverse;
      else if (code >= 30 && code <= 37) this.fg = NAMED_FG_BY_CODE[code];
      else if (code === 39) this.fg = undefined;
      else if (code >= 40 && code <= 47) this.bg = NAMED_FG_BY_CODE[code - 10];
      else if (code === 49) this.bg = undefined;
      else if (code >= 90 && code <= 97) this.fg = NAMED_FG_BY_CODE[code];
      else if (code >= 100 && code <= 107) this.bg = NAMED_FG_BY_CODE[code - 10];
      else if (code === 38 && parts[i + 1] === '5') {
        this.fg = Number.parseInt(parts[i + 2] ?? '0', 10);
        i += 2;
      } else if (code === 48 && parts[i + 1] === '5') {
        this.bg = Number.parseInt(parts[i + 2] ?? '0', 10);
        i += 2;
      }
      i++;
    }
  }

  private writeCell(char: string, width: 1 | 2): void {
    if (this.cursorX < 0 || this.cursorY < 0) return;
    if (this.cursorX >= this.width || this.cursorY >= this.height) return;
    const idx = this.cursorY * this.width + this.cursorX;
    this.cells[idx] = { char, width, fg: this.fg, bg: this.bg, attrs: this.attrs };
    if (width === 2 && this.cursorX + 1 < this.width) {
      this.cells[idx + 1] = {
        char: '',
        width: 0,
        fg: this.fg,
        bg: this.bg,
        attrs: this.attrs,
      };
    }
  }

  getCell(x: number, y: number): Cell {
    return this.cells[y * this.width + x]!;
  }
}

interface CellSpec {
  char: string;
  fg: Color | undefined;
  bg: Color | undefined;
  attrs: number;
}

const namedColorArb = fc.constantFrom<NamedColor>(
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
);

const colorArb = fc.option(namedColorArb as fc.Arbitrary<Color>, { nil: undefined });

// Mix narrow ASCII, space (Frame's default), and one wide grapheme so the
// continuation-cell path gets covered.
const charArb = fc.constantFrom('a', 'b', 'c', '.', ' ', 'X', '你');

const cellSpecArb: fc.Arbitrary<CellSpec> = fc.record({
  char: charArb,
  fg: colorArb,
  bg: colorArb,
  attrs: fc.integer({ min: 0, max: 0x1f }),
});

function frameFromCells(width: number, height: number, specs: CellSpec[]): Frame {
  const f = new Frame(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const spec = specs[y * width + x]!;
      // setGrapheme writes the cell at (x, y); for a width-2 char it
      // also marks (x+1, y) as a continuation. If we then write a
      // narrow char at (x+1, y), it overwrites the continuation
      // correctly — same behavior the production reconciler relies on.
      f.setGrapheme(x, y, spec.char, { fg: spec.fg, bg: spec.bg, attrs: spec.attrs });
    }
  }
  return f;
}

function cellsEqualForCompare(a: Cell, b: Cell): boolean {
  return (
    a.width === b.width &&
    a.attrs === b.attrs &&
    a.fg === b.fg &&
    a.bg === b.bg &&
    // Empty char is rendered as space at apply time; treat them as equivalent.
    (a.char === b.char ||
      (a.width === 1 && a.char === ' ' && b.char === '') ||
      (a.width === 1 && a.char === '' && b.char === ' '))
  );
}

describe('diff + apply round-trip', () => {
  it('applyDiff(diff(prev, next)) reconstructs next, cell-for-cell', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 4 }),
        fc.array(cellSpecArb, { minLength: 32, maxLength: 32 }),
        fc.array(cellSpecArb, { minLength: 32, maxLength: 32 }),
        (w, h, prevSpecs, nextSpecs) => {
          const size = w * h;
          const prev = frameFromCells(w, h, prevSpecs.slice(0, size));
          const next = frameFromCells(w, h, nextSpecs.slice(0, size));

          const ansi = applyDiff(diff(prev, next));
          const vterm = new VTerm(w, h, prev);
          vterm.apply(ansi);

          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const got = vterm.getCell(x, y);
              const want = next.getCell(x, y)!;
              if (!cellsEqualForCompare(got, want)) {
                throw new Error(
                  `mismatch at (${x},${y}) w=${w} h=${h}\n` +
                    `  got:  ${JSON.stringify(got)}\n` +
                    `  want: ${JSON.stringify(want)}\n` +
                    `  ansi: ${JSON.stringify(ansi)}`,
                );
              }
            }
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('hand-crafted: identical frames produce no ANSI', () => {
    const prev = frameFromCells(3, 1, [
      { char: 'a', fg: 'red', bg: undefined, attrs: 0 },
      { char: 'b', fg: 'red', bg: undefined, attrs: 0 },
      { char: 'c', fg: 'red', bg: undefined, attrs: 0 },
    ]);
    expect(applyDiff(diff(prev, prev))).toBe('');
  });

  it('hand-crafted: prev=null is treated as full repaint', () => {
    const next = frameFromCells(2, 1, [
      { char: 'A', fg: undefined, bg: undefined, attrs: 0 },
      { char: 'B', fg: undefined, bg: undefined, attrs: 0 },
    ]);
    const blank = new Frame(2, 1);
    const vterm = new VTerm(2, 1, blank);
    vterm.apply(applyDiff(diff(null, next)));
    expect(vterm.getCell(0, 0).char).toBe('A');
    expect(vterm.getCell(1, 0).char).toBe('B');
  });
});
