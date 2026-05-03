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

describe('Select navigation', () => {
  it('down arrow moves highlight to the next item', () => {
    const onHighlight = vi.fn();
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items: items3, onSelect: () => {}, onHighlight }),
      opts,
    );
    handle.pressKey('down');
    expect(onHighlight).toHaveBeenLastCalledWith(items3[1]);
    handle.unmount();
  });

  it('up arrow at top wraps to the bottom', () => {
    const onHighlight = vi.fn();
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items: items3, onSelect: () => {}, onHighlight }),
      opts,
    );
    handle.pressKey('up');
    expect(onHighlight).toHaveBeenLastCalledWith(items3[2]);
    handle.unmount();
  });

  it('down arrow at bottom wraps to the top', () => {
    const onHighlight = vi.fn();
    const handle = mountWithInput(
      0,
      () =>
        createElement(Select, { items: items3, onSelect: () => {}, onHighlight, initialIndex: 2 }),
      opts,
    );
    handle.pressKey('down');
    expect(onHighlight).toHaveBeenLastCalledWith(items3[0]);
    handle.unmount();
  });

  it('skips disabled items when navigating down', () => {
    const items = [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b', disabled: true },
      { label: 'C', value: 'c' },
    ];
    const onHighlight = vi.fn();
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items, onSelect: () => {}, onHighlight }),
      opts,
    );
    handle.pressKey('down');
    expect(onHighlight).toHaveBeenLastCalledWith(items[2]);
    handle.unmount();
  });

  it('home goes to the first non-disabled item', () => {
    const items = [
      { label: 'A', value: 'a', disabled: true },
      { label: 'B', value: 'b' },
      { label: 'C', value: 'c' },
    ];
    const onHighlight = vi.fn();
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items, onSelect: () => {}, onHighlight, initialIndex: 2 }),
      opts,
    );
    handle.pressKey('home');
    expect(onHighlight).toHaveBeenLastCalledWith(items[1]);
    handle.unmount();
  });

  it('end goes to the last non-disabled item', () => {
    const items = [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
      { label: 'C', value: 'c', disabled: true },
    ];
    const onHighlight = vi.fn();
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items, onSelect: () => {}, onHighlight }),
      opts,
    );
    handle.pressKey('end');
    expect(onHighlight).toHaveBeenLastCalledWith(items[1]);
    handle.unmount();
  });

  it('does not consume input when focus=false', () => {
    const onHighlight = vi.fn();
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items: items3, focus: false, onSelect: () => {}, onHighlight }),
      opts,
    );
    handle.pressKey('down');
    expect(onHighlight).not.toHaveBeenCalled();
    handle.unmount();
  });
});

describe('Select selection', () => {
  it('Enter calls onSelect with the highlighted item', () => {
    const onSelect = vi.fn();
    const handle = mountWithInput(
      0,
      () => createElement(Select, { items: items3, onSelect }),
      opts,
    );
    handle.pressKey('down');
    handle.pressKey('enter');
    expect(onSelect).toHaveBeenCalledWith(items3[1]);
    handle.unmount();
  });

  it('Enter on a disabled item is a no-op', () => {
    const items = [
      { label: 'A', value: 'a', disabled: true },
      { label: 'B', value: 'b', disabled: true },
    ];
    const onSelect = vi.fn();
    const handle = mountWithInput(0, () => createElement(Select, { items, onSelect }), opts);
    handle.pressKey('enter');
    expect(onSelect).not.toHaveBeenCalled();
    handle.unmount();
  });

  it('Enter is a no-op for an empty items array', () => {
    const onSelect = vi.fn();
    const handle = mountWithInput(0, () => createElement(Select, { items: [], onSelect }), opts);
    handle.pressKey('enter');
    expect(onSelect).not.toHaveBeenCalled();
    handle.unmount();
  });
});

describe('Select reactivity to items prop changes', () => {
  it('re-clamps highlight when items shrink past the current index', () => {
    const items5: SelectItem<string>[] = [
      { label: 'Apple', value: 'apple' },
      { label: 'Banana', value: 'banana' },
      { label: 'Cherry', value: 'cherry' },
      { label: 'Date', value: 'date' },
      { label: 'Elderberry', value: 'elderberry' },
    ];
    const items2 = items5.slice(0, 2);
    const onSelect = vi.fn();
    const handle = mountWithInput<{ shrunk: boolean }>(
      { shrunk: false },
      (state) =>
        createElement(Select, {
          items: state.shrunk ? items2 : items5,
          onSelect,
        }),
      opts,
    );
    handle.pressKey('end');
    // Highlight is now on Elderberry (index 4). Shrink list to 2 items.
    handle.setState({ shrunk: true });
    // Without re-clamping, Enter is a silent no-op (highlightIndex = 4 ≥ 2)
    // and no row shows as highlighted in the rendered output.
    expect(stripSGR(handle.lastWrite())).toContain('❯');
    handle.pressKey('enter');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(['apple', 'banana']).toContain(onSelect.mock.calls[0]![0].value);
    handle.unmount();
  });
});
