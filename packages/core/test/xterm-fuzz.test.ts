/**
 * Fuzz / oracle tests: compare our `stringWidth()` against the cell consumption
 * reported by @xterm/headless (a real xterm.js parser).
 *
 * We write the candidate string into a fresh, very-wide terminal and then read
 * `buffer.active.cursorX`. After a single line write with no embedded newlines,
 * cursorX equals the visible cell count.
 *
 * Two test sets:
 *   - AGREEMENT FIXTURES: cases where our model and xterm.js (Unicode 11) must
 *     return identical widths. These guard the layout algorithm against drift.
 *   - DIVERGENCE FIXTURES: cases where xterm.js's width is narrower than what
 *     modern terminals (kitty, WezTerm, iTerm2, Windows Terminal) actually
 *     render. We assert OUR expected width here; xterm.js's reading is logged
 *     for reference. These are documented, intentional choices.
 */

import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/headless';
import { describe, expect, it } from 'vitest';
import { stringWidth } from '../src/measure/width.js';

async function xtermWidth(s: string): Promise<number> {
  const term = new Terminal({ cols: 1000, rows: 1, allowProposedApi: true });
  // The addon types reference @xterm/xterm; @xterm/headless implements the
  // same Terminal interface so it works at runtime.
  // biome-ignore lint/suspicious/noExplicitAny: cross-package addon typing
  term.loadAddon(new Unicode11Addon() as any);
  term.unicode.activeVersion = '11';
  await new Promise<void>((res) => term.write(s, res));
  const x = term.buffer.active.cursorX;
  term.dispose();
  return x;
}

const AGREEMENT: ReadonlyArray<readonly [label: string, sample: string]> = [
  ['empty', ''],
  ['ascii short', 'hello'],
  ['ascii words', 'the quick brown fox'],
  ['CJK pair', '你好'],
  ['CJK sentence', '日本語のテスト'],
  ['mixed ASCII + CJK', 'hi 你好'],
  ['fullwidth latin', 'ＡＢＣ'],
  ['emoji single', '🔥'],
  ['emoji string', '🔥🚀⭐'],
  ['flag JP', '🇯🇵'],
  ['flags JP+US', '🇯🇵🇺🇸'],
  ['combining acute', 'café'],
  ['Hangul syllable', '한'],
  ['Hangul sentence', '안녕하세요'],
  ['emoji + ascii', 'hi 🔥 there'],
  ['CJK + emoji', '你好🔥'],
  ['ANSI styled CJK', '\x1b[1m你好\x1b[0m'],
];

/**
 * Cases where xterm.js (even with Unicode 11) returns a narrower width than
 * what modern terminals actually paint. We honor the modern interpretation.
 */
const DIVERGENCE: ReadonlyArray<readonly [label: string, sample: string, expected: number]> = [
  // VS16 promotes a default-text emoji to default-emoji presentation (2 cells).
  // xterm.js leaves it at 1.
  ['VS16 promoted heart', '❤️', 2],
  // ZWJ emoji families render as one 2-cell glyph in modern terminals;
  // xterm.js paints each component as a separate 2-cell glyph (3 × 2 = 6).
  ['ZWJ family', '👨‍👩‍👧', 2],
  ['ZWJ family + ascii', '👨‍👩‍👧 hi', 5],
];

describe('xterm.js width oracle — agreement set', () => {
  for (const [label, sample] of AGREEMENT) {
    it(label, async () => {
      const ours = stringWidth(sample);
      const theirs = await xtermWidth(sample);
      expect(ours).toBe(theirs);
    });
  }

  it('agrees on a randomized stream of safe codepoints', async () => {
    const pool: number[] = [];
    for (let cp = 0x21; cp <= 0x7e; cp++) pool.push(cp); // ASCII printable
    for (let cp = 0x4e00; cp <= 0x4eff; cp++) pool.push(cp); // CJK Unified subset
    for (let cp = 0x1f600; cp <= 0x1f64f; cp++) pool.push(cp); // emoticons block

    let state = 0xc0ffee;
    const rand = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state;
    };

    for (let i = 0; i < 200; i++) {
      const len = (rand() % 12) + 1;
      let s = '';
      for (let j = 0; j < len; j++) {
        const cp = pool[rand() % pool.length]!;
        s += String.fromCodePoint(cp);
      }
      const ours = stringWidth(s);
      const theirs = await xtermWidth(s);
      expect(ours, `mismatch on sample ${JSON.stringify(s)}`).toBe(theirs);
    }
  });
});

describe('xterm.js width oracle — documented divergences', () => {
  for (const [label, sample, expected] of DIVERGENCE) {
    it(label, async () => {
      const ours = stringWidth(sample);
      const theirs = await xtermWidth(sample);
      expect(ours).toBe(expected);
      // We expect xterm.js to disagree here; the assertion is informational.
      expect(theirs).not.toBe(expected);
    });
  }
});
