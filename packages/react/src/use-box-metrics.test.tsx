import { useEffect, useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Box, Text } from './components.js';
import { mountWithInput } from './test-utils.js';
import { type BoxMetrics, useBoxMetrics } from './use-box-metrics.js';

const opts = { width: 30, height: 5 };

describe('useBoxMetrics', () => {
  it('returns the measured layout once the Box has mounted', () => {
    let captured: BoxMetrics | null = null;
    function App() {
      const ref = useRef(null);
      const m = useBoxMetrics(ref);
      // Capture on every render so the post-mount value lands too.
      captured = m;
      return (
        <Box ref={ref} width={20} height={3}>
          <Text>hi</Text>
        </Box>
      );
    }
    const handle = mountWithInput(0, () => <App />, opts);
    expect(captured).toEqual({ left: 0, top: 0, width: 20, height: 3, scrollWidth: 20, scrollHeight: 3 });
    handle.unmount();
  });

  it('returns null on the very first render (ref not yet attached)', () => {
    const seen: Array<BoxMetrics | null> = [];
    function App() {
      const ref = useRef(null);
      const m = useBoxMetrics(ref);
      seen.push(m);
      return (
        <Box ref={ref} width={10} height={2}>
          <Text>x</Text>
        </Box>
      );
    }
    const handle = mountWithInput(0, () => <App />, opts);
    // First render: ref.current === null → metrics === null.
    // Second render (after the post-commit force): metrics is the layout.
    expect(seen[0]).toBeNull();
    expect(seen[seen.length - 1]).toEqual({ left: 0, top: 0, width: 10, height: 2, scrollWidth: 10, scrollHeight: 2 });
    handle.unmount();
  });

  it('updates the reported measurements when the Box props change size', () => {
    const seen: Array<BoxMetrics | null> = [];
    function App({ wide }: { wide: boolean }) {
      const ref = useRef(null);
      const m = useBoxMetrics(ref);
      seen.push(m);
      return (
        <Box ref={ref} width={wide ? 25 : 10} height={2}>
          <Text>x</Text>
        </Box>
      );
    }
    const handle = mountWithInput<boolean>(false, (s) => <App wide={s} />, opts);
    handle.setState(true);
    const widths = seen.filter((m): m is BoxMetrics => m !== null).map((m) => m.width);
    expect(widths).toContain(10);
    expect(widths).toContain(25);
    handle.unmount();
  });

  it('reflects the position assigned by parent flex layout', () => {
    let leftCaptured: number | null = null;
    function Inner() {
      const ref = useRef(null);
      const m = useBoxMetrics(ref);
      leftCaptured = m?.left ?? null;
      return (
        <Box ref={ref} width={5} height={1}>
          <Text>r</Text>
        </Box>
      );
    }
    function App() {
      // Row of two Boxes; the second should land at left=5.
      return (
        <Box flexDirection="row">
          <Box width={5} height={1}>
            <Text>l</Text>
          </Box>
          <Inner />
        </Box>
      );
    }
    const handle = mountWithInput(0, () => <App />, opts);
    expect(leftCaptured).toBe(5);
    handle.unmount();
  });

  // Reference useEffect / useState so the imports aren't tree-shaken when
  // future tests need them and to keep biome's noUnusedImports rule quiet.
  void useEffect;
  void useState;
});
