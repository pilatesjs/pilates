/**
 * Layout devtools for `@pilates/react` — the first consumer of the
 * phase-9 `@pilates/core` observability API (`setLayoutProfiler`).
 *
 * `useLayoutProfiler()` is the data primitive; `<LayoutDevtools>` is a
 * ready-made overlay built on it. `sparkline` is the pure block-glyph
 * helper the panel renders its recent-cost row with.
 */

import { type LayoutTrace, setLayoutProfiler } from '@pilates/core';
import { type JSX, useEffect, useRef } from 'react';
import { Box, Text } from './components.js';

/** Block glyphs, lowest to highest, for `sparkline`. */
const SPARK_GLYPHS = '▁▂▃▄▅▆▇█';

/**
 * Map a series of non-negative numbers to a sparkline string — one
 * block glyph per value, scaled to the series maximum. An empty
 * series yields `''`; an all-zero series yields all-lowest glyphs.
 */
export function sparkline(values: readonly number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values);
  if (max === 0) return SPARK_GLYPHS[0]!.repeat(values.length);
  const last = SPARK_GLYPHS.length - 1;
  return values
    .map((v) => SPARK_GLYPHS[Math.min(last, Math.max(0, Math.round((v / max) * last)))]!)
    .join('');
}

/** Max traces kept in the rolling history ring buffer. */
const HISTORY_LIMIT = 60;

/** Every engine path a `LayoutTrace` can report. */
type LayoutPath = LayoutTrace['path'];

/** The data `useLayoutProfiler` returns. */
export interface LayoutProfile {
  /** The most recent `LayoutTrace`, or `null` before the first captured layout. */
  last: LayoutTrace | null;
  /** Recent traces, oldest first, capped at 60. */
  history: readonly LayoutTrace[];
  /** Cumulative count of each engine path since the hook mounted. */
  totals: Readonly<Record<LayoutPath, number>>;
}

function emptyTotals(): Record<LayoutPath, number> {
  return { build: 0, graft: 0, detach: 0, reorder: 0, incremental: 0, imperative: 0 };
}

interface ProfileState {
  last: LayoutTrace | null;
  history: LayoutTrace[];
  totals: Record<LayoutPath, number>;
}

/**
 * Observe the Spineless layout engine: returns the latest `LayoutTrace`,
 * a bounded recent history, and cumulative per-path totals.
 *
 * The hook registers a `@pilates/core` profiler listener on mount and
 * clears it on unmount. `setLayoutProfiler` is a single global slot —
 * use **one** `useLayoutProfiler` (or one `<LayoutDevtools>`) per app.
 *
 * The hook does NOT self-trigger re-renders: a profiler's state changes
 * on every layout, so a post-commit force would loop forever. It
 * returns the accumulated state on every render the consumer drives;
 * the panel is thus one completed layout behind — imperceptible in an
 * interactive app, which re-renders to produce the layouts profiled.
 */
export function useLayoutProfiler(): LayoutProfile {
  // Mutable accumulator written by the listener — which fires inside
  // `calculateLayout`, mid-commit, where a React update is unsafe.
  const stateRef = useRef<ProfileState>({
    last: null,
    history: [],
    totals: emptyTotals(),
  });

  useEffect(() => {
    setLayoutProfiler((_root, trace) => {
      const s = stateRef.current;
      s.last = trace;
      s.history.push(trace);
      if (s.history.length > HISTORY_LIMIT) s.history.shift();
      s.totals[trace.path]++;
    });
    return () => setLayoutProfiler(null);
  }, []);

  const s = stateRef.current;
  // Fresh copies so a consumer comparing by identity sees each render.
  return { last: s.last, history: [...s.history], totals: { ...s.totals } };
}

/** Engine paths in panel display order. */
const PATHS: readonly LayoutPath[] = [
  'build',
  'graft',
  'detach',
  'reorder',
  'incremental',
  'imperative',
];

/** Props for `<LayoutDevtools>`. */
export interface LayoutDevtoolsProps {
  /** Corner the overlay anchors to. Default `'top-right'`. */
  placement?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Hide the recent-cost sparkline row. Default `false`. */
  hideSparkline?: boolean;
  /** Panel width in columns. Default `20`. */
  width?: number;
  /** Panel height in rows. Defaults to fit content (11 with sparkline, 10 without). */
  height?: number;
}

function anchorPosition(placement: NonNullable<LayoutDevtoolsProps['placement']>): {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
} {
  switch (placement) {
    case 'top-left':
      return { top: 0, left: 0 };
    case 'top-right':
      return { top: 0, right: 0 };
    case 'bottom-left':
      return { bottom: 0, left: 0 };
    case 'bottom-right':
      return { bottom: 0, right: 0 };
  }
}

/**
 * A live layout-profiler overlay panel. Renders as an
 * absolutely-positioned `<Box>` anchored to a corner — it does not
 * reflow the host app. Shows the latest `LayoutTrace`, a recent-cost
 * sparkline, and cumulative per-path totals.
 *
 * Caveat: being in the host's render tree, the panel's own nodes are
 * counted in the traces it reports — absolute counts run slightly
 * high. The `path` classification is unaffected.
 */
export function LayoutDevtools(props: LayoutDevtoolsProps): JSX.Element {
  const { placement = 'top-right', hideSparkline = false } = props;
  const panelWidth = props.width ?? 20;
  const panelHeight = props.height ?? (hideSparkline ? 10 : 11);
  const { last, history, totals } = useLayoutProfiler();

  return (
    <Box
      positionType="absolute"
      position={anchorPosition(placement)}
      flexDirection="column"
      border="single"
      title="layout"
      width={panelWidth}
      height={panelHeight}
    >
      <Text>{last ? `last: ${last.path}` : 'last: —'}</Text>
      <Text>
        {last ? `recomp ${last.fieldsRecomputed} chg ${last.fieldsChanged}` : 'recomp — chg —'}
      </Text>
      {hideSparkline ? null : (
        <Text>{`cost ${sparkline(history.map((t) => t.fieldsRecomputed))}`}</Text>
      )}
      {PATHS.map((p) => (
        <Text key={p}>{`${p.padEnd(11)} ${totals[p]}`}</Text>
      ))}
    </Box>
  );
}
