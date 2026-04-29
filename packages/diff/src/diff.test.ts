import { Attr, Frame } from '@pilates/render';
import { describe, expect, it } from 'vitest';
import { diff } from './diff.js';

const PLAIN = { attrs: 0 };

describe('diff — full repaint', () => {
  it('emits every visible cell when prev is null', () => {
    const next = new Frame(3, 1);
    next.writeText(0, 0, 'abc', PLAIN);
    const changes = diff(null, next);
    expect(changes).toHaveLength(3);
    expect(changes.map((c) => c.char)).toEqual(['a', 'b', 'c']);
    expect(changes.map((c) => c.x)).toEqual([0, 1, 2]);
    expect(changes.every((c) => c.y === 0 && c.width === 1)).toBe(true);
  });

  it('emits every visible cell when widths differ', () => {
    const prev = new Frame(2, 1);
    const next = new Frame(3, 1);
    next.writeText(0, 0, 'xyz', PLAIN);
    const changes = diff(prev, next);
    expect(changes).toHaveLength(3);
  });

  it('emits every visible cell when heights differ', () => {
    const prev = new Frame(2, 1);
    const next = new Frame(2, 2);
    const changes = diff(prev, next);
    // Two rows of two blanks each — every cell counts in a full repaint.
    expect(changes).toHaveLength(4);
  });
});

describe('diff — incremental updates', () => {
  it('returns no changes when frames are identical', () => {
    const a = new Frame(4, 2);
    a.writeText(0, 0, 'hi', PLAIN);
    const b = new Frame(4, 2);
    b.writeText(0, 0, 'hi', PLAIN);
    expect(diff(a, b)).toEqual([]);
  });

  it('emits only the cell that changed', () => {
    const prev = new Frame(4, 1);
    prev.writeText(0, 0, 'abcd', PLAIN);
    const next = new Frame(4, 1);
    next.writeText(0, 0, 'abXd', PLAIN);

    const changes = diff(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ x: 2, y: 0, char: 'X', width: 1 });
  });

  it('emits a cell when the foreground color changes', () => {
    const prev = new Frame(2, 1);
    prev.writeText(0, 0, 'ab', PLAIN);
    const next = new Frame(2, 1);
    next.writeText(0, 0, 'a', PLAIN);
    next.writeText(1, 0, 'b', { fg: 'red', attrs: 0 });

    const changes = diff(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ x: 1, y: 0, char: 'b', fg: 'red' });
  });

  it('emits a cell when the background color changes', () => {
    const prev = new Frame(2, 1);
    prev.writeText(0, 0, 'ab', PLAIN);
    const next = new Frame(2, 1);
    next.writeText(0, 0, 'a', PLAIN);
    next.writeText(1, 0, 'b', { bg: 'blue', attrs: 0 });

    const changes = diff(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.bg).toBe('blue');
  });

  it('emits a cell when only the attribute bitmask changes', () => {
    const prev = new Frame(1, 1);
    prev.writeText(0, 0, 'a', PLAIN);
    const next = new Frame(1, 1);
    next.writeText(0, 0, 'a', { attrs: Attr.Bold });

    const changes = diff(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.attrs).toBe(Attr.Bold);
  });

  it('emits multiple non-contiguous changes in scan order', () => {
    const prev = new Frame(3, 2);
    prev.writeText(0, 0, 'abc', PLAIN);
    prev.writeText(0, 1, 'def', PLAIN);
    const next = new Frame(3, 2);
    next.writeText(0, 0, 'aXc', PLAIN); // change at (1, 0)
    next.writeText(0, 1, 'dYf', PLAIN); // change at (1, 1)

    const changes = diff(prev, next);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ x: 1, y: 0, char: 'X' });
    expect(changes[1]).toMatchObject({ x: 1, y: 1, char: 'Y' });
  });
});

describe('diff — wide characters', () => {
  it('emits the leading slot with width 2 and skips the continuation slot', () => {
    const prev = new Frame(4, 1);
    prev.writeText(0, 0, '....', PLAIN);
    const next = new Frame(4, 1);
    next.writeText(0, 0, '你..', PLAIN); // 你 = 2 cells, then '.', '.'

    const changes = diff(prev, next);
    // Cell (0): leader, width 2, char 你 — emitted.
    // Cell (1): continuation (width 0) — skipped.
    // Cells (2), (3): unchanged '.' — skipped.
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ x: 0, y: 0, char: '你', width: 2 });
  });

  it('emits a wide cell when its style changes even if the char is the same', () => {
    const prev = new Frame(2, 1);
    prev.writeText(0, 0, '世', PLAIN);
    const next = new Frame(2, 1);
    next.writeText(0, 0, '世', { fg: 'cyan', attrs: 0 });

    const changes = diff(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ x: 0, y: 0, char: '世', width: 2, fg: 'cyan' });
  });

  it('replaces an empty leading char with a space in the emitted change', () => {
    // Frames freshly constructed have empty cells whose char is ' ' already,
    // but if a Cell's char is '' for any reason (other than width-0), the
    // diff payload should normalize to a single space — terminals would
    // otherwise advance the cursor with no glyph written.
    const prev = null;
    const next = new Frame(1, 1);
    next.setCell(0, 0, { char: '', width: 1, fg: undefined, bg: undefined, attrs: 0 });

    const changes = diff(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.char).toBe(' ');
  });
});

describe('diff — degenerate frames', () => {
  it('produces no changes for a zero-size frame', () => {
    expect(diff(null, new Frame(0, 0))).toEqual([]);
    expect(diff(null, new Frame(0, 5))).toEqual([]);
    expect(diff(null, new Frame(5, 0))).toEqual([]);
  });
});
