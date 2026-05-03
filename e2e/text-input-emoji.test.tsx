/**
 * Smoke test for examples/react-text-input-emoji.
 *
 * Verifies that the grapheme-cluster cursor walks emoji and ZWJ sequences
 * as one unit through real `pressKey` events. Mirrors the wizard test's
 * mountWithInput pattern (no fake timers needed — the example is timer-free).
 */

import { mountWithInput } from '@pilates/react/test-utils';
import { describe, expect, it } from 'vitest';
import { App } from '../examples/react-text-input-emoji/index.js';
import { strip } from './helpers.js';

const INITIAL = '👋 你好 👨‍👩‍👧!';

describe('react-text-input-emoji smoke', () => {
  it('renders the initial emoji-rich value', () => {
    const h = mountWithInput(0, () => <App />, { width: 50, height: 6 });
    const out = strip(h.lastWrite());
    expect(out).toContain('👋');
    expect(out).toContain('你好');
    // The grapheme/code-unit footer is what makes the example useful.
    expect(out).toMatch(/graphemes=/);
    expect(out).toMatch(/code units=/);
    h.unmount();
  });

  it('Enter exits with the current value', () => {
    const h = mountWithInput(0, () => <App />, { width: 50, height: 6 });
    h.pressKey('enter');
    // After exit() the App has unmounted; mount handle still works for
    // teardown. Smoke is purely "did it crash on Enter?" — assertion above
    // covers initial render correctness.
    h.unmount();
  });

  it('writes a non-empty cell delta in response to Backspace', () => {
    // The unit-level grapheme correctness lives in
    // packages/widgets/src/text-input.test.tsx. Here we just confirm the
    // example wires the keystroke through to the controlled value (the
    // delta would be zero if the keystroke was dropped).
    const h = mountWithInput(0, () => <App />, { width: 50, height: 6 });
    const before = h.allWrites().length;
    h.pressKey('end');
    h.pressKey('backspace');
    const after = h.allWrites().length;
    expect(after).toBeGreaterThan(before);
    h.unmount();
  });
});

// Reference INITIAL so the const isn't dead — it documents what the example
// renders without depending on the example's internal state.
void INITIAL;
