/**
 * Smoke test for examples/react-wizard.
 *
 * Drives the full TextInput → Select → Spinner → Done flow in-process via
 * `mountWithInput`. Timer-driven steps (the wizard's setTimeout transitions)
 * use vi.useFakeTimers + advanceTimersByTime so the test doesn't rely on
 * wall-clock waits.
 */

import { mountWithInput } from '@pilates/react/test-utils';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../examples/react-wizard/index.js';
import { strip } from './helpers.js';

// Advance fake timers and drain any state updates the elapsed setTimeout
// callbacks scheduled — React's act() flushes the microtask queue +
// passive effects synchronously so the next assertion sees the post-
// transition frame.
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

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

    // Wizard schedules processing → done after 2500ms.
    advance(2500);
    const doneFrame = strip(h.lastWrite());
    expect(doneFrame).toMatch(/✓ Done/);
    // strip() drops ANSI cursor codes, which were the only thing
    // separating cells across a row break — so the rendered "name =
    // alice, size = md" string compresses down to "name=alice,size=md"
    // when the inter-cell whitespace is collapsed. Assert against that
    // form rather than re-introducing the spaces.
    expect(doneFrame).toMatch(/name=alice/);
    expect(doneFrame).toMatch(/size=md/);

    h.unmount();
  });

  it('rejects empty name on Enter', () => {
    const h = mountWithInput(0, () => <App />, { width: 50, height: 8 });
    h.pressKey('enter');
    expect(strip(h.lastWrite())).toMatch(/What's your name\?/);
    h.unmount();
  });
});
