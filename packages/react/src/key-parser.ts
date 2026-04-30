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

    if (cp === 0x1b && input[i + 1] === '[') {
      const csiStart = i + 2;
      let csiEnd = csiStart;
      while (csiEnd < input.length) {
        const code = input.charCodeAt(csiEnd);
        if (code >= 0x40 && code <= 0x7e) break;
        csiEnd++;
      }
      if (csiEnd >= input.length) {
        return { events, remainder: input.slice(i) };
      }
      const params = input.slice(csiStart, csiEnd);
      const final = input[csiEnd]!;
      const sequence = input.slice(i, csiEnd + 1);
      const ev = decodeCsi(params, final, sequence);
      if (ev) events.push(ev);
      else events.push({ ctrl: false, alt: false, shift: false, sequence });
      i = csiEnd + 1;
      continue;
    }

    if (cp === 0x1b && input[i + 1] === 'O') {
      if (i + 2 >= input.length) {
        return { events, remainder: input.slice(i) };
      }
      const f = input[i + 2]!;
      const sequence = input.slice(i, i + 3);
      const map: Record<string, KeyEvent['name']> = { P: 'f1', Q: 'f2', R: 'f3', S: 'f4' };
      const name = map[f];
      if (name) {
        events.push({ name, ctrl: false, alt: false, shift: false, sequence });
      } else {
        events.push({ ctrl: false, alt: false, shift: false, sequence });
      }
      i += 3;
      continue;
    }

    if (cp === 0x1b) {
      if (i + 1 >= input.length) {
        events.push({ name: 'escape', ctrl: false, alt: false, shift: false, sequence: '\x1b' });
        i += 1;
        continue;
      }
      const next = input.codePointAt(i + 1);
      if (next === undefined) {
        events.push({ name: 'escape', ctrl: false, alt: false, shift: false, sequence: '\x1b' });
        i += 1;
        continue;
      }
      const nextCh = String.fromCodePoint(next);
      const sequence = '\x1b' + nextCh;
      if (next >= ASCII_PRINTABLE_MIN && next <= ASCII_PRINTABLE_MAX) {
        events.push({
          ch: nextCh,
          ctrl: false,
          alt: true,
          shift: isAsciiUppercase(nextCh),
          sequence,
        });
        i += 1 + nextCh.length;
        continue;
      }
      events.push({ ctrl: false, alt: false, shift: false, sequence });
      i += 1 + nextCh.length;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      events.push({ name: 'enter', ctrl: false, alt: false, shift: false, sequence: ch });
      i += advance;
      continue;
    }
    if (ch === '\t') {
      events.push({ name: 'tab', ctrl: false, alt: false, shift: false, sequence: ch });
      i += advance;
      continue;
    }
    if (ch === '\x7f' || ch === '\x08') {
      events.push({ name: 'backspace', ctrl: false, alt: false, shift: false, sequence: ch });
      i += advance;
      continue;
    }
    if (ch === ' ') {
      events.push({ name: 'space', ctrl: false, alt: false, shift: false, sequence: ch });
      i += advance;
      continue;
    }

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

function decodeCsi(params: string, final: string, sequence: string): KeyEvent | null {
  const base: Pick<KeyEvent, 'ctrl' | 'alt' | 'shift' | 'sequence'> = {
    ctrl: false,
    alt: false,
    shift: false,
    sequence,
  };

  if (final === 'A') return { ...base, name: 'up' };
  if (final === 'B') return { ...base, name: 'down' };
  if (final === 'C') return { ...base, name: 'right' };
  if (final === 'D') return { ...base, name: 'left' };
  if (final === 'H') return { ...base, name: 'home' };
  if (final === 'F') return { ...base, name: 'end' };

  if (final === '~') {
    const num = parseInt(params, 10);
    switch (num) {
      case 3: return { ...base, name: 'delete' };
      case 5: return { ...base, name: 'pageUp' };
      case 6: return { ...base, name: 'pageDown' };
      case 15: return { ...base, name: 'f5' };
      case 17: return { ...base, name: 'f6' };
      case 18: return { ...base, name: 'f7' };
      case 19: return { ...base, name: 'f8' };
      case 20: return { ...base, name: 'f9' };
      case 21: return { ...base, name: 'f10' };
      case 23: return { ...base, name: 'f11' };
      case 24: return { ...base, name: 'f12' };
      default: return null;
    }
  }

  return null;
}
