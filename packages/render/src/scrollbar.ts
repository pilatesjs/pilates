/**
 * Pure-math helpers for scrollbar rendering. Geometry math is split from
 * the actual paint call so it can be tested without a frame buffer, and so
 * the same numbers are available to consumers (e.g., for hover-style
 * scrollbar UI in a future iteration).
 */

import type { CellStyle, Frame } from './frame.js';

export interface ThumbGeometryInput {
  /** Total content size along the scrolling axis (pixels in CSS; cells here). */
  contentSize: number;
  /** Visible viewport size along the scrolling axis. */
  viewportSize: number;
  /** Current scroll offset, in [0, contentSize - viewportSize]. */
  scrollOffset: number;
  /** Track length in cells. */
  trackLength: number;
}

export interface ThumbGeometry {
  /** Offset of thumb start, in cells, from the start of the track. */
  thumbStart: number;
  /** Thumb length, in cells. Always at least 1 when track is non-empty. */
  thumbLength: number;
}

/**
 * Compute thumb geometry. Formula matches the standard CSS scrollbar:
 *
 *   thumbLength = max(1, round(trackLength * viewport / content))
 *   thumbStart  = round((scroll / (content - viewport)) * (trackLength - thumbLength))
 *
 * Edge cases: when content fits in viewport, thumb fills the track. When
 * track length is 0, both thumbStart and thumbLength are 0. The thumb is
 * clamped so `thumbStart + thumbLength <= trackLength`.
 */
export function thumbGeometry(input: ThumbGeometryInput): ThumbGeometry {
  const { contentSize, viewportSize, scrollOffset, trackLength } = input;
  if (trackLength <= 0) return { thumbStart: 0, thumbLength: 0 };
  if (contentSize <= viewportSize) {
    return { thumbStart: 0, thumbLength: trackLength };
  }
  const ratio = viewportSize / contentSize;
  const thumbLength = Math.max(1, Math.round(trackLength * ratio));
  const scrollable = contentSize - viewportSize;
  const trackScrollable = trackLength - thumbLength;
  const offset = Math.max(0, Math.min(scrollOffset, scrollable));
  const thumbStart = Math.round((offset / scrollable) * trackScrollable);
  return {
    thumbStart: Math.min(thumbStart, trackScrollable),
    thumbLength,
  };
}

export interface PaintScrollbarOpts {
  orientation: 'vertical' | 'horizontal';
  /** Track origin + length, in `Frame` coordinates. */
  gutter: { x: number; y: number; length: number };
  contentSize: number;
  viewportSize: number;
  scrollOffset: number;
  thumbChar: string;
  trackChar: string;
  thumbStyle?: CellStyle;
  trackStyle?: CellStyle;
}

const DEFAULT_STYLE: CellStyle = { fg: undefined, bg: undefined, attrs: 0 };

/**
 * Paint a scrollbar into the frame. Track is filled with `trackChar`;
 * thumb (computed via `thumbGeometry`) overwrites with `thumbChar`. Used
 * by the painter when a node has `overflow: scroll` or
 * `overflow: auto` with overflowing content.
 */
export function paintScrollbar(frame: Frame, opts: PaintScrollbarOpts): void {
  const geom = thumbGeometry({
    contentSize: opts.contentSize,
    viewportSize: opts.viewportSize,
    scrollOffset: opts.scrollOffset,
    trackLength: opts.gutter.length,
  });
  const trackStyle = opts.trackStyle ?? DEFAULT_STYLE;
  const thumbStyle = opts.thumbStyle ?? DEFAULT_STYLE;

  for (let i = 0; i < opts.gutter.length; i++) {
    const isThumb = i >= geom.thumbStart && i < geom.thumbStart + geom.thumbLength;
    const ch = isThumb ? opts.thumbChar : opts.trackChar;
    const style = isThumb ? thumbStyle : trackStyle;
    if (opts.orientation === 'vertical') {
      frame.setGrapheme(opts.gutter.x, opts.gutter.y + i, ch, style);
    } else {
      frame.setGrapheme(opts.gutter.x + i, opts.gutter.y, ch, style);
    }
  }
}
