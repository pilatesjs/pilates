import { describe, expect, it } from 'vitest';
import { VERSION, setLayoutProfiler } from './index.js';
import type { LayoutProfiler, LayoutTrace } from './index.js';

describe('@pilates/core', () => {
  it('exposes a version string', () => {
    expect(typeof VERSION).toBe('string');
  });

  it('exposes the layout-profiler API (phase 9)', () => {
    expect(typeof setLayoutProfiler).toBe('function');
    // Type-level: `LayoutProfiler` and `LayoutTrace` are on the
    // public surface — a missing export would fail typecheck here.
    const noop: LayoutProfiler = (_root, trace: LayoutTrace) => void trace;
    expect(typeof noop).toBe('function');
  });
});
