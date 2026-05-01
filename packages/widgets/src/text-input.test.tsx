import { mountWithInput } from '@pilates/react/test-utils';
import { createElement, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TextInput } from './text-input.js';

const opts = { width: 20, height: 1 };

// Strip SGR (color/style) AND cursor-position codes — both appear in lastWrite/renderToString output.
function stripSGR(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
  const noSgr = s.replace(/\x1b\[[0-9;]*m/g, '');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
  const noCursorPos = noSgr.replace(/\x1b\[[0-9;]*[Hf]/g, '');
  return noCursorPos.replace(/\n$/, '');
}

describe('TextInput rendering', () => {
  it('renders the value with a cursor at index 0 by default', () => {
    const handle = mountWithInput(
      0,
      () => createElement(TextInput, { value: 'hello', onChange: () => {} }),
      opts,
    );
    const out = handle.lastWrite();
    expect(stripSGR(out).trim().startsWith('hello')).toBe(true);
    expect(out).toContain('\x1b[7m'); // SGR 7 = inverse (cursor)
    handle.unmount();
  });

  it('renders an inverse space when value is empty and focus=true', () => {
    const handle = mountWithInput(
      0,
      () => createElement(TextInput, { value: '', onChange: () => {} }),
      opts,
    );
    const out = handle.lastWrite();
    expect(out).toContain('\x1b[7m');
    handle.unmount();
  });

  it('renders the placeholder dimly when value is empty', () => {
    const handle = mountWithInput(
      0,
      () => createElement(TextInput, { value: '', onChange: () => {}, placeholder: 'type here' }),
      opts,
    );
    const out = handle.lastWrite();
    expect(stripSGR(out)).toContain('type here');
    // SGR 2 = dim; applyDiff may emit it standalone (\x1b[2m) or combined
    // with a reset (\x1b[0;2m) depending on style transitions.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to match
    expect(out).toMatch(/\x1b\[[0-9;]*2m/); // contains dim attribute
    handle.unmount();
  });

  it('omits the cursor entirely when focus=false', () => {
    const handle = mountWithInput(
      0,
      () => createElement(TextInput, { value: 'hello', onChange: () => {}, focus: false }),
      opts,
    );
    const out = handle.lastWrite();
    expect(stripSGR(out).trim().startsWith('hello')).toBe(true);
    expect(out).not.toContain('\x1b[7m');
    handle.unmount();
  });

  it('renders with mask when mask prop is provided', () => {
    const handle = mountWithInput(
      0,
      () => createElement(TextInput, { value: 'secret', onChange: () => {}, mask: '*' }),
      opts,
    );
    const out = handle.lastWrite();
    expect(stripSGR(out)).toContain('******');
    expect(stripSGR(out)).not.toContain('secret');
    handle.unmount();
  });

  it('throws when mask is not a single code unit', () => {
    expect(() =>
      mountWithInput(
        0,
        () => createElement(TextInput, { value: 'x', onChange: () => {}, mask: '**' }),
        opts,
      ),
    ).toThrow(/mask/i);
  });
});

// Helper: a controlled TextInput that manages its own value state internally.
// Using internal useState avoids calling handle.setState() from inside an
// onChange handler, which would nest act() calls and hang the test runner.
function ControlledTextInput({
  initial,
  onChangeSpy,
  focus,
}: {
  initial: string;
  onChangeSpy: (v: string) => void;
  focus?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return createElement(TextInput, {
    value,
    focus,
    onChange: (v: string) => {
      onChangeSpy(v);
      setValue(v);
    },
  });
}

describe('TextInput editing', () => {
  it('inserts a printable character at the cursor', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      null,
      () => createElement(ControlledTextInput, { initial: '', onChangeSpy: onChange }),
      opts,
    );
    // Cursor starts at 0, value is empty → typing 'a' gives 'a'.
    handle.pressChar('a');
    expect(onChange).toHaveBeenCalledWith('a');
    handle.unmount();
  });

  it('inserts characters in the middle when cursor is moved (cursor at 0 + insert)', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      null,
      () => createElement(ControlledTextInput, { initial: 'bc', onChangeSpy: onChange }),
      opts,
    );
    // Cursor starts at 0 → typing 'a' inserts before 'b'.
    handle.pressChar('a');
    expect(onChange).toHaveBeenCalledWith('abc');
    handle.unmount();
  });

  it('backspace deletes the char before the cursor (after insert advances cursor)', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      null,
      () => createElement(ControlledTextInput, { initial: 'a', onChangeSpy: onChange }),
      opts,
    );
    handle.pressChar('b'); // cursor=0 + initial='a' → inserts before 'a': value='ba', cursor=1
    handle.pressKey('backspace'); // cursor=1, deletes char at 0 → value='a'
    expect(onChange).toHaveBeenLastCalledWith('a');
    handle.unmount();
  });

  it('backspace at start of value is a no-op', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      null,
      () => createElement(ControlledTextInput, { initial: 'abc', onChangeSpy: onChange }),
      opts,
    );
    handle.pressKey('backspace');
    expect(onChange).not.toHaveBeenCalled();
    handle.unmount();
  });

  it('delete removes the char at the cursor', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      null,
      () => createElement(ControlledTextInput, { initial: 'abc', onChangeSpy: onChange }),
      opts,
    );
    // Cursor at 0 → delete removes 'a'.
    handle.pressKey('delete');
    expect(onChange).toHaveBeenLastCalledWith('bc');
    handle.unmount();
  });

  it('does not consume input when focus=false', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      null,
      () =>
        createElement(ControlledTextInput, { initial: 'abc', onChangeSpy: onChange, focus: false }),
      opts,
    );
    handle.pressChar('z');
    expect(onChange).not.toHaveBeenCalled();
    handle.unmount();
  });

  it('does not insert ctrl-modified printable characters', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      null,
      () => createElement(ControlledTextInput, { initial: 'abc', onChangeSpy: onChange }),
      opts,
    );
    handle.press({ ch: 'x', ctrl: true });
    expect(onChange).not.toHaveBeenCalled();
    handle.unmount();
  });
});
