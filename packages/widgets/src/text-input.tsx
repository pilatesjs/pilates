import { graphemes } from '@pilates/core';
import { Box, Text, useInput } from '@pilates/react';
import { type JSX, useState } from 'react';

export interface TextInputProps {
  /** Controlled value. Required. */
  value: string;
  /** Called on every value change. Required. */
  onChange: (value: string) => void;
  /** Called on Enter. */
  onSubmit?: (value: string) => void;
  /** Rendered with `<Text dim>` when `value === ''`. */
  placeholder?: string;
  /** If set, renders this character in place of every visible grapheme. Single grapheme only. */
  mask?: string;
  /** Default true. When false, does not consume keystrokes and does not render a cursor. */
  focus?: boolean;
}

const ROW: { flexDirection: 'row'; flexGrow: 1 } = { flexDirection: 'row', flexGrow: 1 };

/**
 * Cursor and edit operations index by grapheme cluster, not by UTF-16 code
 * unit, so emoji and ZWJ sequences move/delete as a single user-perceived
 * character. This helper materializes the value as an array of grapheme
 * strings; for typical TUI inputs (a few dozen chars) the cost is trivial.
 */
function splitGraphemes(s: string): string[] {
  const out: string[] = [];
  for (const g of graphemes(s)) out.push(g.text);
  return out;
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  mask,
  focus = true,
}: TextInputProps): JSX.Element {
  if (mask !== undefined) {
    const maskGs = splitGraphemes(mask);
    if (maskGs.length !== 1) {
      throw new Error(
        `TextInput: mask must be a single grapheme, got "${mask}" (${maskGs.length} graphemes)`,
      );
    }
  }

  const [cursor, setCursor] = useState(0);
  const gs = splitGraphemes(value);
  const graphemeCount = gs.length;
  const clampedCursor = Math.min(cursor, graphemeCount);

  useInput(
    (event) => {
      if (event.name === 'enter') {
        onSubmit?.(value);
        return;
      }

      // Movement: named keys (work regardless of modifiers we care about).
      if (event.name === 'left') {
        setCursor((c) => Math.max(0, Math.min(c, graphemeCount) - 1));
        return;
      }
      if (event.name === 'right') {
        setCursor((c) => Math.min(graphemeCount, c + 1));
        return;
      }
      if (event.name === 'home') {
        setCursor(0);
        return;
      }
      if (event.name === 'end') {
        setCursor(graphemeCount);
        return;
      }

      // Ctrl shortcuts (movement).
      if (event.ctrl && event.ch === 'a') {
        setCursor(0);
        return;
      }
      if (event.ctrl && event.ch === 'e') {
        setCursor(graphemeCount);
        return;
      }

      // Ctrl shortcuts (line edits).
      if (event.ctrl && event.ch === 'u') {
        if (clampedCursor === 0) return;
        const next = gs.slice(clampedCursor).join('');
        setCursor(0);
        onChange(next);
        return;
      }

      if (event.ctrl && event.ch === 'k') {
        if (clampedCursor >= graphemeCount) return;
        const next = gs.slice(0, clampedCursor).join('');
        onChange(next);
        return;
      }

      if (event.ctrl && event.ch === 'w') {
        if (clampedCursor === 0) return;
        // Find the start of the previous word: scan left over whitespace, then over non-whitespace.
        let i = clampedCursor;
        while (i > 0 && /\s/.test(gs[i - 1]!)) i--;
        while (i > 0 && !/\s/.test(gs[i - 1]!)) i--;
        if (i === clampedCursor) return; // cursor was sitting in whitespace with nothing left → no-op
        const next = gs.slice(0, i).join('') + gs.slice(clampedCursor).join('');
        setCursor(i);
        onChange(next);
        return;
      }

      // Editing.
      if (event.name === 'backspace') {
        if (clampedCursor === 0) return;
        const next = gs.slice(0, clampedCursor - 1).join('') + gs.slice(clampedCursor).join('');
        setCursor(clampedCursor - 1);
        onChange(next);
        return;
      }

      if (event.name === 'delete') {
        if (clampedCursor >= graphemeCount) return;
        const next = gs.slice(0, clampedCursor).join('') + gs.slice(clampedCursor + 1).join('');
        onChange(next);
        return;
      }

      // Reject ctrl/alt-modified printables (reserved for shortcuts).
      if (event.ctrl || event.alt) return;

      // Printable insertion. `event.ch` may itself be a multi-grapheme string
      // (rare for raw stdin, but defensive); advance by however many graphemes
      // we actually inserted.
      if (event.ch !== undefined) {
        const insertedCount = splitGraphemes(event.ch).length;
        const next =
          gs.slice(0, clampedCursor).join('') + event.ch + gs.slice(clampedCursor).join('');
        setCursor(clampedCursor + insertedCount);
        onChange(next);
        return;
      }
    },
    { isActive: focus },
  );

  // Empty value + focus: render only the cursor (or first grapheme of placeholder).
  if (graphemeCount === 0) {
    if (!focus) {
      if (placeholder) {
        return (
          <Box {...ROW}>
            <Text dim>{placeholder}</Text>
          </Box>
        );
      }
      return <Box {...ROW} />;
    }
    if (placeholder) {
      const phGs = splitGraphemes(placeholder);
      if (phGs.length > 0) {
        return (
          <Box {...ROW}>
            <Text dim inverse>
              {phGs[0]!}
            </Text>
            <Text dim>{phGs.slice(1).join('')}</Text>
          </Box>
        );
      }
    }
    return (
      <Box {...ROW}>
        <Text inverse> </Text>
      </Box>
    );
  }

  const displayGs = mask !== undefined ? Array<string>(graphemeCount).fill(mask) : gs;
  const display = displayGs.join('');

  if (!focus) {
    return (
      <Box {...ROW}>
        <Text>{display}</Text>
      </Box>
    );
  }

  // Focused with value: split into prefix / cursor grapheme / suffix.
  if (clampedCursor >= graphemeCount) {
    return (
      <Box {...ROW}>
        <Text>{display}</Text>
        <Text inverse> </Text>
      </Box>
    );
  }

  const prefix = displayGs.slice(0, clampedCursor).join('');
  const cursorChar = displayGs[clampedCursor]!;
  const suffix = displayGs.slice(clampedCursor + 1).join('');

  return (
    <Box {...ROW}>
      {prefix.length > 0 && <Text>{prefix}</Text>}
      <Text inverse>{cursorChar}</Text>
      {suffix.length > 0 && <Text>{suffix}</Text>}
    </Box>
  );
}
