import { mountWithInput } from '@pilates/react/test-utils';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
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
