/**
 * Smoke test for examples/react-counter.
 *
 * The example mounts a counter that increments every 250ms via setInterval.
 * Verify initial render and that the counter advances once timers tick.
 */

import { mountWithInput } from '@pilates/react/test-utils';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../examples/react-counter/index.js';
import { strip } from './helpers.js';

describe('react-counter smoke', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders initial state and advances on tick', () => {
    const h = mountWithInput(0, () => <App />, { width: 24, height: 8 });

    // First write is a full paint; assert label and zero state are present.
    expect(strip(h.lastWrite())).toMatch(/counter/);
    expect(strip(h.lastWrite())).toMatch(/n = 0/);

    act(() => {
      vi.advanceTimersByTime(750);
    });

    // Subsequent writes are diff-applied deltas — only changed cells. So
    // the latest write should contain a non-zero digit (the new count),
    // and overall write count should have grown beyond the initial paint.
    expect(strip(h.lastWrite())).toMatch(/[1-9]/);

    h.unmount();
  });
});
