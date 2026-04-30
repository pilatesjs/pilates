import { describe, expect, it } from 'vitest';
import { parse } from './key-parser.js';

describe('key-parser plain ASCII', () => {
  it('decodes single printable lowercase letter', () => {
    const { events, remainder } = parse('a');
    expect(events).toEqual([{ ch: 'a', ctrl: false, alt: false, shift: false, sequence: 'a' }]);
    expect(remainder).toBe('');
  });

  it('decodes single printable uppercase letter with shift=true', () => {
    const { events, remainder } = parse('A');
    expect(events).toEqual([{ ch: 'A', ctrl: false, alt: false, shift: true, sequence: 'A' }]);
    expect(remainder).toBe('');
  });

  it('decodes a run of printable chars as one event each', () => {
    const { events, remainder } = parse('hi!');
    expect(events.map((e) => e.ch)).toEqual(['h', 'i', '!']);
    expect(remainder).toBe('');
  });
});

describe('key-parser control bytes', () => {
  it('decodes ctrl+a as { ch: "a", ctrl: true }', () => {
    const { events } = parse('\x01');
    expect(events).toEqual([{ ch: 'a', ctrl: true, alt: false, shift: false, sequence: '\x01' }]);
  });

  it('decodes ctrl+z as { ch: "z", ctrl: true }', () => {
    const { events } = parse('\x1a');
    expect(events).toEqual([{ ch: 'z', ctrl: true, alt: false, shift: false, sequence: '\x1a' }]);
  });

  it('decodes ctrl+space (NUL byte) as { ch: " ", ctrl: true }', () => {
    const { events } = parse('\x00');
    expect(events).toEqual([{ ch: ' ', ctrl: true, alt: false, shift: false, sequence: '\x00' }]);
  });
});

describe('key-parser named specials', () => {
  it.each([
    ['\r', 'enter'],
    ['\n', 'enter'],
    ['\t', 'tab'],
    ['\x7f', 'backspace'],
    ['\x08', 'backspace'],
    [' ', 'space'],
  ] as const)('decodes %j as { name: %j }', (bytes, name) => {
    const { events } = parse(bytes);
    expect(events).toEqual([{ name, ctrl: false, alt: false, shift: false, sequence: bytes }]);
  });
});

describe('key-parser CSI navigation', () => {
  it.each([
    ['\x1b[A', 'up'],
    ['\x1b[B', 'down'],
    ['\x1b[C', 'right'],
    ['\x1b[D', 'left'],
    ['\x1b[H', 'home'],
    ['\x1b[F', 'end'],
    ['\x1b[5~', 'pageUp'],
    ['\x1b[6~', 'pageDown'],
    ['\x1b[3~', 'delete'],
  ] as const)('decodes %j as { name: %j }', (bytes, name) => {
    const { events, remainder } = parse(bytes);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name, ctrl: false, alt: false, shift: false });
    expect(remainder).toBe('');
  });
});

describe('key-parser SS3 function keys', () => {
  it.each([
    ['\x1bOP', 'f1'],
    ['\x1bOQ', 'f2'],
    ['\x1bOR', 'f3'],
    ['\x1bOS', 'f4'],
  ] as const)('decodes %j as { name: %j }', (bytes, name) => {
    const { events, remainder } = parse(bytes);
    expect(events).toEqual([{ name, ctrl: false, alt: false, shift: false, sequence: bytes }]);
    expect(remainder).toBe('');
  });
});

describe('key-parser alt and lone-escape', () => {
  it('decodes lone ESC as { name: "escape" }', () => {
    const { events, remainder } = parse('\x1b');
    expect(events).toEqual([
      { name: 'escape', ctrl: false, alt: false, shift: false, sequence: '\x1b' },
    ]);
    expect(remainder).toBe('');
  });

  it('decodes ESC + lowercase letter as alt+letter', () => {
    const { events } = parse('\x1ba');
    expect(events).toEqual([{ ch: 'a', ctrl: false, alt: true, shift: false, sequence: '\x1ba' }]);
  });

  it('decodes ESC + uppercase letter as alt+letter with shift=true', () => {
    const { events } = parse('\x1bA');
    expect(events).toEqual([{ ch: 'A', ctrl: false, alt: true, shift: true, sequence: '\x1bA' }]);
  });
});

describe('key-parser CSI modifier params', () => {
  it('decodes \x1b[1;5A as ctrl+up', () => {
    const { events } = parse('\x1b[1;5A');
    expect(events).toEqual([
      { name: 'up', ctrl: true, alt: false, shift: false, sequence: '\x1b[1;5A' },
    ]);
  });

  it('decodes \x1b[1;3D as alt+left', () => {
    const { events } = parse('\x1b[1;3D');
    expect(events).toEqual([
      { name: 'left', ctrl: false, alt: true, shift: false, sequence: '\x1b[1;3D' },
    ]);
  });

  it('decodes \x1b[1;2C as shift+right', () => {
    const { events } = parse('\x1b[1;2C');
    expect(events).toEqual([
      { name: 'right', ctrl: false, alt: false, shift: true, sequence: '\x1b[1;2C' },
    ]);
  });

  it('decodes \x1b[1;7B as ctrl+alt+down', () => {
    const { events } = parse('\x1b[1;7B');
    expect(events).toEqual([
      { name: 'down', ctrl: true, alt: true, shift: false, sequence: '\x1b[1;7B' },
    ]);
  });

  it('decodes \x1b[3;5~ as ctrl+delete', () => {
    const { events } = parse('\x1b[3;5~');
    expect(events).toEqual([
      { name: 'delete', ctrl: true, alt: false, shift: false, sequence: '\x1b[3;5~' },
    ]);
  });
});

describe('key-parser edge cases', () => {
  it('passes multi-byte UTF-8 (CJK) through ch unchanged', () => {
    const { events } = parse('日');
    expect(events).toHaveLength(1);
    expect(events[0]?.ch).toBe('日');
  });

  it('passes emoji through ch unchanged', () => {
    const { events } = parse('🎉');
    expect(events).toHaveLength(1);
    expect(events[0]?.ch).toBe('🎉');
  });

  it('returns partial CSI as remainder for the next chunk', () => {
    const { events, remainder } = parse('\x1b[');
    expect(events).toEqual([]);
    expect(remainder).toBe('\x1b[');
  });

  it('rejoins partial CSI across chunks', () => {
    const first = parse('\x1b[');
    expect(first.remainder).toBe('\x1b[');
    const second = parse(`${first.remainder}A`);
    expect(second.events).toEqual([
      { name: 'up', ctrl: false, alt: false, shift: false, sequence: '\x1b[A' },
    ]);
    expect(second.remainder).toBe('');
  });

  it('emits unrecognized CSI as a raw sequence event', () => {
    const { events } = parse('\x1b[99q');
    expect(events).toEqual([{ ctrl: false, alt: false, shift: false, sequence: '\x1b[99q' }]);
  });
});
