/**
 * Text wrapping and truncation, wide-char and grapheme aware.
 *
 *   wrapText(text, width)         — return the lines a paragraph would occupy
 *                                   if wrapped at `width` cells. Word-boundary
 *                                   wrap by default; falls back to grapheme
 *                                   boundaries when a single word is wider
 *                                   than the line.
 *   truncateLine(line, width)     — single-line truncation with a trailing
 *                                   '…' that respects wide-char widths.
 *
 * Hard `\n` always forces a break.
 */

import { graphemes, stringWidth } from '@pilates/core';

const ELLIPSIS = '…';

export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [];

  const out: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      out.push('');
      continue;
    }
    out.push(...wrapParagraph(paragraph, width));
  }

  return out;
}

function wrapParagraph(text: string, width: number): string[] {
  const lines: string[] = [];
  // Tokenize into runs of (whitespace | word) preserving order.
  const tokens = tokenize(text);
  let current = '';
  let currentWidth = 0;

  for (const tok of tokens) {
    const tokWidth = stringWidth(tok.text);
    if (tok.isWhitespace) {
      // Trailing whitespace at end of line is fine — only emit if the next
      // word fits. Reserve the space for now; we'll consume it when adding
      // the next word.
      if (currentWidth + tokWidth <= width) {
        current += tok.text;
        currentWidth += tokWidth;
      } else {
        // Wrap; whitespace at the wrap point is dropped. Skip the push
        // when `current` is empty so over-long leading whitespace
        // (e.g. five spaces at width=4) doesn't emit a phantom blank
        // line before the first word.
        if (current.length > 0) lines.push(current);
        current = '';
        currentWidth = 0;
      }
      continue;
    }
    // Word token.
    if (tokWidth > width) {
      // Break the word at grapheme boundaries.
      if (current.length > 0) {
        lines.push(current);
        current = '';
        currentWidth = 0;
      }
      const chunks = splitWord(tok.text, width);
      for (let i = 0; i < chunks.length - 1; i++) lines.push(chunks[i]!);
      current = chunks[chunks.length - 1]!;
      currentWidth = stringWidth(current);
      continue;
    }
    if (currentWidth + tokWidth <= width) {
      current += tok.text;
      currentWidth += tokWidth;
    } else {
      lines.push(current);
      current = tok.text;
      currentWidth = tokWidth;
    }
  }
  if (current.length > 0 || lines.length === 0) {
    lines.push(current);
  }
  return lines;
}

interface Token {
  text: string;
  isWhitespace: boolean;
}

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    if (isWhitespaceChar(s[i]!)) {
      let j = i;
      while (j < s.length && isWhitespaceChar(s[j]!)) j++;
      out.push({ text: s.slice(i, j), isWhitespace: true });
      i = j;
    } else {
      let j = i;
      while (j < s.length && !isWhitespaceChar(s[j]!)) j++;
      out.push({ text: s.slice(i, j), isWhitespace: false });
      i = j;
    }
  }
  return out;
}

function isWhitespaceChar(c: string): boolean {
  return c === ' ' || c === '\t';
}

/** Break a word that exceeds `width` into chunks at grapheme boundaries. */
function splitWord(word: string, width: number): string[] {
  const out: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const g of graphemes(word)) {
    const w = stringWidth(g.text);
    if (currentWidth + w > width) {
      out.push(current);
      current = g.text;
      currentWidth = w;
    } else {
      current += g.text;
      currentWidth += w;
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

export function truncateLine(line: string, width: number): string {
  if (width <= 0) return '';
  if (stringWidth(line) <= width) return line;

  const ellipsisWidth = stringWidth(ELLIPSIS);
  const room = width - ellipsisWidth;
  if (room <= 0) return ELLIPSIS.slice(0, width); // best effort

  let out = '';
  let used = 0;
  for (const g of graphemes(line)) {
    const w = stringWidth(g.text);
    if (used + w > room) break;
    out += g.text;
    used += w;
  }
  return out + ELLIPSIS;
}
