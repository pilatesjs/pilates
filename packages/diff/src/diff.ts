import type { Cell, Frame } from '@pilates/render';
import type { CellChange } from './types.js';

/**
 * Compute the minimal set of cell-level updates needed to transform `prev`
 * into `next`.
 *
 * - If `prev` is `null` or its dimensions differ from `next`'s, every
 *   visible cell of `next` is emitted (a full repaint).
 * - Otherwise, only cells whose grapheme, fg, bg, width, or attribute
 *   bitmask changed are emitted.
 * - Continuation slots (width 0) are never emitted directly — they are
 *   re-painted as a side-effect of writing the leading wide grapheme.
 */
export function diff(prev: Frame | null, next: Frame): CellChange[] {
  const fullRepaint = prev === null || prev.width !== next.width || prev.height !== next.height;

  const out: CellChange[] = [];
  for (let y = 0; y < next.height; y++) {
    for (let x = 0; x < next.width; x++) {
      const newCell = next.getCell(x, y);
      if (newCell === undefined) continue;
      if (newCell.width === 0) continue; // continuation slot — handled by its leader

      if (fullRepaint) {
        out.push(toChange(x, y, newCell));
        continue;
      }

      // prev is non-null with matching dimensions here.
      const oldCell = (prev as Frame).getCell(x, y);
      if (oldCell === undefined || !cellsEqual(oldCell, newCell)) {
        out.push(toChange(x, y, newCell));
      }
    }
  }
  return out;
}

function cellsEqual(a: Cell, b: Cell): boolean {
  return (
    a.width === b.width &&
    a.attrs === b.attrs &&
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.char === b.char
  );
}

function toChange(x: number, y: number, cell: Cell): CellChange {
  // cell.width is 1 or 2 here; the caller filters out the 0 case.
  return {
    x,
    y,
    char: cell.char.length > 0 ? cell.char : ' ',
    width: cell.width === 2 ? 2 : 1,
    fg: cell.fg,
    bg: cell.bg,
    attrs: cell.attrs,
  };
}
