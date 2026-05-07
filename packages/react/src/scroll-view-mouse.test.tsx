import { describe, expect, it } from 'vitest';
import { type RefObject, createElement, useRef } from 'react';
import type { ScrollViewHandle } from './scroll-view.js';
import { ScrollView } from './scroll-view.js';
import { Box } from './components.js';
import { Text } from './components.js';
import { mountWithInput } from './test-utils.js';

describe('ScrollView wheel scrolling', () => {
  it('scrolls down on wheel-down event over the ScrollView', () => {
    let scrollRef: RefObject<ScrollViewHandle | null> = { current: null };
    const { sendMouseEvent, flush } = mountWithInput(
      null,
      () => {
        const ref = useRef<ScrollViewHandle>(null);
        scrollRef = ref;
        return createElement(
          ScrollView,
          { ref, height: 3, scrollEnabled: false },
          createElement(Box, { height: 1 }, createElement(Text, null, 'line1')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line2')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line3')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line4')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line5')),
        );
      },
      { width: 20, height: 5 },
    );
    flush();
    const handle = scrollRef.current!;
    expect(handle.getScrollOffset()).toBe(0);
    sendMouseEvent({ button: 'wheel-down', col: 1, row: 1 });
    flush();
    expect(handle.getScrollOffset()).toBe(1);
  });

  it('scrolls up on wheel-up event', () => {
    let scrollRef: RefObject<ScrollViewHandle | null> = { current: null };
    const { sendMouseEvent, flush } = mountWithInput(
      null,
      () => {
        const ref = useRef<ScrollViewHandle>(null);
        scrollRef = ref;
        return createElement(
          ScrollView,
          { ref, height: 3, scrollEnabled: false },
          createElement(Box, { height: 1 }, createElement(Text, null, 'line1')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line2')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line3')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line4')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line5')),
        );
      },
      { width: 20, height: 5 },
    );
    flush();
    const handle = scrollRef.current!;
    handle.scrollTo(2);
    flush();
    sendMouseEvent({ button: 'wheel-up', col: 1, row: 1 });
    flush();
    expect(handle.getScrollOffset()).toBe(1);
  });

  it('does not scroll when scrollEnabled is false and no onWheel', () => {
    let scrollRef: RefObject<ScrollViewHandle | null> = { current: null };
    const { flush } = mountWithInput(
      null,
      () => {
        const ref = useRef<ScrollViewHandle>(null);
        scrollRef = ref;
        return createElement(
          ScrollView,
          { ref, height: 3, scrollEnabled: false },
          createElement(Box, { height: 1 }, createElement(Text, null, 'line1')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line2')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line3')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line4')),
        );
      },
      { width: 20, height: 5 },
    );
    flush();
    expect(scrollRef.current!.getScrollOffset()).toBe(0);
  });

  it('nested ScrollViews: inner consumes wheel, outer does not scroll', () => {
    let outerRef: RefObject<ScrollViewHandle | null> = { current: null };
    let innerRef: RefObject<ScrollViewHandle | null> = { current: null };
    const { sendMouseEvent, flush } = mountWithInput(
      null,
      () => {
        const oRef = useRef<ScrollViewHandle>(null);
        const iRef = useRef<ScrollViewHandle>(null);
        outerRef = oRef;
        innerRef = iRef;
        return createElement(
          ScrollView,
          { ref: oRef, height: 6, scrollEnabled: false },
          createElement(Box, { height: 1 }, createElement(Text, null, 'outer1')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'outer2')),
          createElement(
            ScrollView,
            { ref: iRef, height: 2, scrollEnabled: false },
            createElement(Box, { height: 1 }, createElement(Text, null, 'inner1')),
            createElement(Box, { height: 1 }, createElement(Text, null, 'inner2')),
            createElement(Box, { height: 1 }, createElement(Text, null, 'inner3')),
          ),
        );
      },
      { width: 20, height: 10 },
    );
    flush();
    const outerHandle = outerRef.current!;
    const innerHandle = innerRef.current!;
    // Click inside inner scroll view area (row 3 = after 2 outer rows)
    sendMouseEvent({ button: 'wheel-down', col: 1, row: 3 });
    flush();
    expect(innerHandle.getScrollOffset()).toBe(1);
    expect(outerHandle.getScrollOffset()).toBe(0);
  });
});
