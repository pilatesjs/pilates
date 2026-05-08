/**
 * Package pipeline smoke tests.
 *
 * One trivial mount per public package. No fake timers, no interaction, no
 * complex state. Goal: verify the full render pipeline (layout → paint →
 * string) of each package works end-to-end. Should complete in well under 2s.
 */

import { Node } from '@pilates/core';
import { Box, Text } from '@pilates/react';
import { renderToString } from '@pilates/react/test-utils';
import { render } from '@pilates/render';
import { Table } from '@pilates/widgets';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// @pilates/core — imperative Node API + calculateLayout
// ---------------------------------------------------------------------------

describe('@pilates/core smoke', () => {
  it('calculates layout for two flex-grow siblings', () => {
    const root = new Node();
    root.setWidth(20);
    root.setHeight(4);
    root.setFlexDirection('row');
    const a = new Node();
    a.setFlexGrow(1);
    const b = new Node();
    b.setFlexGrow(1);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();
    expect(a.getComputedLayout().width).toBe(10);
    expect(b.getComputedLayout().width).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// @pilates/render — declarative RenderNode → painted string
// RenderNode is duck-typed: { children } = container, { text } = leaf
// ---------------------------------------------------------------------------

describe('@pilates/render smoke', () => {
  it('renders a text leaf inside a container to non-empty output', () => {
    const out = render({ width: 10, height: 1, children: [{ text: 'hi' }] }, { ansi: false });
    expect(out).toContain('hi');
  });
});

// ---------------------------------------------------------------------------
// @pilates/react — React reconciler round-trip via renderToString
// ---------------------------------------------------------------------------

describe('@pilates/react smoke', () => {
  it('renders <Box><Text> to a string containing the text', () => {
    const el = createElement(Box, { width: 12, height: 1 }, createElement(Text, null, 'smoke'));
    const out = renderToString(el, { width: 12, height: 1 });
    expect(out).toContain('smoke');
  });
});

// ---------------------------------------------------------------------------
// @pilates/widgets — Table with one column and one row
// ---------------------------------------------------------------------------

describe('@pilates/widgets smoke', () => {
  it('renders Table header and cell text without crashing', () => {
    const el = createElement(Table<{ label: string }>, {
      columns: [{ key: 'label', header: 'Label', width: 8 }],
      rows: [{ label: 'ping' }],
    });
    const out = renderToString(el, { width: 20, height: 4 });
    expect(out).toContain('Label');
    expect(out).toContain('ping');
  });
});
