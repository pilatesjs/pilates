import { describe, expect, test } from 'vitest';
import {
  DIRTY_ANY,
  DIRTY_CHILDREN,
  DIRTY_FLEX_DISTRIBUTION,
  DIRTY_MEASURE,
  DIRTY_MEASURE_CONTENT,
  DIRTY_STYLE_SIG,
  DIRTY_STYLE_VALUE,
} from './dirty-flags.js';

describe('dirty-flags', () => {
  test('each flag is a distinct power of 2', () => {
    const flags = [
      DIRTY_STYLE_SIG,
      DIRTY_STYLE_VALUE,
      DIRTY_FLEX_DISTRIBUTION,
      DIRTY_MEASURE,
      DIRTY_MEASURE_CONTENT,
      DIRTY_CHILDREN,
    ];
    // Each is non-zero
    for (const f of flags) {
      expect(f).toBeGreaterThan(0);
    }
    // Each is a power of 2
    for (const f of flags) {
      expect(f & (f - 1)).toBe(0);
    }
    // All distinct
    const unique = new Set(flags);
    expect(unique.size).toBe(flags.length);
  });

  test('DIRTY_ANY is the OR of all flags', () => {
    const expected =
      DIRTY_STYLE_SIG |
      DIRTY_STYLE_VALUE |
      DIRTY_FLEX_DISTRIBUTION |
      DIRTY_MEASURE |
      DIRTY_MEASURE_CONTENT |
      DIRTY_CHILDREN;
    expect(DIRTY_ANY).toBe(expected);
  });

  test('bitmask operations work as expected', () => {
    let flags = 0;
    flags |= DIRTY_STYLE_VALUE;
    expect(flags & DIRTY_STYLE_VALUE).toBe(DIRTY_STYLE_VALUE);
    expect(flags & DIRTY_STYLE_SIG).toBe(0);
    flags |= DIRTY_CHILDREN;
    expect(flags & DIRTY_CHILDREN).toBe(DIRTY_CHILDREN);
    expect(flags & DIRTY_STYLE_VALUE).toBe(DIRTY_STYLE_VALUE);
    expect(flags).toBe(DIRTY_STYLE_VALUE | DIRTY_CHILDREN);
  });
});
