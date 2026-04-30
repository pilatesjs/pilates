import { describe, expect, it } from 'vitest';
import { parse } from './key-parser.js';

describe('key-parser plain ASCII', () => {
  it('decodes single printable lowercase letter', () => {
    const { events, remainder } = parse('a');
    expect(events).toEqual([
      { ch: 'a', ctrl: false, alt: false, shift: false, sequence: 'a' },
    ]);
    expect(remainder).toBe('');
  });

  it('decodes single printable uppercase letter with shift=true', () => {
    const { events, remainder } = parse('A');
    expect(events).toEqual([
      { ch: 'A', ctrl: false, alt: false, shift: true, sequence: 'A' },
    ]);
    expect(remainder).toBe('');
  });

  it('decodes a run of printable chars as one event each', () => {
    const { events, remainder } = parse('hi!');
    expect(events.map((e) => e.ch)).toEqual(['h', 'i', '!']);
    expect(remainder).toBe('');
  });
});
