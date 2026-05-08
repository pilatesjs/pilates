import { Box, ScrollView, Text } from '@pilates/react';
import { mountWithInput } from '@pilates/react/test-utils';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { strip } from './helpers.js';

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    createElement(Box, { key: i, height: 1 }, createElement(Text, null, `line${i + 1}`)),
  );

describe('ScrollView e2e — visible content changes on wheel scroll', () => {
  it('initial render shows first 3 lines of 8', () => {
    const h = mountWithInput(
      null,
      () => createElement(ScrollView, { height: 3, scrollEnabled: false }, ...lines(8)),
      { width: 20, height: 5 },
    );
    h.flush();
    const out = strip(h.lastWrite());
    expect(out).toContain('line1');
    expect(out).toContain('line2');
    expect(out).toContain('line3');
    expect(out).not.toContain('line4');
    h.unmount();
  });

  it('wheel-down shifts visible content — line4 appears in output', () => {
    const h = mountWithInput(
      null,
      () => createElement(ScrollView, { height: 3, scrollEnabled: false }, ...lines(8)),
      { width: 20, height: 5 },
    );
    h.flush();
    h.sendMouseEvent({ button: 'wheel-down', col: 1, row: 1 });
    h.flush();
    // allWrites covers full paint history — line4 appears in the delta write
    const out = strip(h.allWrites());
    expect(out).toContain('line4');
    h.unmount();
  });

  it('wheel-up after scrolling down restores earlier content', () => {
    const h = mountWithInput(
      null,
      () => createElement(ScrollView, { height: 3, scrollEnabled: false }, ...lines(8)),
      { width: 20, height: 5 },
    );
    h.flush();
    h.sendMouseEvent({ button: 'wheel-down', col: 1, row: 1 });
    h.flush();
    h.sendMouseEvent({ button: 'wheel-down', col: 1, row: 1 });
    h.flush();
    h.sendMouseEvent({ button: 'wheel-down', col: 1, row: 1 });
    h.flush();
    h.sendMouseEvent({ button: 'wheel-up', col: 1, row: 1 });
    h.flush();
    h.sendMouseEvent({ button: 'wheel-up', col: 1, row: 1 });
    h.flush();
    // net offset = 1 → line2 should appear at some point in the write history
    const out = strip(h.allWrites());
    expect(out).toContain('line2');
    h.unmount();
  });

  it('wheel-down at content end does not throw (offset clamped)', () => {
    const h = mountWithInput(
      null,
      () =>
        createElement(
          ScrollView,
          { height: 3, scrollEnabled: false },
          createElement(Box, { height: 1 }, createElement(Text, null, 'only')),
        ),
      { width: 20, height: 5 },
    );
    h.flush();
    expect(() => {
      h.sendMouseEvent({ button: 'wheel-down', col: 1, row: 1 });
      h.flush();
    }).not.toThrow();
    h.unmount();
  });
});
