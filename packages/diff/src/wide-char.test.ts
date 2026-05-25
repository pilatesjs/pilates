/**
 * Wide-character + control-character behavior of @pilates/diff.
 *
 * `diff.test.ts` covers ASCII change emission and cursor-positioning.
 * This file adds:
 *   - Wide (CJK / emoji / ZWJ) graphemes: continuation slots are NEVER
 *     emitted as separate `CellChange`s; the leader is emitted with
 *     `width: 2` and the encoder advances the cursor by 2.
 *   - Locking the current "pass-through" behavior for control characters
 *     in `c.char` so a refactor that introduces escaping or filtering is
 *     an explicit decision.
 */

import { Frame } from '@pilates/render';
import { describe, expect, it } from 'vitest';
import { applyDiff } from './apply.js';
import { diff } from './diff.js';

function blankFrame(w: number, h: number): Frame {
  return new Frame(w, h);
}

describe('diff — wide graphemes', () => {
  it('a CJK character emits one CellChange with width: 2 (not two)', () => {
    const f = blankFrame(4, 1);
    f.setGrapheme(0, 0, '你', { attrs: 0 });
    const changes = diff(null, f);
    // Cell 0 = '你' (width 2), cell 2 = ' ', cell 3 = ' '. Continuation
    // cell at (1, 0) must not appear in changes.
    expect(changes.some((c) => c.x === 1 && c.y === 0)).toBe(false);
    const leader = changes.find((c) => c.x === 0 && c.y === 0)!;
    expect(leader.char).toBe('你');
    expect(leader.width).toBe(2);
  });

  it('a CJK string emits its leaders sequentially without continuation slots', () => {
    const f = blankFrame(6, 1);
    f.writeText(0, 0, '你好', { attrs: 0 });
    const changes = diff(null, f);
    const leaders = changes.filter((c) => c.char === '你' || c.char === '好');
    expect(leaders.map((c) => c.x).sort()).toEqual([0, 2]);
    // Continuation slots at x=1 and x=3 must not be emitted.
    expect(changes.some((c) => c.x === 1)).toBe(false);
    expect(changes.some((c) => c.x === 3)).toBe(false);
  });

  it('applyDiff advances the cursor by 2 after a wide grapheme — no redundant CSI between adjacent wide chars', () => {
    const f = blankFrame(6, 1);
    f.writeText(0, 0, '你好', { attrs: 0 });
    const ansi = applyDiff(diff(null, f));
    // Exactly one CSI cursor-position at the start of the row; the second
    // wide char follows the first without a re-positioning sequence.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we match
    const cursorMoves = ansi.match(/\x1b\[\d+;\d+H/g) ?? [];
    // Initial move + trailing-blank moves. Asserting no move between the
    // two CJK chars: index of '好' in ansi should be exactly len('你') after
    // index of '你' (modulo any SGR), no CSI sequence in between.
    const iNi = ansi.indexOf('你');
    const iHao = ansi.indexOf('好');
    expect(iNi).toBeGreaterThanOrEqual(0);
    expect(iHao).toBeGreaterThan(iNi);
    // Between iNi and iHao there must be no CSI cursor-position.
    const between = ansi.slice(iNi + '你'.length, iHao);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we match
    expect(between).not.toMatch(/\x1b\[\d+;\d+H/);
    void cursorMoves;
  });

  it('round-trip: writeText("emoji") → diff → applyDiff lands the emoji once', () => {
    // Emoji presentation: U+1F600 (😀) is a single grapheme cluster.
    const f = blankFrame(4, 1);
    f.writeText(0, 0, '😀', { attrs: 0 });
    const ansi = applyDiff(diff(null, f));
    // The emoji should appear exactly once in the output bytes.
    const occurrences = (ansi.match(/😀/gu) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('diff only emits changed wide grapheme on incremental update', () => {
    const prev = blankFrame(4, 1);
    prev.writeText(0, 0, '你好', { attrs: 0 });
    const next = blankFrame(4, 1);
    next.writeText(0, 0, '你界', { attrs: 0 });
    const changes = diff(prev, next);
    // Only the second wide grapheme changed (好 → 界 at x=2).
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual(expect.objectContaining({ x: 2, y: 0, char: '界', width: 2 }));
  });
});

describe('diff — control characters in cell.char (pass-through contract)', () => {
  it('passes ESC through cell.char verbatim (current contract — no escaping)', () => {
    // Setting a cell to a literal ESC byte should round-trip into the
    // diff output unchanged. Today there's no filter; this test pins
    // that behavior so a future "escape control chars" PR is an explicit
    // choice with a failing test to update.
    const f = blankFrame(2, 1);
    f.setCell(0, 0, {
      char: '\x1b',
      width: 1,
      fg: undefined,
      bg: undefined,
      attrs: 0,
    });
    const changes = diff(null, f);
    const c = changes.find((c) => c.x === 0)!;
    expect(c.char).toBe('\x1b');
  });

  it('newline character in cell.char also passes through', () => {
    const f = blankFrame(2, 1);
    f.setCell(0, 0, {
      char: '\n',
      width: 1,
      fg: undefined,
      bg: undefined,
      attrs: 0,
    });
    const changes = diff(null, f);
    expect(changes.find((c) => c.x === 0)!.char).toBe('\n');
  });
});

describe('diff — large frame stress', () => {
  it('handles a 100×40 frame full-repaint without blowing up', () => {
    const f = blankFrame(100, 40);
    for (let y = 0; y < 40; y++) {
      f.writeText(0, y, `row ${y} content`, { attrs: 0 });
    }
    const changes = diff(null, f);
    // 100 cells * 40 rows = 4000 max, minus continuation slots (none here, ASCII).
    expect(changes.length).toBe(100 * 40);
    const ansi = applyDiff(changes);
    expect(ansi.length).toBeGreaterThan(0);
  });

  it('handles a 100×40 frame with 50% cell churn', () => {
    const prev = blankFrame(100, 40);
    for (let y = 0; y < 40; y++) {
      prev.writeText(0, y, `original ${y}`, { attrs: 0 });
    }
    const next = blankFrame(100, 40);
    for (let y = 0; y < 40; y++) {
      next.writeText(0, y, y % 2 === 0 ? `changed ${y}` : `original ${y}`, { attrs: 0 });
    }
    const changes = diff(prev, next);
    // Roughly half the rows changed — exact count depends on prefix
    // overlap but should be in (0, full).
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.length).toBeLessThan(100 * 40);
  });
});
