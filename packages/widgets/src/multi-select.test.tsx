import { mountWithInput } from '@pilates/react/test-utils';
import { Fragment, createElement, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MultiSelect } from './multi-select.js';
import type { SelectItem } from './select.js';

const opts = { width: 30, height: 5 };

function stripSGR(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
  const noSgr = s.replace(/\x1b\[[0-9;]*m/g, '');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
  return noSgr.replace(/\x1b\[[0-9;]*[Hf]/g, '').replace(/\n$/, '');
}

const items3: SelectItem<string>[] = [
  { label: 'Apple', value: 'apple' },
  { label: 'Banana', value: 'banana' },
  { label: 'Cherry', value: 'cherry' },
];

// Internal-state wrapper avoids calling handle.setState from inside an
// onChange callback, which would nest act() and deadlock under React 19.
function ControlledMultiSelect({
  initial,
  onChangeSpy,
  onSubmitSpy,
  items = items3,
  focus,
}: {
  initial: Set<string>;
  onChangeSpy?: (next: Set<string>) => void;
  onSubmitSpy?: (selected: SelectItem<string>[]) => void;
  items?: SelectItem<string>[];
  focus?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(initial);
  return createElement(MultiSelect<string>, {
    items,
    selectedKeys: selected,
    focus,
    onChange: (next: Set<string>) => {
      onChangeSpy?.(next);
      setSelected(next);
    },
    onSubmit: onSubmitSpy,
  });
}

describe('MultiSelect rendering', () => {
  it('renders all items with unchecked indicators by default', () => {
    const handle = mountWithInput(
      0,
      () => createElement(ControlledMultiSelect, { initial: new Set<string>() }),
      opts,
    );
    const out = stripSGR(handle.lastWrite());
    expect(out).toContain('Apple');
    expect(out).toContain('Banana');
    expect(out).toContain('Cherry');
    // Unchecked indicator marker present three times (once per row).
    expect(out.match(/☐/g)?.length).toBe(3);
    handle.unmount();
  });

  it('renders the checked indicator for items in selectedKeys', () => {
    const handle = mountWithInput(
      0,
      () => createElement(ControlledMultiSelect, { initial: new Set(['banana']) }),
      opts,
    );
    const out = stripSGR(handle.lastWrite());
    // Two unchecked + one checked.
    expect(out.match(/☐/g)?.length).toBe(2);
    expect(out.match(/☑/g)?.length).toBe(1);
    handle.unmount();
  });

  it('first non-disabled item is highlighted by default', () => {
    const handle = mountWithInput(
      0,
      () => createElement(ControlledMultiSelect, { initial: new Set<string>() }),
      opts,
    );
    const out = stripSGR(handle.lastWrite());
    // Default indicator uses ❯ for the highlighted row.
    expect(out).toContain('❯');
    handle.unmount();
  });

  it('omits all input handling when focus=false', () => {
    const onChange = vi.fn<(s: Set<string>) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledMultiSelect, {
          initial: new Set<string>(),
          onChangeSpy: onChange,
          focus: false,
        }),
      opts,
    );
    handle.pressKey('space');
    handle.pressKey('down');
    expect(onChange).not.toHaveBeenCalled();
    handle.unmount();
  });
});

describe('MultiSelect highlight navigation', () => {
  it('down arrow moves highlight forward (wraps at end)', () => {
    const onChange = vi.fn<(s: Set<string>) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledMultiSelect, {
          initial: new Set<string>(),
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('down');
    handle.pressKey('down');
    handle.pressKey('down'); // wraps back to first (apple)
    handle.pressKey('space');
    expect(onChange).toHaveBeenLastCalledWith(new Set(['apple']));
    handle.unmount();
  });

  it('up arrow moves highlight backward (wraps at start)', () => {
    const onChange = vi.fn<(s: Set<string>) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledMultiSelect, {
          initial: new Set<string>(),
          onChangeSpy: onChange,
        }),
      opts,
    );
    // Up from index 0 wraps to last (cherry).
    handle.pressKey('up');
    handle.pressKey('space');
    expect(onChange).toHaveBeenLastCalledWith(new Set(['cherry']));
    handle.unmount();
  });

  it('skips disabled items during navigation', () => {
    const onChange = vi.fn<(s: Set<string>) => void>();
    const itemsWithDisabled: SelectItem<string>[] = [
      { label: 'Apple', value: 'apple' },
      { label: 'Banana', value: 'banana', disabled: true },
      { label: 'Cherry', value: 'cherry' },
    ];
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledMultiSelect, {
          initial: new Set<string>(),
          items: itemsWithDisabled,
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('down'); // skips disabled Banana, lands on Cherry
    handle.pressKey('space');
    expect(onChange).toHaveBeenCalledWith(new Set(['cherry']));
    handle.unmount();
  });
});

describe('MultiSelect toggling', () => {
  it('Space toggles the highlighted item — adds when unselected', () => {
    const onChange = vi.fn<(s: Set<string>) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledMultiSelect, {
          initial: new Set<string>(),
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('space'); // selects Apple
    expect(onChange).toHaveBeenLastCalledWith(new Set(['apple']));
    handle.unmount();
  });

  it('Space toggles the highlighted item — removes when selected', () => {
    const onChange = vi.fn<(s: Set<string>) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledMultiSelect, {
          initial: new Set(['apple']),
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('space'); // deselects Apple
    expect(onChange).toHaveBeenLastCalledWith(new Set<string>());
    handle.unmount();
  });

  it('Space on a disabled highlighted item is a no-op', () => {
    // (highlight should never land on a disabled item via navigation, but
    //  if all enabled items are disabled mid-render this is still defensive.)
    const onChange = vi.fn<(s: Set<string>) => void>();
    const allDisabled: SelectItem<string>[] = [
      { label: 'Apple', value: 'apple', disabled: true },
      { label: 'Banana', value: 'banana', disabled: true },
    ];
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledMultiSelect, {
          initial: new Set<string>(),
          items: allDisabled,
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('space');
    expect(onChange).not.toHaveBeenCalled();
    handle.unmount();
  });

  it('toggling preserves prior selection of OTHER items', () => {
    const onChange = vi.fn<(s: Set<string>) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledMultiSelect, {
          initial: new Set(['cherry']),
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('space'); // adds 'apple' (highlight starts at apple)
    expect(onChange).toHaveBeenLastCalledWith(new Set(['cherry', 'apple']));
    handle.unmount();
  });
});

describe('MultiSelect submission', () => {
  it('Enter calls onSubmit with the list of selected items in items-order', () => {
    const onSubmit = vi.fn<(items: SelectItem<string>[]) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledMultiSelect, {
          initial: new Set(['cherry', 'apple']),
          onSubmitSpy: onSubmit,
        }),
      opts,
    );
    handle.pressKey('enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const args = onSubmit.mock.calls[0]![0];
    expect(args.map((i) => i.value)).toEqual(['apple', 'cherry']); // items order
    handle.unmount();
  });

  it('Enter with no selection calls onSubmit with an empty array', () => {
    const onSubmit = vi.fn<(items: SelectItem<string>[]) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledMultiSelect, {
          initial: new Set<string>(),
          onSubmitSpy: onSubmit,
        }),
      opts,
    );
    handle.pressKey('enter');
    expect(onSubmit).toHaveBeenCalledWith([]);
    handle.unmount();
  });

  it('Enter without onSubmit is a no-op (no throw)', () => {
    const handle = mountWithInput(
      0,
      () => createElement(ControlledMultiSelect, { initial: new Set(['apple']) }),
      opts,
    );
    expect(() => handle.pressKey('enter')).not.toThrow();
    handle.unmount();
  });
});

describe('MultiSelect focus integration', () => {
  it('Tab routes between two MultiSelects', () => {
    const onA = vi.fn<(s: Set<string>) => void>();
    const onB = vi.fn<(s: Set<string>) => void>();
    function ControlledA() {
      const [s, set] = useState<Set<string>>(new Set<string>());
      return createElement(MultiSelect<string>, {
        items: items3,
        selectedKeys: s,
        focusId: 'a',
        autoFocus: true,
        onChange: (n: Set<string>) => {
          onA(n);
          set(n);
        },
      });
    }
    function ControlledB() {
      const [s, set] = useState<Set<string>>(new Set<string>());
      return createElement(MultiSelect<string>, {
        items: items3,
        selectedKeys: s,
        focusId: 'b',
        onChange: (n: Set<string>) => {
          onB(n);
          set(n);
        },
      });
    }
    const handle = mountWithInput(
      0,
      () => createElement(Fragment, null, createElement(ControlledA), createElement(ControlledB)),
      opts,
    );
    handle.pressKey('space'); // toggles in A
    expect(onA).toHaveBeenLastCalledWith(new Set(['apple']));
    expect(onB).not.toHaveBeenCalled();
    handle.pressKey('tab');
    handle.pressKey('space'); // toggles in B
    expect(onB).toHaveBeenLastCalledWith(new Set(['apple']));
    handle.unmount();
  });
});
