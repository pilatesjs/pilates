/**
 * Lock the SPINNER_FRAMES shape so additions/removals are an explicit
 * choice, not a silent drift. Each frame set must:
 *   - Have at least 4 frames (animation worth showing)
 *   - Have non-empty frames
 *   - Have equal-width frames within a set (otherwise the layout jitters)
 */

import { stringWidth } from '@pilates/core';
import { describe, expect, it } from 'vitest';
import { SPINNER_FRAMES, type SpinnerType } from './spinner-frames.js';

const TYPES: SpinnerType[] = ['dots', 'line', 'arrow', 'bouncingBar', 'bouncingBall'];

describe('SPINNER_FRAMES', () => {
  it('exposes every documented SpinnerType', () => {
    for (const type of TYPES) {
      expect(SPINNER_FRAMES[type]).toBeDefined();
    }
    expect(Object.keys(SPINNER_FRAMES).sort()).toEqual([...TYPES].sort());
  });

  it('every set has at least 4 frames', () => {
    for (const type of TYPES) {
      expect(SPINNER_FRAMES[type].length).toBeGreaterThanOrEqual(4);
    }
  });

  it('every frame is non-empty', () => {
    for (const type of TYPES) {
      for (const frame of SPINNER_FRAMES[type]) {
        expect(frame.length).toBeGreaterThan(0);
      }
    }
  });

  it('frames in a fixed-width set have equal cell-width (no animation jitter)', () => {
    // Pilates spins the "dots", "line", "bouncingBar", and "bouncingBall"
    // sets in place at one location, so equal widths matter. The "arrow"
    // set uses East-Asian-ambiguous codepoints whose cell-width is
    // implementation-defined; we don't lock it.
    const FIXED: SpinnerType[] = ['dots', 'line', 'bouncingBar', 'bouncingBall'];
    for (const type of FIXED) {
      const widths = SPINNER_FRAMES[type].map((f) => stringWidth(f));
      expect(new Set(widths).size).toBe(1);
    }
  });

  it('every set is a readonly array (typed)', () => {
    // Compile-time check: the readonly modifier is on the value type.
    // Runtime: just ensure it's array-shaped.
    for (const type of TYPES) {
      expect(Array.isArray(SPINNER_FRAMES[type])).toBe(true);
    }
  });
});
