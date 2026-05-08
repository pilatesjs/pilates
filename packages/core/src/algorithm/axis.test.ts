import { describe, expect, it } from 'vitest';
import { defaultStyle } from '../style.js';
import {
  clampSize,
  crossAxis,
  effectivePreferredSize,
  endEdge,
  gapAlong,
  isReverse,
  mainAxis,
  maxSize,
  minSize,
  preferredSize,
  readEnd,
  readStart,
  startEdge,
} from './axis.js';

const s = (o: Record<string, unknown> = {}) => ({ ...defaultStyle(), ...o });

describe('mainAxis', () => {
  it('row / row-reverse → "row"', () => {
    expect(mainAxis('row')).toBe('row');
    expect(mainAxis('row-reverse')).toBe('row');
  });
  it('column / column-reverse → "column"', () => {
    expect(mainAxis('column')).toBe('column');
    expect(mainAxis('column-reverse')).toBe('column');
  });
});

describe('crossAxis', () => {
  it('is always opposite of mainAxis', () => {
    for (const d of ['row', 'row-reverse', 'column', 'column-reverse'] as const) {
      expect(crossAxis(d)).toBe(mainAxis(d) === 'row' ? 'column' : 'row');
    }
  });
});

describe('isReverse', () => {
  it('true for *-reverse directions', () => {
    expect(isReverse('row-reverse')).toBe(true);
    expect(isReverse('column-reverse')).toBe(true);
  });
  it('false for non-reverse directions', () => {
    expect(isReverse('row')).toBe(false);
    expect(isReverse('column')).toBe(false);
  });
});

describe('startEdge / endEdge', () => {
  // Tuple layout: [top=0, right=1, bottom=2, left=3]
  it('startEdge row = 3 (LEFT)', () => expect(startEdge('row')).toBe(3));
  it('startEdge column = 0 (TOP)', () => expect(startEdge('column')).toBe(0));
  it('endEdge row = 1 (RIGHT)', () => expect(endEdge('row')).toBe(1));
  it('endEdge column = 2 (BOTTOM)', () => expect(endEdge('column')).toBe(2));
});

describe('readStart / readEnd', () => {
  const box = [10, 20, 30, 40]; // [top, right, bottom, left]
  it('readStart row → left (40)', () => expect(readStart(box, 'row')).toBe(40));
  it('readStart column → top (10)', () => expect(readStart(box, 'column')).toBe(10));
  it('readEnd row → right (20)', () => expect(readEnd(box, 'row')).toBe(20));
  it('readEnd column → bottom (30)', () => expect(readEnd(box, 'column')).toBe(30));
  it('defaults to 0 for sparse/empty array', () => {
    expect(readStart([], 'row')).toBe(0);
    expect(readEnd([], 'column')).toBe(0);
  });
});

describe('gapAlong', () => {
  it('row axis → gapColumn', () => expect(gapAlong(s({ gapRow: 4, gapColumn: 8 }), 'row')).toBe(8));
  it('column axis → gapRow', () =>
    expect(gapAlong(s({ gapRow: 4, gapColumn: 8 }), 'column')).toBe(4));
});

describe('preferredSize', () => {
  it('row → width', () => expect(preferredSize(s({ width: 50 }), 'row')).toBe(50));
  it('column → height', () => expect(preferredSize(s({ height: 30 }), 'column')).toBe(30));
  it('"auto" when not explicitly set', () => expect(preferredSize(s(), 'row')).toBe('auto'));
});

describe('effectivePreferredSize', () => {
  it('returns explicit numeric value directly', () =>
    expect(effectivePreferredSize(s({ width: 20 }), 'row')).toBe(20));
  it('derives width = height * aspectRatio when width is auto', () =>
    expect(effectivePreferredSize(s({ width: 'auto', height: 10, aspectRatio: 2 }), 'row')).toBe(
      20,
    ));
  it('derives height = width / aspectRatio when height is auto', () =>
    expect(effectivePreferredSize(s({ width: 20, height: 'auto', aspectRatio: 4 }), 'column')).toBe(
      5,
    ));
  it('returns "auto" when both axes are auto (nothing to derive from)', () =>
    expect(
      effectivePreferredSize(s({ width: 'auto', height: 'auto', aspectRatio: 2 }), 'row'),
    ).toBe('auto'));
  it('returns "auto" when own axis is auto and no aspectRatio is set', () =>
    expect(effectivePreferredSize(s({ width: 'auto' }), 'row')).toBe('auto'));
});

describe('minSize / maxSize', () => {
  it('minSize row = minWidth', () => expect(minSize(s({ minWidth: 5 }), 'row')).toBe(5));
  it('minSize column = minHeight', () => expect(minSize(s({ minHeight: 3 }), 'column')).toBe(3));
  it('maxSize row = maxWidth', () => expect(maxSize(s({ maxWidth: 100 }), 'row')).toBe(100));
  it('maxSize column = undefined when not set', () =>
    expect(maxSize(s(), 'column')).toBeUndefined());
});

describe('clampSize', () => {
  it('clamps below min to min', () => expect(clampSize(s({ minWidth: 10 }), 'row', 5)).toBe(10));
  it('clamps above max to max', () => expect(clampSize(s({ maxWidth: 50 }), 'row', 80)).toBe(50));
  it('passes through value within [min, max]', () =>
    expect(clampSize(s({ minWidth: 5, maxWidth: 50 }), 'row', 30)).toBe(30));
  it('no upper clamp when maxWidth is undefined', () =>
    expect(clampSize(s({ minWidth: 0 }), 'row', 9999)).toBe(9999));
});
