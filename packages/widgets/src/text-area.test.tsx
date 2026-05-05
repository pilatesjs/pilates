import { mountWithInput } from '@pilates/react/test-utils';
import { Fragment, act, createElement, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TextArea } from './text-area.js';

const opts = { width: 20, height: 5 };

function stripSGR(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
  const noSgr = s.replace(/\x1b\[[0-9;]*m/g, '');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
  return noSgr.replace(/\x1b\[[0-9;]*[Hf]/g, '').replace(/\n$/, '');
}

// emit raw bytes through fakeStdin while still flushing via act() — used for
// paste sequences (\x1b[200~ … \x1b[201~) and Shift+Tab that aren't covered
// by the press helpers.
function emitInAct(
  handle: { fakeStdin: { emit: (event: string, ...args: unknown[]) => boolean } },
  bytes: string,
) {
  const g = globalThis as Record<string, unknown>;
  const prev = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    act(() => {
      handle.fakeStdin.emit('data', bytes);
    });
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = prev;
  }
}

// Controlled wrapper: TextArea is value-controlled like TextInput, and
// running setValue from inside an onChange callback inside the test would
// nest act() and deadlock. Internal useState avoids that.
function ControlledTextArea({
  initial,
  onChangeSpy,
  focus,
  focusId,
  autoFocus,
  placeholder,
}: {
  initial: string;
  onChangeSpy: (v: string) => void;
  focus?: boolean;
  focusId?: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState(initial);
  return createElement(TextArea, {
    value,
    focus,
    focusId,
    autoFocus,
    placeholder,
    onChange: (v: string) => {
      onChangeSpy(v);
      setValue(v);
    },
  });
}

describe('TextArea rendering', () => {
  it('renders the value across multiple lines', () => {
    const handle = mountWithInput(
      0,
      () => createElement(TextArea, { value: 'line1\nline2\nline3', onChange: () => {} }),
      opts,
    );
    const out = stripSGR(handle.lastWrite());
    expect(out).toContain('line1');
    expect(out).toContain('line2');
    expect(out).toContain('line3');
    handle.unmount();
  });

  it('renders an inverse cursor on the cell at cursor position (default index 0)', () => {
    const handle = mountWithInput(
      0,
      () => createElement(TextArea, { value: 'hello', onChange: () => {} }),
      opts,
    );
    expect(handle.lastWrite()).toContain('\x1b[7m'); // SGR 7 = inverse
    handle.unmount();
  });

  it('renders an inverse space cursor when value is empty + focus=true', () => {
    const handle = mountWithInput(
      0,
      () => createElement(TextArea, { value: '', onChange: () => {} }),
      opts,
    );
    expect(handle.lastWrite()).toContain('\x1b[7m');
    handle.unmount();
  });

  it('renders the placeholder dimly when value is empty', () => {
    const handle = mountWithInput(
      0,
      () => createElement(TextArea, { value: '', onChange: () => {}, placeholder: 'note…' }),
      opts,
    );
    expect(stripSGR(handle.lastWrite())).toContain('note…');
    // SGR 2 = dim
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to match
    expect(handle.lastWrite()).toMatch(/\x1b\[[0-9;]*2m/);
    handle.unmount();
  });

  it('omits the cursor entirely when focus=false', () => {
    const handle = mountWithInput(
      0,
      () => createElement(TextArea, { value: 'hello', onChange: () => {}, focus: false }),
      opts,
    );
    expect(handle.lastWrite()).not.toContain('\x1b[7m');
    handle.unmount();
  });
});

describe('TextArea editing', () => {
  it('inserts a printable character at the cursor', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      0,
      () => createElement(ControlledTextArea, { initial: '', onChangeSpy: onChange }),
      opts,
    );
    handle.pressChar('a');
    expect(onChange).toHaveBeenLastCalledWith('a');
    handle.unmount();
  });

  it('Enter inserts a newline (does not call onSubmit; TextArea has none)', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      0,
      () => createElement(ControlledTextArea, { initial: 'a', onChangeSpy: onChange }),
      opts,
    );
    // Cursor starts at 0 (before 'a'). Pressing Enter should insert '\n' at index 0.
    handle.pressKey('enter');
    expect(onChange).toHaveBeenLastCalledWith('\na');
    handle.unmount();
  });

  it('backspace at start of a non-first line joins it with the previous line', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      0,
      () => createElement(ControlledTextArea, { initial: 'ab\ncd', onChangeSpy: onChange }),
      opts,
    );
    // Move cursor to start of line 2 (right past 'a', 'b', through '\n').
    handle.pressKey('right'); // cursor past 'a'
    handle.pressKey('right'); // cursor past 'b'
    handle.pressKey('right'); // cursor past '\n', at start of 'cd'
    handle.pressKey('backspace'); // removes '\n', joining lines
    expect(onChange).toHaveBeenLastCalledWith('abcd');
    handle.unmount();
  });

  it('delete at end of a non-last line joins it with the next line', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      0,
      () => createElement(ControlledTextArea, { initial: 'ab\ncd', onChangeSpy: onChange }),
      opts,
    );
    handle.pressKey('end'); // end of line 1 — cursor sits after 'b' (before '\n')
    handle.pressKey('delete'); // removes '\n', joining lines
    expect(onChange).toHaveBeenLastCalledWith('abcd');
    handle.unmount();
  });

  it('does not consume input when focus=false', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledTextArea, {
          initial: 'abc',
          onChangeSpy: onChange,
          focus: false,
        }),
      opts,
    );
    handle.pressChar('z');
    handle.pressKey('enter');
    expect(onChange).not.toHaveBeenCalled();
    handle.unmount();
  });
});

describe('TextArea cursor navigation', () => {
  it('right arrow moves across line boundaries', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      0,
      () => createElement(ControlledTextArea, { initial: 'a\nb', onChangeSpy: onChange }),
      opts,
    );
    // Cursor at 0 (before 'a'). Three right arrows: past 'a', past '\n', past 'b'.
    handle.pressKey('right');
    handle.pressKey('right');
    handle.pressKey('right');
    // Pressing 'X' now appends to the end of line 2.
    handle.pressChar('X');
    expect(onChange).toHaveBeenLastCalledWith('a\nbX');
    handle.unmount();
  });

  it('down arrow moves to the next line at the same column', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      0,
      () => createElement(ControlledTextArea, { initial: 'abc\ndef', onChangeSpy: onChange }),
      opts,
    );
    handle.pressKey('right'); // cursor at col 1 of line 1 (after 'a')
    handle.pressKey('down'); // cursor at col 1 of line 2 (after 'd')
    handle.pressChar('X');
    expect(onChange).toHaveBeenLastCalledWith('abc\ndXef');
    handle.unmount();
  });

  it('down arrow at the last line is a no-op', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      0,
      () => createElement(ControlledTextArea, { initial: 'abc', onChangeSpy: onChange }),
      opts,
    );
    handle.pressKey('right'); // col 1
    handle.pressKey('down'); // no-op (single line)
    handle.pressChar('X');
    expect(onChange).toHaveBeenLastCalledWith('aXbc');
    handle.unmount();
  });

  it('up arrow moves to previous line at the same column, clamping if shorter', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      0,
      () => createElement(ControlledTextArea, { initial: 'a\nbcd', onChangeSpy: onChange }),
      opts,
    );
    handle.pressKey('end'); // end of line 1 at col 1 (just after 'a')
    handle.pressKey('down'); // cursor at col 1 of line 2 (after 'b')
    handle.pressKey('right'); // col 2 (after 'c')
    handle.pressKey('right'); // col 3 (after 'd')
    handle.pressKey('up'); // line 1 col 3 → clamps to col 1 (line len)
    handle.pressChar('X');
    expect(onChange).toHaveBeenLastCalledWith('aX\nbcd');
    handle.unmount();
  });

  it('home/end move to start/end of current line, not full value', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      0,
      () => createElement(ControlledTextArea, { initial: 'abc\ndef', onChangeSpy: onChange }),
      opts,
    );
    handle.pressKey('down'); // cursor at line 2, col 0
    handle.pressKey('end'); // end of line 2 (after 'f')
    handle.pressChar('X');
    expect(onChange).toHaveBeenLastCalledWith('abc\ndefX');
    handle.unmount();
  });
});

describe('TextArea bracketed paste', () => {
  it('inserts pasted text including newlines verbatim (multi-line preserved)', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      0,
      () => createElement(ControlledTextArea, { initial: '', onChangeSpy: onChange }),
      opts,
    );
    emitInAct(handle, '\x1b[200~line1\nline2\x1b[201~');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('line1\nline2');
    handle.unmount();
  });

  it('paste at cursor: splits existing value', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      0,
      () => createElement(ControlledTextArea, { initial: 'AC', onChangeSpy: onChange }),
      opts,
    );
    handle.pressKey('right'); // cursor between A and C
    emitInAct(handle, '\x1b[200~B\nB\x1b[201~');
    expect(onChange).toHaveBeenLastCalledWith('AB\nBC');
    handle.unmount();
  });

  it('ignores paste when focus=false', () => {
    const onChange = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledTextArea, {
          initial: 'abc',
          onChangeSpy: onChange,
          focus: false,
        }),
      opts,
    );
    emitInAct(handle, '\x1b[200~XYZ\x1b[201~');
    expect(onChange).not.toHaveBeenCalled();
    handle.unmount();
  });
});

describe('TextArea focus integration', () => {
  it('Tab routes typing from one focused TextArea to the next', () => {
    const onA = vi.fn<(v: string) => void>();
    const onB = vi.fn<(v: string) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(
          Fragment,
          null,
          createElement(ControlledTextArea, {
            initial: '',
            onChangeSpy: onA,
            focusId: 'a',
            autoFocus: true,
          }),
          createElement(ControlledTextArea, {
            initial: '',
            onChangeSpy: onB,
            focusId: 'b',
          }),
        ),
      opts,
    );
    handle.pressChar('1');
    expect(onA).toHaveBeenLastCalledWith('1');
    expect(onB).not.toHaveBeenCalled();
    handle.pressKey('tab');
    handle.pressChar('2');
    expect(onB).toHaveBeenLastCalledWith('2');
    handle.unmount();
  });
});
