import { mountWithInput } from '@pilates/react/test-utils';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Select, type SelectItem } from './select.js';

const opts = { width: 30, height: 5 };

function stripSGR(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
  const noSgr = s.replace(/\x1b\[[0-9;]*m/g, '');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
  const noCursorPos = noSgr.replace(/\x1b\[[0-9;]*[Hf]/g, '');
  return noCursorPos.replace(/\n$/, '');
}

const items3: SelectItem<string>[] = [
  { label: 'Apple', value: 'apple' },
  { label: 'Banana', value: 'banana' },
  { label: 'Cherry', value: 'cherry' },
];

describe('Select rendering', () => {
  it('renders all item labels', () => {
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items: items3, onSelect: () => {} }),
      opts,
    );
    const out = stripSGR(handle.lastWrite());
    expect(out).toContain('Apple');
    expect(out).toContain('Banana');
    expect(out).toContain('Cherry');
    handle.unmount();
  });

  it('marks the highlighted (first) item with the default indicator', () => {
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items: items3, onSelect: () => {} }),
      opts,
    );
    expect(stripSGR(handle.lastWrite())).toContain('❯ Apple');
    handle.unmount();
  });

  it('respects initialIndex', () => {
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items: items3, onSelect: () => {}, initialIndex: 1 }),
      opts,
    );
    expect(stripSGR(handle.lastWrite())).toContain('❯ Banana');
    handle.unmount();
  });

  it('clamps initialIndex past the first non-disabled item', () => {
    const items = [
      { label: 'A', value: 'a', disabled: true },
      { label: 'B', value: 'b' },
      { label: 'C', value: 'c' },
    ];
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items, onSelect: () => {}, initialIndex: 0 }),
      opts,
    );
    expect(stripSGR(handle.lastWrite())).toContain('❯ B');
    handle.unmount();
  });

  it('renders disabled items with the non-highlighted indicator and dim styling', () => {
    const items = [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b', disabled: true },
    ];
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items, onSelect: () => {} }),
      opts,
    );
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to match
    expect(handle.lastWrite()).toMatch(/\x1b\[[0-9;]*2m/); // SGR 2 = dim
    expect(stripSGR(handle.lastWrite())).toContain('B');
    handle.unmount();
  });

  it('uses a custom indicator function when provided', () => {
    const indicator = ({ isHighlighted }: { isHighlighted: boolean }) =>
      createElement('pilates-text', null, isHighlighted ? '>>' : '..');
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items: items3, onSelect: () => {}, indicator }),
      opts,
    );
    const out = stripSGR(handle.lastWrite());
    expect(out).toContain('>>Apple');
    expect(out).toContain('..Banana');
    handle.unmount();
  });

  it('renders no item content for an empty items array', () => {
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items: [], onSelect: () => {} }),
      opts,
    );
    const stripped = stripSGR(handle.lastWrite());
    expect(stripped).not.toContain('❯');
    for (const item of items3) expect(stripped).not.toContain(item.label);
    handle.unmount();
  });

  it('renders all items as non-highlighted when every item is disabled', () => {
    const items = [
      { label: 'A', value: 'a', disabled: true },
      { label: 'B', value: 'b', disabled: true },
    ];
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items, onSelect: () => {} }),
      opts,
    );
    const stripped = stripSGR(handle.lastWrite());
    expect(stripped).not.toContain('❯');
    expect(stripped).toContain('A');
    expect(stripped).toContain('B');
    handle.unmount();
  });
});
