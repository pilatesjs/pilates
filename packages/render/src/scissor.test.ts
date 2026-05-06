import { describe, expect, it } from 'vitest';
import { Frame } from './frame.js';
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

describe('Frame — scissor stack', () => {
  it('writes outside the current scissor are dropped', () => {
    const f = new Frame(10, 5);
    f.pushScissor({ left: 2, top: 1, width: 3, height: 2 });
    // (1, 1) is outside; (3, 1) is inside.
    f.setGrapheme(1, 1, 'X', { fg: undefined, bg: undefined, attrs: 0 });
    f.setGrapheme(3, 1, 'Y', { fg: undefined, bg: undefined, attrs: 0 });
    f.popScissor();
    expect(f.getCell(1, 1)?.char).toBe(' '); // unchanged default
    expect(f.getCell(3, 1)?.char).toBe('Y'); // wrote through
  });

  it('nested scissors intersect', () => {
    const f = new Frame(10, 5);
    f.pushScissor({ left: 0, top: 0, width: 5, height: 5 });
    f.pushScissor({ left: 3, top: 0, width: 5, height: 5 }); // overlap = [3,5) x [0,5)
    // (4, 0) is in both; (1, 0) is in outer only; (6, 0) is in inner only.
    f.setGrapheme(4, 0, 'A', { fg: undefined, bg: undefined, attrs: 0 });
    f.setGrapheme(1, 0, 'B', { fg: undefined, bg: undefined, attrs: 0 });
    f.setGrapheme(6, 0, 'C', { fg: undefined, bg: undefined, attrs: 0 });
    f.popScissor();
    f.popScissor();
    expect(f.getCell(4, 0)?.char).toBe('A');
    expect(f.getCell(1, 0)?.char).toBe(' ');
    expect(f.getCell(6, 0)?.char).toBe(' ');
  });

  it('popping leaves the previous scissor active', () => {
    const f = new Frame(10, 5);
    f.pushScissor({ left: 0, top: 0, width: 5, height: 5 });
    f.pushScissor({ left: 3, top: 0, width: 5, height: 5 });
    f.popScissor(); // back to outer scissor
    f.setGrapheme(1, 0, 'A', { fg: undefined, bg: undefined, attrs: 0 });
    f.popScissor();
    expect(f.getCell(1, 0)?.char).toBe('A');
  });

  it('with no scissor pushed, all in-bounds writes pass', () => {
    const f = new Frame(5, 5);
    f.setGrapheme(2, 2, 'Z', { fg: undefined, bg: undefined, attrs: 0 });
    expect(f.getCell(2, 2)?.char).toBe('Z');
  });
});
