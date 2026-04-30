import type { KeyEvent } from './hooks.js';

export interface ParseResult {
  events: KeyEvent[];
  remainder: string;
}

const ASCII_PRINTABLE_MIN = 0x20;
const ASCII_PRINTABLE_MAX = 0x7e;

function isAsciiUppercase(ch: string): boolean {
  return ch.length === 1 && ch >= 'A' && ch <= 'Z';
}

export function parse(input: string): ParseResult {
  const events: KeyEvent[] = [];
  let i = 0;
  while (i < input.length) {
    const cp = input.codePointAt(i);
    if (cp === undefined) break;
    const ch = String.fromCodePoint(cp);
    const advance = ch.length;

    if (cp === 0x00) {
      events.push({
        ch: ' ',
        ctrl: true,
        alt: false,
        shift: false,
        sequence: ch,
      });
      i += advance;
      continue;
    }
    if (cp >= 0x01 && cp <= 0x1a) {
      events.push({
        ch: String.fromCharCode(0x60 + cp),
        ctrl: true,
        alt: false,
        shift: false,
        sequence: ch,
      });
      i += advance;
      continue;
    }

    if (cp >= ASCII_PRINTABLE_MIN && cp <= ASCII_PRINTABLE_MAX) {
      events.push({
        ch,
        ctrl: false,
        alt: false,
        shift: isAsciiUppercase(ch),
        sequence: ch,
      });
      i += advance;
      continue;
    }

    events.push({
      ctrl: false,
      alt: false,
      shift: false,
      sequence: ch,
    });
    i += advance;
  }
  return { events, remainder: '' };
}
