import { describe, expect, it } from 'vitest';
import { parseSgrMouse } from './mouse-parser.js';

describe('parseSgrMouse', () => {
  it('parses a left-button press', () => {
    const ev = parseSgrMouse('0;5;3', 'M', '\x1b[<0;5;3M');
    expect(ev).toMatchObject({
      button: 'left',
      col: 5,
      row: 3,
      pressed: true,
      ctrl: false,
      alt: false,
      shift: false,
    });
    expect(ev?.sequence).toBe('\x1b[<0;5;3M');
  });

  it('parses a left-button release', () => {
    const ev = parseSgrMouse('0;5;3', 'm', '\x1b[<0;5;3m');
    expect(ev).toMatchObject({ button: 'left', col: 5, row: 3, pressed: false });
  });

  it('parses a middle-button press', () => {
    expect(parseSgrMouse('1;5;3', 'M', '')).toMatchObject({ button: 'middle', pressed: true });
  });

  it('parses a right-button press', () => {
    expect(parseSgrMouse('2;5;3', 'M', '')).toMatchObject({ button: 'right', pressed: true });
  });

  it('parses wheel-up (Pb=64)', () => {
    expect(parseSgrMouse('64;5;3', 'M', '')).toMatchObject({ button: 'wheel-up', pressed: true });
  });

  it('parses wheel-down (Pb=65)', () => {
    expect(parseSgrMouse('65;5;3', 'M', '')).toMatchObject({ button: 'wheel-down', pressed: true });
  });

  it('parses mouse-move as button=none (Pb=35: motion bit + bits=3)', () => {
    expect(parseSgrMouse('35;5;3', 'M', '')).toMatchObject({ button: 'none' });
  });

  it('decodes shift modifier (bit 2 = 0x04)', () => {
    expect(parseSgrMouse('4;5;3', 'M', '')).toMatchObject({ shift: true, alt: false, ctrl: false });
  });

  it('decodes alt modifier (bit 3 = 0x08)', () => {
    expect(parseSgrMouse('8;5;3', 'M', '')).toMatchObject({ shift: false, alt: true, ctrl: false });
  });

  it('decodes ctrl modifier (bit 4 = 0x10)', () => {
    expect(parseSgrMouse('16;5;3', 'M', '')).toMatchObject({
      shift: false,
      alt: false,
      ctrl: true,
    });
  });

  it('decodes combined modifiers (ctrl+shift = 0x14)', () => {
    expect(parseSgrMouse('20;5;3', 'M', '')).toMatchObject({ shift: true, alt: false, ctrl: true });
  });

  it('has a no-op stopPropagation', () => {
    const ev = parseSgrMouse('0;1;1', 'M', '');
    expect(typeof ev?.stopPropagation).toBe('function');
    expect(() => ev?.stopPropagation()).not.toThrow();
  });

  it('returns null for wrong number of params', () => {
    expect(parseSgrMouse('0;5', 'M', '')).toBeNull();
    expect(parseSgrMouse('0;5;3;1', 'M', '')).toBeNull();
  });

  it('returns null for non-numeric params', () => {
    expect(parseSgrMouse('x;5;3', 'M', '')).toBeNull();
    expect(parseSgrMouse('0;y;3', 'M', '')).toBeNull();
  });
});
