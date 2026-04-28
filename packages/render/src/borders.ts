/**
 * Box-drawing characters for the supported border styles.
 *
 *     tl ───── tr
 *     │         │
 *     │         │
 *     bl ───── br
 *
 * Borders consume one cell on each side of a node. The painter accounts for
 * this by adding 1 to the node's effective padding when a border is set.
 */

import type { BorderStyle } from './types.js';

export interface BorderChars {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
}

const NONE: BorderChars = { tl: '', tr: '', bl: '', br: '', h: '', v: '' };

const SINGLE: BorderChars = {
  tl: '┌',
  tr: '┐',
  bl: '└',
  br: '┘',
  h: '─',
  v: '│',
};

const DOUBLE: BorderChars = {
  tl: '╔',
  tr: '╗',
  bl: '╚',
  br: '╝',
  h: '═',
  v: '║',
};

const ROUNDED: BorderChars = {
  tl: '╭',
  tr: '╮',
  bl: '╰',
  br: '╯',
  h: '─',
  v: '│',
};

const BOLD: BorderChars = {
  tl: '┏',
  tr: '┓',
  bl: '┗',
  br: '┛',
  h: '━',
  v: '┃',
};

const TABLE: Record<BorderStyle, BorderChars> = {
  none: NONE,
  single: SINGLE,
  double: DOUBLE,
  rounded: ROUNDED,
  bold: BOLD,
};

export function borderChars(style: BorderStyle): BorderChars {
  return TABLE[style];
}

/** Whether a given style draws any glyphs. */
export function hasBorder(style: BorderStyle | undefined): boolean {
  return style !== undefined && style !== 'none';
}
