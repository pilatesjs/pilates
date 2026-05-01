import { mountWithInput } from '@pilates/react/test-utils';
import { act, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SPINNER_FRAMES } from './spinner-frames.js';
import { Spinner } from './spinner.js';

// Use mountWithInput (not mount) because Spinner's setInterval lives in
// useEffect — mountWithInput wraps reconciler ops in act(), which drains
// passive effects synchronously. mount() does not.
//
// vi.advanceTimersByTime must be wrapped in act() so that the React state
// update scheduled by setIndex (via setImmediate in React's scheduler) is
// flushed synchronously before the assertion. Without act(), the scheduler's
// setImmediate callback fires after the assertion.

const opts = { width: 10, height: 1 };

function stripSGR(s: string): string {
  return (
    s
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
      .replace(/\x1b\[[0-9;]*m/g, '')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
      .replace(/\x1b\[[0-9;]*[Hf]/g, '')
      .replace(/\n$/, '')
  );
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

describe('Spinner', () => {
  it('renders the first frame of the default "dots" type on initial mount', () => {
    const handle = mountWithInput(0, () => createElement(Spinner, {}), opts);
    expect(stripSGR(handle.lastWrite())).toContain(SPINNER_FRAMES.dots[0]!);
    handle.unmount();
  });

  it('cycles through frames when type="line"', () => {
    vi.useFakeTimers();
    try {
      const handle = mountWithInput(0, () => createElement(Spinner, { type: 'line' }), opts);
      const seen = new Set<string>();
      seen.add(stripSGR(handle.lastWrite()).trim());
      for (let i = 0; i < SPINNER_FRAMES.line.length + 2; i++) {
        advance(80);
        seen.add(stripSGR(handle.lastWrite()).trim());
      }
      for (const f of SPINNER_FRAMES.line) expect(seen.has(f)).toBe(true);
      handle.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses custom frames when frames prop is provided (overrides type)', () => {
    vi.useFakeTimers();
    try {
      const handle = mountWithInput(
        0,
        () => createElement(Spinner, { type: 'dots', frames: ['A', 'B'] }),
        opts,
      );
      expect(stripSGR(handle.lastWrite()).trim()).toBe('A');
      advance(80);
      expect(stripSGR(handle.lastWrite()).trim()).toBe('B');
      advance(80);
      expect(stripSGR(handle.lastWrite()).trim()).toBe('A');
      handle.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects custom interval', () => {
    vi.useFakeTimers();
    try {
      const handle = mountWithInput(
        0,
        () => createElement(Spinner, { frames: ['A', 'B'], interval: 200 }),
        opts,
      );
      expect(stripSGR(handle.lastWrite()).trim()).toBe('A');
      advance(199);
      expect(stripSGR(handle.lastWrite()).trim()).toBe('A');
      advance(1);
      expect(stripSGR(handle.lastWrite()).trim()).toBe('B');
      handle.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the interval on unmount (no further frame writes)', () => {
    vi.useFakeTimers();
    try {
      const handle = mountWithInput(0, () => createElement(Spinner, { frames: ['A', 'B'] }), opts);
      handle.unmount();
      const writesBefore = handle.allWrites().length;
      vi.advanceTimersByTime(800);
      expect(handle.allWrites().length).toBe(writesBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders a single frame and stops if frames is a single-element array', () => {
    const handle = mountWithInput(0, () => createElement(Spinner, { frames: ['SOLO'] }), opts);
    expect(stripSGR(handle.lastWrite()).trim()).toBe('SOLO');
    handle.unmount();
  });
});
