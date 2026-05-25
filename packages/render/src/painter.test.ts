/**
 * Tests for the painter that complement `painter-overflow.test.ts`,
 * `snapshots.test.ts`, and `index.test.ts`:
 *
 *   - paint order: later siblings overlay earlier ones (no z-index — just
 *     document order, like CSS without explicit positioning)
 *   - zero-dimension nodes are short-circuited (no out-of-bounds writes)
 *   - text-node background fill paints the full row before chars
 *   - title slot omitted when the box is too narrow
 *
 * The painter is not exported; we drive it indirectly through
 * `renderToFrame()` and assert on the resulting Frame cells.
 */

import { describe, expect, it } from 'vitest';
import { renderToFrame } from './render.js';

describe('painter — paint order', () => {
  it('absolute siblings paint in document order (later overlays earlier)', () => {
    // Two absolute-positioned text leaves overlapping at (0,0). The second
    // child's content wins on shared cells.
    const out = renderToFrame({
      width: 5,
      height: 1,
      children: [
        {
          positionType: 'absolute',
          position: { left: 0, top: 0 },
          width: 5,
          height: 1,
          children: [{ text: 'AAAAA' }],
        },
        {
          positionType: 'absolute',
          position: { left: 0, top: 0 },
          width: 3,
          height: 1,
          children: [{ text: 'BBB' }],
        },
      ],
    }).toPlainString();
    expect(out).toBe('BBBAA');
  });
});

describe('painter — zero-dimension short-circuit', () => {
  it('skips a child with width=0', () => {
    // The 0-width child has nothing to paint; the second child should land
    // at the same x as the first would have (no leftover cells).
    const out = renderToFrame({
      width: 6,
      height: 1,
      flexDirection: 'row',
      children: [
        { width: 0, height: 1, border: 'single' }, // border draw on 0-width box must no-op
        { width: 3, children: [{ text: 'abc' }] },
      ],
    }).toPlainString();
    // The 0-width child contributes nothing; "abc" lands at the start.
    expect(out.slice(0, 3)).toBe('abc');
  });

  it('skips a child with height=0', () => {
    const out = renderToFrame({
      width: 4,
      height: 1,
      flexDirection: 'column',
      children: [
        { height: 0, border: 'single' },
        { height: 1, children: [{ text: 'ok' }] },
      ],
    }).toPlainString();
    expect(out).toBe('ok  ');
  });
});

describe('painter — text background fill', () => {
  it('fills the entire row with bg color before drawing chars', () => {
    // A text leaf with bgColor on a row wider than the text should paint
    // the bg on the *trailing* cells too.
    const frame = renderToFrame({
      width: 6,
      height: 1,
      children: [{ text: 'hi', bgColor: 'red' }],
    });
    // Inspect cells 2..5 (after "hi"). Their bg must be 'red'.
    for (let x = 2; x < 6; x++) {
      const cell = frame.getCell(x, 0);
      expect(cell?.bg).toBe('red');
    }
  });

  it('does not fill bg when the text has no bgColor and no attrs', () => {
    const frame = renderToFrame({
      width: 6,
      height: 1,
      children: [{ text: 'hi' }],
    });
    for (let x = 2; x < 6; x++) {
      expect(frame.getCell(x, 0)?.bg).toBeUndefined();
    }
  });

  it('applies attrs to the trailing fill row too', () => {
    const frame = renderToFrame({
      width: 6,
      height: 1,
      children: [{ text: 'hi', inverse: true }],
    });
    for (let x = 2; x < 6; x++) {
      // Inverse bit set on every cell in the row.
      expect((frame.getCell(x, 0)?.attrs ?? 0) & 0x10).toBe(0x10);
    }
  });
});

describe('painter — borders without title slot', () => {
  it('paints all four corners and edges for a 3×3 box', () => {
    const out = renderToFrame({ width: 3, height: 3, border: 'single' }).toPlainString();
    const rows = out.split('\n');
    expect(rows[0]).toBe('┌─┐');
    expect(rows[1]).toBe('│ │');
    expect(rows[2]).toBe('└─┘');
  });

  it('1×1 bordered box collapses to the bottom-right corner (no top/left edge)', () => {
    // The painter writes tl, tr, bl, br in order; at 1×1 they all land on
    // the same cell so the last write (br) wins. Locking this so a future
    // "skip degenerate boxes" refactor doesn't silently change output.
    const out = renderToFrame({ width: 1, height: 1, border: 'single' }).toPlainString();
    expect(out).toBe('┘');
  });

  it('2×2 bordered box: corners on all four cells (no edge runs)', () => {
    const out = renderToFrame({ width: 2, height: 2, border: 'single' }).toPlainString();
    expect(out).toBe(['┌┐', '└┘'].join('\n'));
  });
});

describe('painter — nested borders', () => {
  it('child border is fully inside the parent border', () => {
    const out = renderToFrame({
      width: 6,
      height: 4,
      border: 'single',
      children: [{ flex: 1, border: 'rounded' }],
    }).toPlainString();
    const rows = out.split('\n');
    expect(rows[0]).toBe('┌────┐');
    expect(rows[1]).toBe('│╭──╮│');
    expect(rows[2]).toBe('│╰──╯│');
    expect(rows[3]).toBe('└────┘');
  });
});
