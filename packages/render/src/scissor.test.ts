import { describe, expect, it } from 'vitest';
import { type ClipRect, intersect } from './scissor.js';

describe('ClipRect — intersect', () => {
  const A: ClipRect = { left: 0, top: 0, width: 10, height: 10 };

  it('returns the smaller rect when one fully contains the other', () => {
    const B: ClipRect = { left: 2, top: 2, width: 3, height: 3 };
    expect(intersect(A, B)).toEqual({ left: 2, top: 2, width: 3, height: 3 });
  });

  it('returns the overlapping subrect when partially overlapping', () => {
    const B: ClipRect = { left: 5, top: 5, width: 10, height: 10 };
    expect(intersect(A, B)).toEqual({ left: 5, top: 5, width: 5, height: 5 });
  });

  it('returns a zero-size rect when there is no overlap', () => {
    const B: ClipRect = { left: 20, top: 20, width: 5, height: 5 };
    const r = intersect(A, B);
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
  });

  it('returns a zero-size rect when one input is already zero', () => {
    const Z: ClipRect = { left: 0, top: 0, width: 0, height: 0 };
    expect(intersect(A, Z).width).toBe(0);
    expect(intersect(A, Z).height).toBe(0);
  });
});
