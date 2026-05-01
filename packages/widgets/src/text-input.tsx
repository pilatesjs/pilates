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
  /** If set, renders this character in place of every visible char. Single code unit only. */
  mask?: string;
  /** Default true. When false, does not consume keystrokes and does not render a cursor. */
  focus?: boolean;
}

/** Layout props shared across all rendered Box variants. */
const ROW: { flexDirection: 'row'; flexGrow: 1 } = { flexDirection: 'row', flexGrow: 1 };

export function TextInput({
  value,
  onChange,
  onSubmit: _onSubmit,
  placeholder,
  mask,
  focus = true,
}: TextInputProps): JSX.Element {
  if (mask !== undefined && mask.length !== 1) {
    throw new Error(
      `TextInput: mask must be a single code unit, got "${mask}" (length ${mask.length})`,
    );
  }

  const [cursor, setCursor] = useState(0);
  const clampedCursor = Math.min(cursor, value.length);

  useInput(
    (event) => {
      // Ctrl-modified printable chars are NOT inserted (reserved for shortcuts).
      if (event.ctrl) return;
      // Alt-modified printable chars are NOT inserted.
      if (event.alt) return;

      if (event.name === 'backspace') {
        if (clampedCursor === 0) return;
        const next = value.slice(0, clampedCursor - 1) + value.slice(clampedCursor);
        setCursor(clampedCursor - 1);
        onChange(next);
        return;
      }

      if (event.name === 'delete') {
        if (clampedCursor >= value.length) return;
        const next = value.slice(0, clampedCursor) + value.slice(clampedCursor + 1);
        onChange(next);
        return;
      }

      if (event.ch !== undefined) {
        // Printable char: insert at cursor.
        const next = value.slice(0, clampedCursor) + event.ch + value.slice(clampedCursor);
        setCursor(clampedCursor + 1);
        onChange(next);
        return;
      }
    },
    { isActive: focus },
  );

  // Empty value + focus: render only the cursor (or first cell of placeholder).
  if (value.length === 0) {
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
      return (
        <Box {...ROW}>
          <Text dim inverse>
            {placeholder[0]!}
          </Text>
          <Text dim>{placeholder.slice(1)}</Text>
        </Box>
      );
    }
    return (
      <Box {...ROW}>
        <Text inverse> </Text>
      </Box>
    );
  }

  const display = mask !== undefined ? mask.repeat(value.length) : value;

  if (!focus) {
    return (
      <Box {...ROW}>
        <Text>{display}</Text>
      </Box>
    );
  }

  // Focused with value: split into prefix / cursor char / suffix.
  if (clampedCursor >= display.length) {
    return (
      <Box {...ROW}>
        <Text>{display}</Text>
        <Text inverse> </Text>
      </Box>
    );
  }

  const prefix = display.slice(0, clampedCursor);
  const cursorChar = display[clampedCursor]!;
  const suffix = display.slice(clampedCursor + 1);

  return (
    <Box {...ROW}>
      {prefix.length > 0 && <Text>{prefix}</Text>}
      <Text inverse>{cursorChar}</Text>
      {suffix.length > 0 && <Text>{suffix}</Text>}
    </Box>
  );
}
