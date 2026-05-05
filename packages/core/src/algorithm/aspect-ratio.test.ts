/**
 * Layout fixtures covering `aspectRatio`.
 *
 * Semantics summary (matches Yoga / CSS aspect-ratio):
 *
 * - `aspectRatio` = width / height. So a wide-thin box has aspectRatio > 1.
 * - When `aspectRatio` is set AND one of {width, height} is a number AND the
 *   other is `'auto'`, the missing dimension is derived from the set one.
 * - When BOTH width and height are explicit numbers, `aspectRatio` is ignored
 *   (the explicit values win — this matches the CSS spec's "aspect-ratio is
 *   a hint, not an override" rule).
 * - min/max clamps still apply on both axes after derivation; when the derived
 *   dimension is clamped, the OTHER dimension is NOT re-derived in v1 (we
 *   accept the small inconsistency to keep the algorithm one-pass).
 * - For an item whose hypothetical main is derived from its own style, the
 *   cross axis natural size honors aspectRatio. Then `align-items: stretch`
 *   only fills if the cross is `'auto'` and there's no aspectRatio derivation.
 */

import { describe, expect, it } from 'vitest';
import { Node } from '../node.js';

describe('aspectRatio — setter validation', () => {
  it('defaults to undefined (no constraint)', () => {
    const n = Node.create();
    expect(n.style.aspectRatio).toBeUndefined();
  });

  it('accepts a positive finite number', () => {
    const n = Node.create();
    n.setAspectRatio(2);
    expect(n.style.aspectRatio).toBe(2);
  });

  it('accepts undefined to clear', () => {
    const n = Node.create();
    n.setAspectRatio(2);
    n.setAspectRatio(undefined);
    expect(n.style.aspectRatio).toBeUndefined();
  });

  it('rejects zero', () => {
    const n = Node.create();
    expect(() => n.setAspectRatio(0)).toThrow(/aspectRatio.*positive/i);
  });

  it('rejects negative values', () => {
    const n = Node.create();
    expect(() => n.setAspectRatio(-1)).toThrow(/aspectRatio.*positive/i);
  });

  it('rejects NaN / Infinity', () => {
    const n = Node.create();
    expect(() => n.setAspectRatio(Number.NaN)).toThrow(/aspectRatio/i);
    expect(() => n.setAspectRatio(Number.POSITIVE_INFINITY)).toThrow(/aspectRatio/i);
  });
});

describe('aspectRatio — root sizing', () => {
  it('derives root height from explicit width + aspectRatio', () => {
    // width 20, aspectRatio 2 → height = 20 / 2 = 10
    const n = Node.create();
    n.setWidth(20);
    n.setAspectRatio(2);
    n.calculateLayout();
    expect(n.getComputedLayout().width).toBe(20);
    expect(n.getComputedLayout().height).toBe(10);
  });

  it('derives root width from explicit height + aspectRatio', () => {
    // height 10, aspectRatio 2 → width = 10 * 2 = 20
    const n = Node.create();
    n.setHeight(10);
    n.setAspectRatio(2);
    n.calculateLayout();
    expect(n.getComputedLayout().width).toBe(20);
    expect(n.getComputedLayout().height).toBe(10);
  });

  it('ignores aspectRatio when both width and height are explicit', () => {
    const n = Node.create();
    n.setWidth(20);
    n.setHeight(99); // would be 10 if aspectRatio fired
    n.setAspectRatio(2);
    n.calculateLayout();
    expect(n.getComputedLayout().width).toBe(20);
    expect(n.getComputedLayout().height).toBe(99);
  });

  it('ignores aspectRatio when both axes are auto and no caller available', () => {
    const n = Node.create();
    n.setAspectRatio(2);
    n.calculateLayout();
    expect(n.getComputedLayout().width).toBe(0);
    expect(n.getComputedLayout().height).toBe(0);
  });

  it('clamps aspectRatio-derived height to minHeight', () => {
    // width 10, aspectRatio 5 → derived height = 2 → clamped up to minHeight=4
    const n = Node.create();
    n.setWidth(10);
    n.setAspectRatio(5);
    n.setMinHeight(4);
    n.calculateLayout();
    expect(n.getComputedLayout().width).toBe(10);
    expect(n.getComputedLayout().height).toBe(4);
  });

  it('clamps aspectRatio-derived width to maxWidth', () => {
    // height 10, aspectRatio 3 → derived width = 30 → clamped down to maxWidth=20
    const n = Node.create();
    n.setHeight(10);
    n.setAspectRatio(3);
    n.setMaxWidth(20);
    n.calculateLayout();
    expect(n.getComputedLayout().width).toBe(20);
    expect(n.getComputedLayout().height).toBe(10);
  });
});

describe('aspectRatio — flex children', () => {
  it('a child with explicit width + aspectRatio derives its cross height', () => {
    // Parent column 30×10. Child width=10, aspectRatio=2 → height=5.
    const root = Node.create();
    root.setWidth(30);
    root.setHeight(10);
    root.setFlexDirection('column');

    const child = Node.create();
    child.setWidth(10);
    child.setAspectRatio(2);
    root.insertChild(child, 0);

    root.calculateLayout();
    expect(child.getComputedLayout().width).toBe(10);
    expect(child.getComputedLayout().height).toBe(5);
  });

  it('a child with explicit height + aspectRatio derives its cross width (row direction)', () => {
    // Parent row 30×10. Child height=4, aspectRatio=2 → width=8.
    const root = Node.create();
    root.setWidth(30);
    root.setHeight(10);
    root.setFlexDirection('row');
    // Disable cross stretch so width derivation isn't overwritten by stretch.
    root.setAlignItems('flex-start');

    const child = Node.create();
    child.setHeight(4);
    child.setAspectRatio(2);
    root.insertChild(child, 0);

    root.calculateLayout();
    expect(child.getComputedLayout().width).toBe(8);
    expect(child.getComputedLayout().height).toBe(4);
  });

  it('aspectRatio overrides cross stretch when the cross is auto-derived', () => {
    // Parent row 30×10 with default alignItems=stretch. Child width=8 with
    // aspectRatio=2 should keep its derived height=4, not stretch to 10.
    const root = Node.create();
    root.setWidth(30);
    root.setHeight(10);
    root.setFlexDirection('row');

    const child = Node.create();
    child.setWidth(8);
    child.setAspectRatio(2);
    root.insertChild(child, 0);

    root.calculateLayout();
    expect(child.getComputedLayout().width).toBe(8);
    expect(child.getComputedLayout().height).toBe(4);
  });
});
