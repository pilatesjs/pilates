import { setLayoutProfiler, stripAnsi } from '@pilates/core';
import { afterEach, describe, expect, it } from 'vitest';
import { Box, Text } from './components.js';
import {
  LayoutDevtools,
  type LayoutProfile,
  sparkline,
  useLayoutProfiler,
} from './layout-devtools.js';
import { mountWithInput } from './test-utils.js';

afterEach(() => {
  setLayoutProfiler(null);
});

describe('sparkline', () => {
  it('returns an empty string for an empty series', () => {
    expect(sparkline([])).toBe('');
  });

  it('returns all-low glyphs for an all-zero series', () => {
    expect(sparkline([0, 0, 0])).toBe('▁▁▁');
  });

  it('scales values to block glyphs against the series max', () => {
    // max 8 → 0 maps to the lowest glyph, 8 to the highest.
    expect(sparkline([0, 8])).toBe('▁█');
  });

  it('emits exactly one glyph per value', () => {
    expect(sparkline([1, 2, 3, 4, 5])).toHaveLength(5);
  });
});

const opts = { width: 30, height: 8 };

describe('useLayoutProfiler', () => {
  it('starts empty, then accumulates traces as the app relays out', () => {
    let captured: LayoutProfile | null = null;
    function App() {
      captured = useLayoutProfiler();
      return (
        <Box width={10} height={3}>
          <Text>hi</Text>
        </Box>
      );
    }
    const handle = mountWithInput(0, () => <App />, opts);
    // Mount render captured the profile before the post-commit effect
    // registered the profiler — so `last` is still null.
    expect(captured!.last).toBeNull();
    // Each setState commits, lays out, and fires the now-registered
    // profiler; the following render reads the accumulated ref.
    // Three setState calls produce three layouts, but the hook's
    // one-render lag means `captured` reflects N-1 = 2 of them.
    handle.setState(1);
    handle.setState(2);
    handle.setState(3);
    expect(captured!.last).not.toBeNull();
    const total =
      captured!.totals.build +
      captured!.totals.graft +
      captured!.totals.detach +
      captured!.totals.reorder +
      captured!.totals.incremental +
      captured!.totals.imperative;
    expect(total).toBeGreaterThanOrEqual(2);
    handle.unmount();
  });

  it('caps history at 60 traces', () => {
    let captured: LayoutProfile | null = null;
    function App() {
      captured = useLayoutProfiler();
      return (
        <Box width={10} height={3}>
          <Text>x</Text>
        </Box>
      );
    }
    const handle = mountWithInput(0, () => <App />, opts);
    for (let i = 1; i <= 70; i++) handle.setState(i);
    expect(captured!.history.length).toBeLessThanOrEqual(60);
    handle.unmount();
  });
});

const panelOpts = { width: 40, height: 14 };

describe('LayoutDevtools', () => {
  it('renders an overlay panel showing the latest engine path', () => {
    function App() {
      return (
        <Box width={40} height={14}>
          <Text>app body</Text>
          <LayoutDevtools />
        </Box>
      );
    }
    const handle = mountWithInput(0, () => <App />, panelOpts);
    handle.setState(1);
    handle.setState(2);
    const out = stripAnsi(handle.allWrites());
    expect(out).toContain('last:');
    expect(out).toMatch(/incremental|build|imperative/);
    handle.unmount();
  });

  it('hideSparkline drops the cost row', () => {
    function App({ hide }: { hide: boolean }) {
      return (
        <Box width={40} height={14}>
          <LayoutDevtools hideSparkline={hide} />
        </Box>
      );
    }
    const shown = mountWithInput(0, () => <App hide={false} />, panelOpts);
    shown.setState(1);
    expect(stripAnsi(shown.allWrites())).toContain('cost');
    shown.unmount();

    const hidden = mountWithInput(0, () => <App hide={true} />, panelOpts);
    hidden.setState(1);
    expect(stripAnsi(hidden.allWrites())).not.toContain('cost');
    hidden.unmount();
  });

  it('renders for a non-default placement', () => {
    function App() {
      return (
        <Box width={40} height={14}>
          <LayoutDevtools placement="bottom-left" />
        </Box>
      );
    }
    const handle = mountWithInput(0, () => <App />, panelOpts);
    handle.setState(1);
    expect(stripAnsi(handle.allWrites())).toContain('last:');
    handle.unmount();
  });
});
