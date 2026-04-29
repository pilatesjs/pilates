/**
 * 2D cell grid for terminal output.
 *
 * Each cell holds:
 *   - `char`: the grapheme cluster shown (or '' for a continuation cell of a
 *     wide character placed in the cell to its left).
 *   - `width`: 0 (continuation), 1, or 2.
 *   - `fg`, `bg`: optional colors.
 *   - `attrs`: bitmask of bold / italic / underline / dim / inverse.
 *
 * `toString({ ansi })` walks the grid and emits styled output. Style state
 * is tracked across cells so we don't reset between every character —
 * sequences are emitted only when the style changes.
 */

import { graphemes, stringWidth } from '@pilates/core';
import { Attr, SGR_RESET, attrsSgr, bgSgr, fgSgr, packAttrs, sgr } from './ansi.js';
import type { Color, TextStyle } from './types.js';

/**
 * One cell of a {@link Frame}. `width` is `0` for the continuation slot of a
 * 2-cell wide character (the slot to the right of the wide grapheme), `1`
 * for a normal cell, `2` for the leading slot of a wide grapheme.
 */
export interface Cell {
  char: string;
  width: 0 | 1 | 2;
  fg: Color | undefined;
  bg: Color | undefined;
  attrs: number;
}

const SPACE_CELL: Cell = { char: ' ', width: 1, fg: undefined, bg: undefined, attrs: 0 };

export class Frame {
  readonly width: number;
  readonly height: number;
  private readonly cells: Cell[];

  constructor(width: number, height: number) {
    this.width = Math.max(0, width | 0);
    this.height = Math.max(0, height | 0);
    this.cells = new Array(this.width * this.height);
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = freshCell();
    }
  }

  private idx(x: number, y: number): number {
    return y * this.width + x;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /** Set a single cell. Caller must respect wide-char invariants. */
  setCell(x: number, y: number, cell: Cell): void {
    if (!this.inBounds(x, y)) return;
    this.cells[this.idx(x, y)] = cell;
  }

  getCell(x: number, y: number): Cell | undefined {
    if (!this.inBounds(x, y)) return undefined;
    return this.cells[this.idx(x, y)];
  }

  /**
   * Write a single grapheme cluster at (x, y). Wide characters consume two
   * cells; the second cell is marked as a continuation (width 0).
   */
  setGrapheme(x: number, y: number, char: string, style: CellStyle): void {
    if (!this.inBounds(x, y)) return;
    const w = stringWidth(char);
    if (w === 0) {
      // Zero-width: ignore (combining marks should attach to previous cell;
      // for simplicity v1 just drops these — graphemes function pre-merges
      // them into the base cluster, so this branch rarely fires).
      return;
    }
    const cellW = w === 2 ? 2 : 1;
    this.cells[this.idx(x, y)] = {
      char,
      width: cellW,
      fg: style.fg,
      bg: style.bg,
      attrs: style.attrs,
    };
    if (cellW === 2 && this.inBounds(x + 1, y)) {
      // Continuation cell: empty char, width 0, but inherit style so bg
      // colors paint cleanly.
      this.cells[this.idx(x + 1, y)] = {
        char: '',
        width: 0,
        fg: style.fg,
        bg: style.bg,
        attrs: style.attrs,
      };
    }
  }

  /**
   * Write a string at (x, y), splitting into grapheme clusters and respecting
   * wide-char widths. Returns the cell width consumed (may be less than the
   * string's natural width if it would overflow). Any cluster that would
   * cross the right edge is dropped.
   */
  writeText(x: number, y: number, text: string, style: CellStyle): number {
    let cursor = x;
    for (const g of graphemes(text)) {
      const w = stringWidth(g.text);
      if (w === 0) continue;
      if (cursor + w > this.width) break;
      this.setGrapheme(cursor, y, g.text, style);
      cursor += w === 2 ? 2 : 1;
    }
    return cursor - x;
  }

  /** Fill a rectangle with the given style, leaving chars unchanged. */
  fillBg(rect: Rect, bg: Color | undefined): void {
    if (bg === undefined) return;
    const x0 = Math.max(0, rect.x);
    const y0 = Math.max(0, rect.y);
    const x1 = Math.min(this.width, rect.x + rect.width);
    const y1 = Math.min(this.height, rect.y + rect.height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const c = this.cells[this.idx(x, y)]!;
        c.bg = bg;
      }
    }
  }

  /**
   * Convert the frame to a printable string. When `ansi` is true (default),
   * SGR sequences are emitted on style changes; when false, only characters
   * (no escapes) are emitted.
   */
  toString(opts: { ansi?: boolean } = {}): string {
    const ansi = opts.ansi ?? true;
    const out: string[] = [];
    let activeFg: Color | undefined;
    let activeBg: Color | undefined;
    let activeAttrs = 0;
    let dirty = false;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells[this.idx(x, y)]!;
        if (cell.width === 0) continue; // continuation, already painted

        if (ansi) {
          const same = cell.fg === activeFg && cell.bg === activeBg && cell.attrs === activeAttrs;
          if (!same) {
            // Reset before re-applying when going from styled → empty.
            const goingPlain = cell.fg === undefined && cell.bg === undefined && cell.attrs === 0;
            const params: string[] = [];
            if (goingPlain) {
              if (dirty) {
                out.push(SGR_RESET);
                dirty = false;
              }
            } else {
              // Always reset first, then apply current. Simpler than diffing
              // off / on per attribute.
              if (dirty) params.push('0');
              if (cell.attrs !== 0) params.push(...attrsSgr(cell.attrs));
              if (cell.fg !== undefined) params.push(fgSgr(cell.fg));
              if (cell.bg !== undefined) params.push(bgSgr(cell.bg));
              out.push(sgr(params));
              dirty = true;
            }
            activeFg = cell.fg;
            activeBg = cell.bg;
            activeAttrs = cell.attrs;
          }
        }

        out.push(cell.char.length > 0 ? cell.char : ' ');
      }
      if (ansi && dirty) {
        out.push(SGR_RESET);
        dirty = false;
        activeFg = undefined;
        activeBg = undefined;
        activeAttrs = 0;
      }
      if (y < this.height - 1) out.push('\n');
    }
    return out.join('');
  }

  /** Plain ASCII output (no ANSI), useful for snapshots. */
  toPlainString(): string {
    return this.toString({ ansi: false });
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CellStyle {
  fg?: Color | undefined;
  bg?: Color | undefined;
  attrs: number;
}

function freshCell(): Cell {
  return { ...SPACE_CELL };
}

/** Build a CellStyle from a TextStyle bag. */
export function styleToCellStyle(style: TextStyle): CellStyle {
  return {
    fg: style.color,
    bg: style.bgColor,
    attrs: packAttrs(style),
  };
}

// Keep the Attr enum re-exported here so the painter can use it without
// importing two separate files.
export { Attr };
