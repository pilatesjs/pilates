import { mountWithInput } from '@pilates/react/test-utils';
import { Fragment, createElement, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs, type TabsItem } from './tabs.js';

const opts = { width: 40, height: 1 };

function stripSGR(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
  const noSgr = s.replace(/\x1b\[[0-9;]*m/g, '');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
  return noSgr.replace(/\x1b\[[0-9;]*[Hf]/g, '').replace(/\n$/, '');
}

const items3: TabsItem[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'logs', label: 'Logs' },
  { key: 'settings', label: 'Settings' },
];

function ControlledTabs({
  initial,
  onChangeSpy,
  items = items3,
  focus,
}: {
  initial: string;
  onChangeSpy?: (next: string) => void;
  items?: TabsItem[];
  focus?: boolean;
}) {
  const [active, setActive] = useState(initial);
  return createElement(Tabs, {
    items,
    activeKey: active,
    focus,
    onChange: (k: string) => {
      onChangeSpy?.(k);
      setActive(k);
    },
  });
}

describe('Tabs rendering', () => {
  it('renders all tab labels in order', () => {
    const handle = mountWithInput(
      0,
      () => createElement(ControlledTabs, { initial: 'overview' }),
      opts,
    );
    const out = stripSGR(handle.lastWrite());
    const overviewIdx = out.indexOf('Overview');
    const logsIdx = out.indexOf('Logs');
    const settingsIdx = out.indexOf('Settings');
    expect(overviewIdx).toBeGreaterThanOrEqual(0);
    expect(logsIdx).toBeGreaterThan(overviewIdx);
    expect(settingsIdx).toBeGreaterThan(logsIdx);
    handle.unmount();
  });

  it('marks the active tab visually distinct from inactive tabs (cyan SGR)', () => {
    const handle = mountWithInput(
      0,
      () => createElement(ControlledTabs, { initial: 'overview' }),
      opts,
    );
    // SGR 36 = cyan foreground, used for active tab.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to match
    expect(handle.lastWrite()).toMatch(/\x1b\[[0-9;]*36m/);
    handle.unmount();
  });

  it('renders disabled tabs dimly', () => {
    const itemsWithDisabled: TabsItem[] = [
      { key: 'a', label: 'Aaa' },
      { key: 'b', label: 'Bbb', disabled: true },
    ];
    const handle = mountWithInput(
      0,
      () => createElement(ControlledTabs, { initial: 'a', items: itemsWithDisabled }),
      opts,
    );
    // SGR 2 = dim. Required for the disabled tab.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to match
    expect(handle.lastWrite()).toMatch(/\x1b\[[0-9;]*2m/);
    handle.unmount();
  });
});

describe('Tabs navigation', () => {
  it('right arrow advances active tab', () => {
    const onChange = vi.fn<(k: string) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledTabs, {
          initial: 'overview',
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('right');
    expect(onChange).toHaveBeenLastCalledWith('logs');
    handle.unmount();
  });

  it('left arrow retreats active tab', () => {
    const onChange = vi.fn<(k: string) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledTabs, {
          initial: 'logs',
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('left');
    expect(onChange).toHaveBeenLastCalledWith('overview');
    handle.unmount();
  });

  it('right arrow at last tab wraps to first', () => {
    const onChange = vi.fn<(k: string) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledTabs, {
          initial: 'settings',
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('right');
    expect(onChange).toHaveBeenLastCalledWith('overview');
    handle.unmount();
  });

  it('left arrow at first tab wraps to last', () => {
    const onChange = vi.fn<(k: string) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledTabs, {
          initial: 'overview',
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('left');
    expect(onChange).toHaveBeenLastCalledWith('settings');
    handle.unmount();
  });

  it('Home jumps to first enabled tab', () => {
    const onChange = vi.fn<(k: string) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledTabs, {
          initial: 'settings',
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('home');
    expect(onChange).toHaveBeenLastCalledWith('overview');
    handle.unmount();
  });

  it('End jumps to last enabled tab', () => {
    const onChange = vi.fn<(k: string) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledTabs, {
          initial: 'overview',
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('end');
    expect(onChange).toHaveBeenLastCalledWith('settings');
    handle.unmount();
  });

  it('right arrow skips disabled tabs', () => {
    const onChange = vi.fn<(k: string) => void>();
    const itemsWithDisabled: TabsItem[] = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B', disabled: true },
      { key: 'c', label: 'C' },
    ];
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledTabs, {
          initial: 'a',
          items: itemsWithDisabled,
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('right');
    expect(onChange).toHaveBeenLastCalledWith('c');
    handle.unmount();
  });

  it('does not change active tab when focus=false', () => {
    const onChange = vi.fn<(k: string) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledTabs, {
          initial: 'overview',
          onChangeSpy: onChange,
          focus: false,
        }),
      opts,
    );
    handle.pressKey('right');
    expect(onChange).not.toHaveBeenCalled();
    handle.unmount();
  });

  it('right arrow when only one enabled tab is a no-op', () => {
    const onChange = vi.fn<(k: string) => void>();
    const items: TabsItem[] = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B', disabled: true },
    ];
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledTabs, {
          initial: 'a',
          items,
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('right');
    expect(onChange).not.toHaveBeenCalled();
    handle.unmount();
  });
});

describe('Tabs activeKey edge cases', () => {
  it('renders cleanly when activeKey does not match any item (no crash, no active styling)', () => {
    const handle = mountWithInput(
      0,
      () =>
        createElement(Tabs, {
          items: items3,
          activeKey: 'unknown-key',
          onChange: () => {},
        }),
      opts,
    );
    // Labels still render; no item should be cyan.
    const out = stripSGR(handle.lastWrite());
    expect(out).toContain('Overview');
    handle.unmount();
  });

  it('right arrow with an unknown activeKey jumps to the first enabled tab', () => {
    const onChange = vi.fn<(k: string) => void>();
    const handle = mountWithInput(
      0,
      () =>
        createElement(ControlledTabs, {
          initial: 'unknown-key',
          onChangeSpy: onChange,
        }),
      opts,
    );
    handle.pressKey('right');
    expect(onChange).toHaveBeenLastCalledWith('overview');
    handle.unmount();
  });
});

describe('Tabs focus integration', () => {
  it('Tab routes between two Tabs strips', () => {
    const onA = vi.fn<(k: string) => void>();
    const onB = vi.fn<(k: string) => void>();
    function StripA() {
      const [k, setK] = useState('overview');
      return createElement(Tabs, {
        items: items3,
        activeKey: k,
        focusId: 'a',
        autoFocus: true,
        onChange: (next: string) => {
          onA(next);
          setK(next);
        },
      });
    }
    function StripB() {
      const [k, setK] = useState('overview');
      return createElement(Tabs, {
        items: items3,
        activeKey: k,
        focusId: 'b',
        onChange: (next: string) => {
          onB(next);
          setK(next);
        },
      });
    }
    const handle = mountWithInput(
      0,
      () => createElement(Fragment, null, createElement(StripA), createElement(StripB)),
      { width: 40, height: 2 },
    );
    handle.pressKey('right'); // moves A
    expect(onA).toHaveBeenLastCalledWith('logs');
    expect(onB).not.toHaveBeenCalled();
    handle.pressKey('tab');
    handle.pressKey('right'); // moves B
    expect(onB).toHaveBeenLastCalledWith('logs');
    handle.unmount();
  });
});
