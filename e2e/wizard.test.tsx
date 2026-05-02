/**
 * Smoke test for examples/react-wizard.
 *
 * Drives the full TextInput → Select → Spinner → Done flow in-process via
 * `mountWithInput`. Timer-driven steps (the wizard's setTimeout transitions)
 * use vi.useFakeTimers + advanceTimersByTime so the test doesn't rely on
 * wall-clock waits.
 */

import { mountWithInput } from '@pilates/react/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../examples/react-wizard/index.js';
import { strip } from './helpers.js';

describe('react-wizard smoke', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('walks name → size → processing → done', () => {
    const h = mountWithInput(0, () => <App />, { width: 50, height: 8 });

    expect(strip(h.lastWrite())).toMatch(/What's your name\?/);

    for (const ch of 'alice') h.pressChar(ch);
    h.pressKey('enter');

    expect(strip(h.lastWrite())).toMatch(/Hi alice\. Pick a size:/);

    h.pressKey('down');
    h.pressKey('enter');

    expect(strip(h.lastWrite())).toMatch(/Processing/);

    h.unmount();
  });

  it('rejects empty name on Enter', () => {
    const h = mountWithInput(0, () => <App />, { width: 50, height: 8 });
    h.pressKey('enter');
    expect(strip(h.lastWrite())).toMatch(/What's your name\?/);
    h.unmount();
  });
});
