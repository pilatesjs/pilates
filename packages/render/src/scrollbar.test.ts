import { describe, expect, it } from 'vitest';
import { thumbGeometry } from './scrollbar.js';

describe('thumbGeometry', () => {
  it('thumb spans the full track when content fits', () => {
    // viewport === content: nothing to scroll, thumb fills track.
    const g = thumbGeometry({ contentSize: 10, viewportSize: 10, scrollOffset: 0, trackLength: 5 });
    expect(g.thumbStart).toBe(0);
    expect(g.thumbLength).toBe(5);
  });

  it('thumb is proportional to viewport / content when content overflows', () => {
    // 20 content, 10 viewport, 10 track → thumb = round(10 * 10/20) = 5.
    const g = thumbGeometry({
      contentSize: 20,
      viewportSize: 10,
      scrollOffset: 0,
      trackLength: 10,
    });
    expect(g.thumbLength).toBe(5);
    expect(g.thumbStart).toBe(0);
  });

  it('thumb position scales with scroll offset', () => {
    // 20 content, 10 viewport, scrolled 10 → at end. trackLength=10, thumbLen=5
    // → thumbStart = round((10/(20-10)) * (10-5)) = 5.
    const g = thumbGeometry({
      contentSize: 20,
      viewportSize: 10,
      scrollOffset: 10,
      trackLength: 10,
    });
    expect(g.thumbStart).toBe(5);
    expect(g.thumbLength).toBe(5);
  });

  it('thumb has minimum length 1 even with huge content', () => {
    // 1000 content, 10 viewport, 5 track → raw thumb = round(5 * 10/1000) = 0;
    // clamped to 1.
    const g = thumbGeometry({
      contentSize: 1000,
      viewportSize: 10,
      scrollOffset: 0,
      trackLength: 5,
    });
    expect(g.thumbLength).toBe(1);
  });

  it('thumbStart never exceeds trackLength - thumbLength', () => {
    const g = thumbGeometry({
      contentSize: 100,
      viewportSize: 10,
      scrollOffset: 999, // overshoot
      trackLength: 10,
    });
    expect(g.thumbStart + g.thumbLength).toBeLessThanOrEqual(10);
  });

  it('zero-length track returns zero geometry', () => {
    const g = thumbGeometry({
      contentSize: 100,
      viewportSize: 10,
      scrollOffset: 5,
      trackLength: 0,
    });
    expect(g.thumbStart).toBe(0);
    expect(g.thumbLength).toBe(0);
  });
});
