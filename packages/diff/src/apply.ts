/**
 * Encode a list of {@link CellChange}s as one ANSI escape-sequence string,
 * ready to write to stdout.
 *
 * For each change: emits a CSI cursor-position (1-indexed) + SGR style +
 * the character. Style state is tracked across changes — SGR sequences
 * are emitted only when the style differs from the previous change. A
 * single SGR reset is emitted at the end.
 *
 *     CSI <row>;<col> H   move cursor to (row, col)        — 1-indexed
 *     CSI <params> m      set graphic rendition (color/attrs)
 *     CSI 0 m             reset
 */

import { SGR_RESET, attrsSgr, bgSgr, fgSgr, sgr } from '@pilates/render';
import type { Color } from '@pilates/render';
import type { CellChange } from './types.js';

export function applyDiff(changes: CellChange[]): string {
  if (changes.length === 0) return '';

  const out: string[] = [];
  let activeFg: Color | undefined;
  let activeBg: Color | undefined;
  let activeAttrs = 0;
  let dirty = false;
  // After writing a glyph the terminal cursor naturally advances by
  // `width` cells. Track where the cursor ends up so contiguous changes
  // skip a redundant CSI cursor-position. -1 means "unknown" (initial
  // state — must emit CSI before the first change).
  let expectedX = -1;
  let expectedY = -1;

  for (const c of changes) {
    if (c.x !== expectedX || c.y !== expectedY) {
      // Cursor position: 1-indexed in ANSI.
      out.push(`\x1b[${c.y + 1};${c.x + 1}H`);
    }

    const sameStyle = c.fg === activeFg && c.bg === activeBg && c.attrs === activeAttrs;
    if (!sameStyle) {
      const goingPlain = c.fg === undefined && c.bg === undefined && c.attrs === 0;
      if (goingPlain) {
        if (dirty) {
          out.push(SGR_RESET);
          dirty = false;
        }
      } else {
        const params: string[] = [];
        if (dirty) params.push('0'); // reset before re-applying
        if (c.attrs !== 0) params.push(...attrsSgr(c.attrs));
        if (c.fg !== undefined) params.push(fgSgr(c.fg));
        if (c.bg !== undefined) params.push(bgSgr(c.bg));
        out.push(sgr(params));
        dirty = true;
      }
      activeFg = c.fg;
      activeBg = c.bg;
      activeAttrs = c.attrs;
    }

    out.push(c.char);
    expectedX = c.x + c.width;
    expectedY = c.y;
  }

  if (dirty) out.push(SGR_RESET);
  return out.join('');
}
