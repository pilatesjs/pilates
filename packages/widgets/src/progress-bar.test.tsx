import { mountWithInput, renderToString, snapshot as snap } from '@pilates/react/test-utils';
import { act, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ProgressBar } from './progress-bar.js';

const opts = { width: 30, height: 1 };

function row(out: string): string {
  return snap(out).plain.split('\n')[0] ?? '';
}

function advance(ms: number): void {
  const g = globalThis as Record<string, unknown>;
  const prev = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = prev;
  }
}

describe('ProgressBar — determinate', () => {
  it('renders all empty when value = 0', () => {
    const out = renderToString(createElement(ProgressBar, { value: 0, width: 10 }), opts);
    expect(row(out).startsWith('░'.repeat(10))).toBe(true);
  });

  it('renders all filled when value = total', () => {
    const out = renderToString(
      createElement(ProgressBar, { value: 100, total: 100, width: 10 }),
      opts,
    );
    expect(row(out).startsWith('█'.repeat(10))).toBe(true);
  });

  it('renders half-filled at 50%', () => {
    const out = renderToString(
      createElement(ProgressBar, { value: 50, total: 100, width: 10 }),
      opts,
    );
    expect(row(out).startsWith(`${'█'.repeat(5)}${'░'.repeat(5)}`)).toBe(true);
  });

  it('clamps value above total to fully filled', () => {
    const out = renderToString(
      createElement(ProgressBar, { value: 999, total: 100, width: 8 }),
      opts,
    );
    expect(row(out).startsWith('█'.repeat(8))).toBe(true);
  });

  it('clamps negative value to fully empty', () => {
    const out = renderToString(
      createElement(ProgressBar, { value: -5, total: 100, width: 8 }),
      opts,
    );
    expect(row(out).startsWith('░'.repeat(8))).toBe(true);
  });

  it('treats total <= 0 as fully empty', () => {
    const out = renderToString(createElement(ProgressBar, { value: 5, total: 0, width: 6 }), opts);
    expect(row(out).startsWith('░'.repeat(6))).toBe(true);
  });

  it('uses custom fill / empty characters', () => {
    const out = renderToString(
      createElement(ProgressBar, {
        value: 30,
        total: 100,
        width: 10,
        fillChar: '=',
        emptyChar: '-',
      }),
      opts,
    );
    // 30% of 10 = 3 (rounded)
    expect(row(out).startsWith(`${'='.repeat(3)}${'-'.repeat(7)}`)).toBe(true);
  });

  it('renders only fill cells when value rounds up to width', () => {
    // 99% of 10 rounds to 10 → no empty cells at all
    const out = renderToString(
      createElement(ProgressBar, { value: 99, total: 100, width: 10 }),
      opts,
    );
    expect(row(out).startsWith('█'.repeat(10))).toBe(true);
  });

  it('width=0 renders nothing visible', () => {
    const out = renderToString(
      createElement(ProgressBar, { value: 50, total: 100, width: 0 }),
      opts,
    );
    expect(row(out).replace(/\s/g, '')).toBe('');
  });

  it('emits a diff write when value changes', () => {
    // mountWithInput verifies that state-driven re-renders actually emit
    // ANSI deltas — complementary to renderToString's static checks.
    const h = mountWithInput<number>(
      0,
      (tick) => createElement(ProgressBar, { value: tick * 25, total: 100, width: 8 }),
      opts,
    );
    const initial = h.allWrites().length;
    h.setState(2); // 50% → 4 fill cells appear
    expect(h.allWrites().length).toBeGreaterThan(initial);
    expect(snap(h.lastWrite()).plain).toContain('█');
    h.unmount();
  });
});

describe('ProgressBar — indeterminate', () => {
  it('renders the scanner block on initial mount', () => {
    const out = renderToString(
      createElement(ProgressBar, {
        indeterminate: true,
        width: 10,
        scannerWidth: 3,
      }),
      opts,
    );
    // Scanner starts at index 0: 3 fill cells then 7 empty
    expect(row(out).startsWith(`${'█'.repeat(3)}${'░'.repeat(7)}`)).toBe(true);
  });

  it('emits diff writes as the scanner advances', () => {
    vi.useFakeTimers();
    try {
      const h = mountWithInput(
        0,
        () =>
          createElement(ProgressBar, {
            indeterminate: true,
            width: 10,
            scannerWidth: 3,
            interval: 100,
          }),
        opts,
      );
      const before = h.allWrites().length;
      advance(100);
      // One tick should produce at least one diff write (the cells that
      // changed when the scanner moved one position to the right).
      expect(h.allWrites().length).toBeGreaterThan(before);
      h.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the interval on unmount', () => {
    vi.useFakeTimers();
    try {
      const h = mountWithInput(
        0,
        () => createElement(ProgressBar, { indeterminate: true, width: 8 }),
        opts,
      );
      h.unmount();
      const writesBefore = h.allWrites().length;
      vi.advanceTimersByTime(500);
      expect(h.allWrites().length).toBe(writesBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps scannerWidth to bar width', () => {
    const out = renderToString(
      createElement(ProgressBar, {
        indeterminate: true,
        width: 4,
        scannerWidth: 99,
      }),
      opts,
    );
    // scannerWidth clamped to 4 → all fill
    expect(row(out).startsWith('█'.repeat(4))).toBe(true);
  });
});
