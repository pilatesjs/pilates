import type { Color } from '@pilates/render';

/**
 * A single cell-level update to be applied to a terminal frame.
 *
 * `x` and `y` are 0-indexed (top-left is (0, 0)) — the encoder converts to
 * the 1-indexed coordinates ANSI's CSI cursor-position uses.
 *
 * `width` is `1` for narrow cells and `2` for the leading slot of a wide
 * grapheme (CJK / emoji). The continuation slot of a wide character is
 * never a separate `CellChange` — the encoder handles the second cell as
 * a side-effect of writing the wide grapheme.
 */
export interface CellChange {
  x: number;
  y: number;
  char: string;
  width: 1 | 2;
  fg: Color | undefined;
  bg: Color | undefined;
  attrs: number;
}
