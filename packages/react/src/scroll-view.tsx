import {
  type MutableRefObject,
  type ReactNode,
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Box } from './components.js';
import { useFocus } from './focus.js';
import { useInput } from './hooks.js';
import { type BoxLikeInstance, useBoxMetrics } from './use-box-metrics.js';

export interface ScrollMeta {
  contentSize: number;
  viewportSize: number;
  atStart: boolean;
  atEnd: boolean;
}

export interface ScrollViewProps {
  height?: number | 'auto';
  width?: number | 'auto';
  horizontal?: boolean;
  /** Controlled scroll offset. If set, parent owns the value. */
  scrollOffset?: number;
  /** Uncontrolled initial offset. Ignored when `scrollOffset` is set. */
  defaultScrollOffset?: number;
  /** Fires whenever the offset changes. */
  onScroll?: (offset: number, meta: ScrollMeta) => void;
  /**
   * When false, disables built-in keyboard navigation (arrow keys, PgUp/PgDn,
   * Home/End). Also removes this ScrollView from the Tab focus cycle.
   * Default true.
   */
  scrollEnabled?: boolean;
  /** When content grows, auto-scroll to end. Pauses if user has scrolled away from bottom. */
  stickToBottom?: boolean;
  /** When content grows, auto-scroll to start. Pauses if user has scrolled away from top. */
  stickToTop?: boolean;
  children?: ReactNode;
}

export interface ScrollViewHandle {
  scrollTo: (offset: number) => void;
  scrollBy: (delta: number) => void;
  scrollToStart: () => void;
  scrollToEnd: () => void;
  getScrollOffset: () => number;
  getContentSize: () => number;
  getViewportSize: () => number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(n, hi));
}

export const ScrollView = forwardRef<ScrollViewHandle, ScrollViewProps>(
  function ScrollView(
    { height, width, horizontal, scrollOffset, defaultScrollOffset, onScroll, scrollEnabled, stickToBottom, stickToTop, children },
    ref,
  ) {
    const isControlled = scrollOffset !== undefined;
    const [internalOffset, setInternalOffset] = useState(defaultScrollOffset ?? 0);
    const effectiveOffset = isControlled ? scrollOffset : internalOffset;

    // Mutable ref so imperative methods always read the latest committed offset
    // without waiting for the next render cycle.
    const offsetRef = useRef(effectiveOffset);
    offsetRef.current = effectiveOffset;

    const boxRef = useRef(null);
    const metrics = useBoxMetrics(boxRef);

    const isVertical = horizontal !== true;
    const viewportSize = isVertical ? (metrics?.height ?? 0) : (metrics?.width ?? 0);
    const contentSize = isVertical ? (metrics?.scrollHeight ?? 0) : (metrics?.scrollWidth ?? 0);

    /**
     * Read current metrics directly from the box node's _layout. This gives
     * an up-to-date answer even on the first render before useBoxMetrics'
     * passive effect has triggered a re-render, because renderToFrame writes
     * _layout back onto the render node synchronously during the commit phase.
     */
    const readMetrics = () => {
      const inst = boxRef.current as BoxLikeInstance | null;
      const lo = inst?.kind === 'box' ? inst.node._layout : undefined;
      if (!lo) return { viewportSize: 0, contentSize: 0 };
      const vp = isVertical ? lo.height : lo.width;
      const cs = isVertical ? (lo.scrollHeight ?? lo.height) : (lo.scrollWidth ?? lo.width);
      return { viewportSize: vp, contentSize: cs };
    };

    const setOffset = (next: number) => {
      const { contentSize: cs, viewportSize: vp } = readMetrics();
      const max = Math.max(0, cs - vp);
      const clamped = clamp(next, 0, max);
      const cur = offsetRef.current;
      if (clamped === cur) return;
      offsetRef.current = clamped;
      // Update stick-tracking refs immediately so that if the next render is
      // triggered by external state (e.g. stickToBottom content growth), we
      // use the position set by THIS call rather than the last effect run.
      wasAtEndRef.current = clamped >= max;
      wasAtStartRef.current = clamped === 0;
      if (!isControlled) setInternalOffset(clamped);
      onScroll?.(clamped, {
        contentSize: cs,
        viewportSize: vp,
        atStart: clamped === 0,
        atEnd: clamped >= max,
      });
    };

    const prevContentSizeRef = useRef(0);
    const wasAtEndRef = useRef(true);
    const wasAtStartRef = useRef(true);

    useLayoutEffect(() => {
      const { contentSize: cs, viewportSize: vp } = readMetrics();
      const grew = cs > prevContentSizeRef.current;
      if (grew) {
        if (stickToBottom && wasAtEndRef.current) {
          setOffset(Math.max(0, cs - vp));
        } else if (stickToTop && wasAtStartRef.current) {
          setOffset(0);
        }
      }
      prevContentSizeRef.current = cs;
      const max = Math.max(0, cs - vp);
      wasAtEndRef.current = effectiveOffset >= max;
      wasAtStartRef.current = effectiveOffset === 0;
    });

    // Build the stable handle once and update on rerender via a ref.
    // getScrollOffset reads offsetRef so it returns the latest value even
    // before the setState-triggered re-render commits.
    const handleRef = useRef<ScrollViewHandle | null>(null);
    if (handleRef.current === null) {
      handleRef.current = {
        scrollTo: (offset) => setOffset(offset),
        scrollBy: (delta) => setOffset(offsetRef.current + delta),
        scrollToStart: () => setOffset(0),
        scrollToEnd: () => {
          const { contentSize: cs, viewportSize: vp } = readMetrics();
          setOffset(Math.max(0, cs - vp));
        },
        getScrollOffset: () => offsetRef.current,
        getContentSize: () => {
          const { contentSize: cs } = readMetrics();
          return cs;
        },
        getViewportSize: () => {
          const { viewportSize: vp } = readMetrics();
          return vp;
        },
      };
    }

    // Wire the forwarded ref: useImperativeHandle for the standard React
    // pattern, plus a direct write so that test code doing
    // `api = ref.current` during App's render sees a non-null value on
    // re-renders after the first commit.
    useImperativeHandle(ref, () => handleRef.current!, []);

    // Also populate the forwarded ref during ScrollView's render phase so
    // parent components that capture `ref.current` during their own render
    // (which runs before this child) see it populated on the next render.
    // Writing to a ref during render is allowed in React (refs are the
    // one exception to the "no side effects during render" rule).
    // Safe under Pilates's synchronous renderer: no tearing risk.
    // Allows test code and parent renders to read ref.current synchronously.
    if (ref !== null) {
      if (typeof ref === 'function') {
        ref(handleRef.current);
      } else {
        (ref as MutableRefObject<ScrollViewHandle | null>).current = handleRef.current;
      }
    }

    // Built-in keyboard navigation. Registers with the focus manager so
    // Tab cycling works; auto-focuses on mount when nothing else holds focus.
    const enabled = scrollEnabled !== false;
    const { isFocused } = useFocus({ autoFocus: enabled, isActive: enabled });

    useInput(
      (event) => {
        const lineKey = isVertical ? event.name === 'down' : event.name === 'right';
        const lineKeyBack = isVertical ? event.name === 'up' : event.name === 'left';
        if (lineKey) { setOffset(offsetRef.current + 1); return; }
        if (lineKeyBack) { setOffset(offsetRef.current - 1); return; }
        if (event.name === 'pageDown') {
          const { viewportSize: vp } = readMetrics();
          setOffset(offsetRef.current + Math.max(1, vp - 1));
          return;
        }
        if (event.name === 'pageUp') {
          const { viewportSize: vp } = readMetrics();
          setOffset(offsetRef.current - Math.max(1, vp - 1));
          return;
        }
        if (event.name === 'home') { setOffset(0); return; }
        if (event.name === 'end') {
          const { contentSize: cs, viewportSize: vp } = readMetrics();
          setOffset(Math.max(0, cs - vp));
          return;
        }
      },
      { isActive: enabled && isFocused },
    );

    const axisOverflow = isVertical
      ? { overflowX: 'visible' as const, overflowY: 'hidden' as const }
      : { overflowX: 'hidden' as const, overflowY: 'visible' as const };
    const offsetProp = isVertical
      ? { scrollTop: effectiveOffset }
      : { scrollLeft: effectiveOffset };

    return (
      <Box
        ref={boxRef}
        {...(width !== undefined ? { width } : {})}
        {...(height !== undefined ? { height } : {})}
        flexDirection={isVertical ? 'column' : 'row'}
        {...axisOverflow}
        {...offsetProp}
      >
        {children}
      </Box>
    );
  },
);
