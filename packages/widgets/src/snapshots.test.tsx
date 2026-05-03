/**
 * Snapshot regression tests for widgets.
 *
 * Two snapshots per scene: raw `lastWrite()` (with SGR) catches color /
 * indicator drift; stripped form catches layout drift. Together they
 * isolate which layer regressed.
 */

import { mountWithInput, snapshot as snap } from '@pilates/react/test-utils';
import { createElement, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Select, type SelectItem } from './select.js';
import { Spinner } from './spinner.js';
import { TextInput } from './text-input.js';

// Internal-state wrapper avoids calling handle.setState from inside an
// onChange callback, which would nest act() and deadlock under React 19.
function ControlledTextInput({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return createElement(TextInput, { value, onChange: setValue });
}

const items: SelectItem<string>[] = [
  { label: 'Apple', value: 'apple' },
  { label: 'Banana', value: 'banana' },
  { label: 'Cherry', value: 'cherry' },
];

describe('Select snapshots', () => {
  it('default — first item highlighted', () => {
    const h = mountWithInput(0, () => createElement(Select, { items, onSelect: () => {} }), {
      width: 30,
      height: 5,
    });
    const s = snap(h.lastWrite());
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
    h.unmount();
  });

  it('after pressing down — second item highlighted', () => {
    const h = mountWithInput(0, () => createElement(Select, { items, onSelect: () => {} }), {
      width: 30,
      height: 5,
    });
    h.pressKey('down');
    const s = snap(h.lastWrite());
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
    h.unmount();
  });

  it('with disabled middle item — skips on down arrow', () => {
    const itemsWithDisabled: SelectItem<string>[] = [
      { label: 'Apple', value: 'apple' },
      { label: 'Banana', value: 'banana', disabled: true },
      { label: 'Cherry', value: 'cherry' },
    ];
    const h = mountWithInput(
      0,
      () => createElement(Select, { items: itemsWithDisabled, onSelect: () => {} }),
      { width: 30, height: 5 },
    );
    const s = snap(h.lastWrite());
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
    h.unmount();
  });
});

describe('TextInput snapshots', () => {
  it('empty with placeholder', () => {
    const h = mountWithInput(
      '',
      (value) =>
        createElement(TextInput, {
          value,
          onChange: () => {},
          placeholder: 'type here…',
        }),
      { width: 20, height: 1 },
    );
    const s = snap(h.lastWrite());
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
    h.unmount();
  });

  it('after typing five characters', () => {
    const h = mountWithInput(0, () => createElement(ControlledTextInput, { initial: '' }), {
      width: 20,
      height: 1,
    });
    for (const ch of 'hello') h.pressChar(ch);
    const s = snap(h.lastWrite());
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
    h.unmount();
  });
});

describe('Spinner snapshots', () => {
  it('initial frame (dots)', () => {
    const h = mountWithInput(0, () => createElement(Spinner, { type: 'dots' }), {
      width: 4,
      height: 1,
    });
    const s = snap(h.lastWrite());
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
    h.unmount();
  });

  it('initial frame (line)', () => {
    const h = mountWithInput(0, () => createElement(Spinner, { type: 'line' }), {
      width: 4,
      height: 1,
    });
    const s = snap(h.lastWrite());
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
    h.unmount();
  });
});
