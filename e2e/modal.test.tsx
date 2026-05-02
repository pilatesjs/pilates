/**
 * Smoke test for examples/react-modal.
 *
 * The modal is open by default; verify the modal content and underlying
 * App pane both render. After 1.5s the modal toggles closed; advance
 * fake timers to confirm.
 */

import { mountWithInput } from '@pilates/react/test-utils';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../examples/react-modal/index.js';
import { strip } from './helpers.js';

describe('react-modal smoke', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders both the App pane and the open modal initially', () => {
    const h = mountWithInput(0, () => <App />, { width: 80, height: 24 });
    const out = strip(h.lastWrite());
    expect(out).toMatch(/users:/);
    expect(out).toMatch(/Confirm action/);
    expect(out).toMatch(/Delete user "carol"\?/);
    h.unmount();
  });

  it('toggles modal closed after 1.5s', () => {
    const h = mountWithInput(0, () => <App />, { width: 80, height: 24 });
    expect(strip(h.lastWrite())).toMatch(/Confirm action/);
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(strip(h.lastWrite())).not.toMatch(/Confirm action/);
    h.unmount();
  });
});
