/**
 * Public re-export contract for `@pilates/diff`.
 */

import { describe, expect, it } from 'vitest';
import * as Diff from './index.js';

describe('@pilates/diff exports', () => {
  it('exports a VERSION string', () => {
    expect(typeof Diff.VERSION).toBe('string');
    expect(Diff.VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('exports diff as a function', () => {
    expect(typeof Diff.diff).toBe('function');
  });

  it('exports applyDiff as a function', () => {
    expect(typeof Diff.applyDiff).toBe('function');
  });

  it('exports CellChange as a type (compile-only check)', () => {
    // Type-only export: nothing to assert at runtime. The annotation
    // below resolves at typecheck — a missing export breaks the build.
    const _typeCheck: keyof Diff.CellChange = 'x';
    void _typeCheck;
    expect(true).toBe(true);
  });
});
