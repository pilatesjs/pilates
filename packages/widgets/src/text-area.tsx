import { graphemes } from '@pilates/core';
import { Box, Text, useFocus, useInput, usePaste } from '@pilates/react';
import { type JSX, useState } from 'react';

export interface TextAreaProps {
  /** Controlled value. May contain `\n` line separators. Required. */
  value: string;
  /** Called on every value change. Required. */
  onChange: (value: string) => void;
  /** Rendered with `<Text dim>` when `value === ''`. */
  placeholder?: string;
  /**
   * Default true. When false, does not consume keystrokes and does not render
   * a cursor. Ignored when `focusId` is set — focus state then comes from
   * the `useFocus` registration instead.
   */
  focus?: boolean;
  /**
   * Register this textarea with `useFocus(id)` so the surrounding
   * `<FocusProvider>` (auto-installed by `render()`) can route Tab /
   * Shift+Tab cycling through it.
   */
  focusId?: string;
  /**
   * When `focusId` is set, take focus on mount if no other focusable
   * currently holds it.
   */
  autoFocus?: boolean;
}

// Outer column sizes to its children — the textarea auto-grows vertically
// with line count. Each row pins height: 1 so an empty line still occupies a
// terminal row (otherwise it would collapse to zero and visually disappear).
const COL: { flexDirection: 'column' } = { flexDirection: 'column' };
const ROW: { flexDirection: 'row'; height: 1 } = { flexDirection: 'row', height: 1 };

/**
 * Materialize a string as an array of grapheme clusters so cursor moves and
 * edits operate on user-perceived characters (emoji, ZWJ families, surrogate
 * pairs all stay intact). Mirrors the helper in `text-input.tsx`.
 */
function splitGraphemes(s: string): string[] {
  const out: string[] = [];
  for (const g of graphemes(s)) out.push(g.text);
  return out;
}

/**
 * Walk a grapheme list and split it on `\n` boundaries. Returns
 * one entry per line. The trailing `\n` is NOT included in the line text;
 * a value ending in `\n` produces a final empty line.
 */
function linesOf(gs: string[]): string[][] {
  const lines: string[][] = [[]];
  for (const g of gs) {
    if (g === '\n') {
      lines.push([]);
    } else {
      lines[lines.length - 1]!.push(g);
    }
  }
  return lines;
}

/**
 * Convert a flat grapheme cursor index to (row, col) coordinates. The newline
 * grapheme itself is "between" lines: an index pointing AT a `\n` resolves to
 * the end of the previous line; an index just past `\n` lands at column 0
 * of the next line.
 */
function cursorRowCol(gs: string[], cursor: number): { row: number; col: number } {
  let row = 0;
  let col = 0;
  for (let i = 0; i < cursor && i < gs.length; i++) {
    if (gs[i] === '\n') {
      row += 1;
      col = 0;
    } else {
      col += 1;
    }
  }
  return { row, col };
}

/** Inverse of `cursorRowCol` — find the flat grapheme index of (row, col). */
function indexAtRowCol(gs: string[], targetRow: number, targetCol: number): number {
  let row = 0;
  let col = 0;
  for (let i = 0; i < gs.length; i++) {
    if (row === targetRow && col === targetCol) return i;
    if (gs[i] === '\n') {
      if (row === targetRow) return i; // requested col exceeds line — clamp at \n
      row += 1;
      col = 0;
    } else {
      col += 1;
    }
  }
  return gs.length;
}

/** Length (in graphemes) of the line at index `row`. */
function lineLength(lines: string[][], row: number): number {
  return (lines[row] ?? []).length;
}

/**
 * <TextArea> — multi-line text input. v1 ships with a 1-D grapheme cursor
 * that walks across line boundaries, preserves newlines on paste, and
 * grows vertically with content. Word-wrap inside lines and scrolling
 * inside a fixed-height viewport are deferred to v2.
 */
export function TextArea({
  value,
  onChange,
  placeholder,
  focus = true,
  focusId,
  autoFocus,
}: TextAreaProps): JSX.Element {
  const focusReg = useFocus({
    ...(focusId !== undefined ? { id: focusId } : {}),
    autoFocus: focusId !== undefined && (autoFocus ?? false),
    isActive: focusId !== undefined,
  });
  const effectiveFocus = focusId !== undefined ? focusReg.isFocused : focus;

  const [cursor, setCursor] = useState(0);
  const gs = splitGraphemes(value);
  const totalGraphemes = gs.length;
  const clampedCursor = Math.min(cursor, totalGraphemes);
  const lines = linesOf(gs);
  const { row: cRow, col: cCol } = cursorRowCol(gs, clampedCursor);

  useInput(
    (event) => {
      // ── movement ────────────────────────────────────────────────────────
      if (event.name === 'left') {
        setCursor((c) => Math.max(0, Math.min(c, totalGraphemes) - 1));
        return;
      }
      if (event.name === 'right') {
        setCursor((c) => Math.min(totalGraphemes, c + 1));
        return;
      }
      if (event.name === 'up') {
        if (cRow === 0) return;
        const targetCol = Math.min(cCol, lineLength(lines, cRow - 1));
        setCursor(indexAtRowCol(gs, cRow - 1, targetCol));
        return;
      }
      if (event.name === 'down') {
        if (cRow >= lines.length - 1) return;
        const targetCol = Math.min(cCol, lineLength(lines, cRow + 1));
        setCursor(indexAtRowCol(gs, cRow + 1, targetCol));
        return;
      }
      if (event.name === 'home' || (event.ctrl && event.ch === 'a')) {
        setCursor(indexAtRowCol(gs, cRow, 0));
        return;
      }
      if (event.name === 'end' || (event.ctrl && event.ch === 'e')) {
        setCursor(indexAtRowCol(gs, cRow, lineLength(lines, cRow)));
        return;
      }

      // ── line edits ──────────────────────────────────────────────────────
      if (event.ctrl && event.ch === 'u') {
        // Clear from start of current line up to cursor.
        const lineStart = indexAtRowCol(gs, cRow, 0);
        if (lineStart === clampedCursor) return;
        const next = gs.slice(0, lineStart).join('') + gs.slice(clampedCursor).join('');
        setCursor(lineStart);
        onChange(next);
        return;
      }
      if (event.ctrl && event.ch === 'k') {
        // Clear from cursor to end of current line.
        const lineEnd = indexAtRowCol(gs, cRow, lineLength(lines, cRow));
        if (lineEnd === clampedCursor) return;
        const next = gs.slice(0, clampedCursor).join('') + gs.slice(lineEnd).join('');
        onChange(next);
        return;
      }
      if (event.ctrl && event.ch === 'w') {
        if (clampedCursor === 0) return;
        let i = clampedCursor;
        while (i > 0 && /\s/.test(gs[i - 1]!) && gs[i - 1]! !== '\n') i--;
        while (i > 0 && !/\s/.test(gs[i - 1]!)) i--;
        if (i === clampedCursor) return;
        const next = gs.slice(0, i).join('') + gs.slice(clampedCursor).join('');
        setCursor(i);
        onChange(next);
        return;
      }

      // ── single-grapheme edits ──────────────────────────────────────────
      if (event.name === 'backspace') {
        if (clampedCursor === 0) return;
        const next = gs.slice(0, clampedCursor - 1).join('') + gs.slice(clampedCursor).join('');
        setCursor(clampedCursor - 1);
        onChange(next);
        return;
      }
      if (event.name === 'delete') {
        if (clampedCursor >= totalGraphemes) return;
        const next = gs.slice(0, clampedCursor).join('') + gs.slice(clampedCursor + 1).join('');
        onChange(next);
        return;
      }

      // ── newline insertion ──────────────────────────────────────────────
      if (event.name === 'enter') {
        const next = `${gs.slice(0, clampedCursor).join('')}\n${gs.slice(clampedCursor).join('')}`;
        setCursor(clampedCursor + 1);
        onChange(next);
        return;
      }

      // Reject ctrl/alt-modified printables (reserved for shortcuts).
      if (event.ctrl || event.alt) return;

      // Printable insertion. event.ch may be a multi-grapheme string in
      // theory; advance by the number of clusters we actually inserted.
      if (event.ch !== undefined) {
        const insertedCount = splitGraphemes(event.ch).length;
        const next =
          gs.slice(0, clampedCursor).join('') + event.ch + gs.slice(clampedCursor).join('');
        setCursor(clampedCursor + insertedCount);
        onChange(next);
        return;
      }
    },
    { isActive: effectiveFocus },
  );

  // Bracketed paste preserves newlines (unlike <TextInput>) — multi-line
  // payloads are the whole point of TextArea.
  usePaste((text) => {
    if (!effectiveFocus) return;
    if (text.length === 0) return;
    const insertedCount = splitGraphemes(text).length;
    const next = gs.slice(0, clampedCursor).join('') + text + gs.slice(clampedCursor).join('');
    setCursor(clampedCursor + insertedCount);
    onChange(next);
  });

  // ── rendering ──────────────────────────────────────────────────────────

  // Empty value + focus: cursor on a blank cell (or first char of placeholder).
  if (totalGraphemes === 0) {
    if (!effectiveFocus) {
      if (placeholder) {
        return (
          <Box {...COL}>
            <Box {...ROW}>
              <Text dim>{placeholder}</Text>
            </Box>
          </Box>
        );
      }
      return <Box {...COL} />;
    }
    if (placeholder) {
      const phGs = splitGraphemes(placeholder);
      if (phGs.length > 0) {
        return (
          <Box {...COL}>
            <Box {...ROW}>
              <Text dim inverse>
                {phGs[0]!}
              </Text>
              <Text dim>{phGs.slice(1).join('')}</Text>
            </Box>
          </Box>
        );
      }
    }
    return (
      <Box {...COL}>
        <Box {...ROW}>
          <Text inverse> </Text>
        </Box>
      </Box>
    );
  }

  // Render one row Box per line, with the cursor inverse-rendered on the
  // appropriate cell of the current line.
  return (
    <Box {...COL}>
      {lines.map((lineGs, rowIdx) => renderLine(lineGs, rowIdx, cRow, cCol, effectiveFocus))}
    </Box>
  );
}

function renderLine(
  lineGs: string[],
  rowIdx: number,
  cursorRow: number,
  cursorCol: number,
  focus: boolean,
): JSX.Element {
  const isCursorRow = focus && rowIdx === cursorRow;
  const lineText = lineGs.join('');

  // React keys: row index is stable across edits within a session — values
  // shifting between rows is acceptable here since we re-render fully on
  // every edit anyway.
  const key = `row-${rowIdx}`;

  if (!isCursorRow) {
    if (lineText.length === 0) {
      // Empty line still needs a row Box so it occupies a cell of vertical space.
      return (
        <Box key={key} {...ROW}>
          <Text> </Text>
        </Box>
      );
    }
    return (
      <Box key={key} {...ROW}>
        <Text>{lineText}</Text>
      </Box>
    );
  }

  // Cursor row: split into prefix / cursor cell / suffix.
  if (cursorCol >= lineGs.length) {
    // Cursor at end of line — render line text then an inverse space.
    return (
      <Box key={key} {...ROW}>
        {lineText.length > 0 && <Text>{lineText}</Text>}
        <Text inverse> </Text>
      </Box>
    );
  }
  const prefix = lineGs.slice(0, cursorCol).join('');
  const cursorChar = lineGs[cursorCol]!;
  const suffix = lineGs.slice(cursorCol + 1).join('');
  return (
    <Box key={key} {...ROW}>
      {prefix.length > 0 && <Text>{prefix}</Text>}
      <Text inverse>{cursorChar}</Text>
      {suffix.length > 0 && <Text>{suffix}</Text>}
    </Box>
  );
}
