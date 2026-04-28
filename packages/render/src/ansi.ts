/**
 * ANSI Select Graphic Rendition (SGR) helpers.
 *
 * Color names map to standard 8-color (30-37) and bright (90-97) palettes.
 * Hex strings emit 24-bit (`38;2;R;G;B`). Numbers emit 256-color (`38;5;N`).
 *
 * `attrsCode(attrs)` builds an SGR string for a Cell's attribute bitmask.
 */

import type { Color, NamedColor } from './types.js';

export const Attr = {
  Bold: 1,
  Italic: 2,
  Underline: 4,
  Dim: 8,
  Inverse: 16,
} as const;

const NAMED_FG: Record<NamedColor, number> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
  brightBlue: 94,
  brightMagenta: 95,
  brightCyan: 96,
  brightWhite: 97,
};

/** SGR parameter sequence for a foreground color. */
export function fgSgr(c: Color): string {
  if (typeof c === 'number') return `38;5;${c | 0}`;
  if (typeof c === 'string') {
    if (c.startsWith('#')) {
      const [r, g, b] = parseHex(c);
      return `38;2;${r};${g};${b}`;
    }
    const code = NAMED_FG[c as NamedColor];
    if (code !== undefined) return String(code);
  }
  return '39'; // default fg fallback
}

/** SGR parameter sequence for a background color. */
export function bgSgr(c: Color): string {
  if (typeof c === 'number') return `48;5;${c | 0}`;
  if (typeof c === 'string') {
    if (c.startsWith('#')) {
      const [r, g, b] = parseHex(c);
      return `48;2;${r};${g};${b}`;
    }
    const code = NAMED_FG[c as NamedColor];
    if (code !== undefined) return String(code + 10);
  }
  return '49';
}

/** SGR parameter list for the active attributes in `attrs`. */
export function attrsSgr(attrs: number): string[] {
  const out: string[] = [];
  if (attrs & Attr.Bold) out.push('1');
  if (attrs & Attr.Dim) out.push('2');
  if (attrs & Attr.Italic) out.push('3');
  if (attrs & Attr.Underline) out.push('4');
  if (attrs & Attr.Inverse) out.push('7');
  return out;
}

function parseHex(s: string): [number, number, number] {
  // Accept #RGB, #RRGGBB.
  const hex = s.slice(1);
  if (hex.length === 3) {
    const r = Number.parseInt(hex[0]! + hex[0]!, 16);
    const g = Number.parseInt(hex[1]! + hex[1]!, 16);
    const b = Number.parseInt(hex[2]! + hex[2]!, 16);
    return [r, g, b];
  }
  if (hex.length === 6) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  return [0, 0, 0];
}

/** SGR reset. */
export const SGR_RESET = '\x1b[0m';
/** Build an SGR sequence from a list of parameters. */
export function sgr(params: string[]): string {
  if (params.length === 0) return '';
  return `\x1b[${params.join(';')}m`;
}

/** Pack TextStyle attribute booleans into a single bitmask. */
export function packAttrs(style: {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  inverse?: boolean;
}): number {
  let m = 0;
  if (style.bold) m |= Attr.Bold;
  if (style.italic) m |= Attr.Italic;
  if (style.underline) m |= Attr.Underline;
  if (style.dim) m |= Attr.Dim;
  if (style.inverse) m |= Attr.Inverse;
  return m;
}
