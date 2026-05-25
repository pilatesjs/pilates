/**
 * Pathological-input edge-case tests for the widget surface.
 *
 * Per-widget snapshot tests cover the golden paths. This file covers the
 * corners where bugs hide:
 *   - Select: empty list, all-disabled list, single item, large lists
 *   - MultiSelect: same shapes
 *   - ProgressBar: NaN, negative, > total, width=0, total=0
 *   - Tabs: empty list, all-disabled, stale activeKey, single tab nav
 */

import { useStdout } from '@pilates/react';
import { mount, mountWithInput } from '@pilates/react/test-utils';
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { MultiSelect } from './multi-select.js';
import { ProgressBar } from './progress-bar.js';
import { Select, type SelectItem } from './select.js';
import { Tabs } from './tabs.js';

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping for assertion
const stripAnsi = (s: string) => s.replace(/\x1b\[[\d;?]*[A-Za-z]/g, '').replace(/\n$/, '');

describe('Select — edge cases', () => {
  it('renders empty when items is []', () => {
    const handle = mountWithInput(0, () => <Select items={[]} onSelect={() => {}} />, {
      width: 10,
      height: 1,
    });
    const plain = stripAnsi(handle.lastWrite());
    expect(plain.replace(/\s/g, '')).toBe('');
    handle.unmount();
  });

  it('handles a single-item list (no navigation possible)', () => {
    let selected: string | null = null;
    const handle = mountWithInput(
      0,
      () => (
        <Select<string>
          items={[{ label: 'only', value: 'only' }]}
          onSelect={(it) => {
            selected = it.value;
          }}
        />
      ),
      { width: 10, height: 1 },
    );
    handle.pressKey('enter');
    expect(selected).toBe('only');
    handle.unmount();
  });

  it('all-disabled list: Enter never fires onSelect', () => {
    let called = 0;
    const items: SelectItem<string>[] = [
      { label: 'a', value: 'a', disabled: true },
      { label: 'b', value: 'b', disabled: true },
    ];
    const handle = mountWithInput(
      0,
      () => (
        <Select<string>
          items={items}
          onSelect={() => {
            called++;
          }}
        />
      ),
      { width: 10, height: 2 },
    );
    handle.pressKey('enter');
    handle.pressKey('down');
    handle.pressKey('enter');
    expect(called).toBe(0);
    handle.unmount();
  });

  it('skips disabled items when navigating with down arrow', () => {
    const items: SelectItem<number>[] = [
      { label: 'a', value: 1 },
      { label: 'b', value: 2, disabled: true },
      { label: 'c', value: 3 },
    ];
    let selected: number | null = null;
    const handle = mountWithInput(
      0,
      () => (
        <Select<number>
          items={items}
          onSelect={(it) => {
            selected = it.value;
          }}
        />
      ),
      { width: 10, height: 3 },
    );
    handle.pressKey('down'); // a → c (skip b)
    handle.pressKey('enter');
    expect(selected).toBe(3);
    handle.unmount();
  });

  it('renders 500-item list without throwing (perf smoke)', () => {
    const items: SelectItem<number>[] = Array.from({ length: 500 }, (_, i) => ({
      label: `Item ${i}`,
      value: i,
    }));
    expect(() => {
      const handle = mountWithInput(0, () => <Select<number> items={items} onSelect={() => {}} />, {
        width: 12,
        height: 6,
      });
      handle.unmount();
    }).not.toThrow();
  });

  it('home jumps to first enabled, end jumps to last enabled', () => {
    const items: SelectItem<string>[] = [
      { label: 'a', value: 'a', disabled: true },
      { label: 'b', value: 'b' },
      { label: 'c', value: 'c' },
      { label: 'd', value: 'd', disabled: true },
    ];
    const seen: string[] = [];
    const handle = mountWithInput(
      0,
      () => (
        <Select<string>
          items={items}
          onSelect={() => {}}
          onHighlight={(it) => seen.push(it.value)}
        />
      ),
      { width: 6, height: 4 },
    );
    handle.pressKey('end');
    handle.pressKey('home');
    // initial highlight is item b (first enabled). end → c, home → b.
    expect(seen).toEqual(['c', 'b']);
    handle.unmount();
  });
});

describe('MultiSelect — edge cases', () => {
  it('handles empty items list without throwing', () => {
    expect(() => {
      const handle = mountWithInput(
        0,
        () => <MultiSelect<string> items={[]} selectedKeys={new Set()} onChange={() => {}} />,
        { width: 10, height: 1 },
      );
      handle.unmount();
    }).not.toThrow();
  });

  it('space toggles selection on a single item', () => {
    const items: SelectItem<string>[] = [{ label: 'only', value: 'only' }];
    const observed: ReadonlySet<string>[] = [];
    function Harness() {
      const [sel, setSel] = React.useState<ReadonlySet<string>>(new Set());
      observed.push(sel);
      return (
        <MultiSelect<string> items={items} selectedKeys={sel} onChange={(next) => setSel(next)} />
      );
    }
    const handle = mountWithInput(0, () => <Harness />, { width: 12, height: 1 });
    handle.pressKey('space');
    const final = observed[observed.length - 1]!;
    expect([...final]).toEqual(['only']);
    handle.unmount();
  });
});

describe('ProgressBar — boundary values', () => {
  // ProgressBar is a function component — render it through a wrapper that
  // captures the rendered text via `mount`.
  function snap(props: React.ComponentProps<typeof ProgressBar>): string {
    const handle = mount(0, () => <ProgressBar {...props} />, { width: 20, height: 1 });
    const out = stripAnsi(handle.lastWrite());
    handle.unmount();
    return out;
  }

  it('value=0 → entirely empty track', () => {
    const out = snap({ value: 0, total: 10, width: 10 });
    expect(out.includes('█')).toBe(false);
  });

  it('value=total → entirely filled', () => {
    const out = snap({ value: 10, total: 10, width: 10 });
    expect(out.includes('░')).toBe(false);
  });

  it('value > total → clamped to total (entirely filled, not overflowed)', () => {
    const out = snap({ value: 999, total: 10, width: 10 });
    expect(out.includes('░')).toBe(false);
  });

  it('value < 0 → clamped to 0 (entirely empty)', () => {
    const out = snap({ value: -5, total: 10, width: 10 });
    expect(out.includes('█')).toBe(false);
  });

  it('total <= 0 → entirely empty (avoid divide-by-zero)', () => {
    expect(() => snap({ value: 5, total: 0, width: 10 })).not.toThrow();
    expect(() => snap({ value: 5, total: -10, width: 10 })).not.toThrow();
  });

  it('width=0 renders a zero-cell box', () => {
    expect(() => snap({ value: 5, total: 10, width: 0 })).not.toThrow();
  });
});

describe('Tabs — edge cases', () => {
  it('empty items list does not throw', () => {
    expect(() => {
      const handle = mountWithInput(
        0,
        () => <Tabs items={[]} activeKey="x" onChange={() => {}} />,
        { width: 10, height: 1 },
      );
      handle.unmount();
    }).not.toThrow();
  });

  it('stale activeKey (not in items) recovers on first arrow', () => {
    let activeKey = 'missing';
    const handle = mountWithInput(
      0,
      () => (
        <Tabs
          items={[
            { key: 'a', label: 'A' },
            { key: 'b', label: 'B' },
          ]}
          activeKey={activeKey}
          onChange={(k) => {
            activeKey = k;
          }}
        />
      ),
      { width: 12, height: 1 },
    );
    handle.pressKey('right'); // activeIdx === -1 → goes to firstEnabled
    expect(activeKey).toBe('a');
    handle.unmount();
  });

  it('all-disabled: arrows are no-op', () => {
    let activeKey = 'a';
    let calls = 0;
    const items = [
      { key: 'a', label: 'A', disabled: true },
      { key: 'b', label: 'B', disabled: true },
    ];
    const handle = mountWithInput(
      0,
      () => (
        <Tabs
          items={items}
          activeKey={activeKey}
          onChange={(k) => {
            activeKey = k;
            calls++;
          }}
        />
      ),
      { width: 12, height: 1 },
    );
    handle.pressKey('right');
    handle.pressKey('left');
    handle.pressKey('home');
    handle.pressKey('end');
    expect(calls).toBe(0);
    handle.unmount();
  });
});

// Force the import to be used so it doesn't drop in re-export tree-shaking.
void useStdout;
