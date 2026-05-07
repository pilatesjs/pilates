import type { ContainerNode } from '@pilates/render';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { useStdout } from './hooks.js';

export interface BoxMetrics {
  /** Left offset relative to the root container, in cells. */
  left: number;
  /** Top offset relative to the root container, in cells. */
  top: number;
  /** Width in cells. */
  width: number;
  /** Height in cells. */
  height: number;
  /**
   * Total scrollable content width in cells. Equal to `width` when content
   * does not overflow horizontally.
   */
  scrollWidth: number;
  /**
   * Total scrollable content height in cells. Equal to `height` when content
   * does not overflow vertically.
   */
  scrollHeight: number;
}

/**
 * Pilates host instances are opaque to consumers — they're returned by the
 * reconciler's `getPublicInstance` and shaped per `host-config.ts`. We don't
 * export the `BoxInstance` type publicly to avoid coupling consumers to the
 * internal shape; here we narrow just enough to read the underlying
 * RenderNode's `_layout` field.
 */
interface BoxLikeInstance {
  kind: 'box';
  node: ContainerNode & { _layout?: BoxMetrics };
}

/**
 * Read the most recent computed layout (left / top / width / height) of a
 * `<Box>` referenced by `ref`. Returns `null` until the ref attaches and
 * the first layout pass completes.
 *
 * The hook tracks two re-render triggers so consumers see fresh values:
 *
 *   1. **SIGWINCH** via `useStdout()` — terminal resize re-renders the
 *      consumer because `columns` / `rows` are part of the dep graph.
 *   2. **Post-commit force** via a `useEffect` that bumps an internal
 *      version after every commit. Without this, a layout change driven
 *      purely by sibling state (which doesn't re-render the consumer)
 *      would leave the consumer reading stale metrics.
 *
 * Consumers should treat the return value as advisory: it reflects the
 * layout AT THE TIME of the consumer's render, which is one commit
 * behind the actual frame for the very first mount (`null` until the
 * post-commit effect bumps).
 */
export function useBoxMetrics(ref: RefObject<unknown>): BoxMetrics | null {
  // Tap useStdout so we re-render on SIGWINCH (its columns/rows update
  // there). The actual values are unused — the hook just needs the
  // dep-graph edge.
  useStdout();
  const [, force] = useState(0);
  // After every commit, peek at the post-layout `_layout` and force a
  // re-render iff it differs from what we last reported. The unconditional
  // version of this effect would loop forever (force → render → effect →
  // force …); the layout-key comparison breaks the cycle once the layout
  // is stable. This still produces one extra render per real layout
  // change — acceptable cost for a hook used sparingly in animation /
  // popover / responsive-breakpoint code.
  const lastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const inst = ref.current as BoxLikeInstance | null;
    const layout = inst?.kind === 'box' ? inst.node._layout : undefined;
    const key = layout
      ? `${layout.left},${layout.top},${layout.width},${layout.height},${layout.scrollWidth},${layout.scrollHeight}`
      : 'null';
    if (lastKeyRef.current !== key) {
      lastKeyRef.current = key;
      force((n) => n + 1);
    }
  });

  const inst = ref.current as BoxLikeInstance | null;
  if (!inst || inst.kind !== 'box') return null;
  const layout = inst.node._layout;
  if (!layout) return null;
  // Return a fresh object so consumers comparing by identity see a change
  // (e.g., Object.is checks in their own useEffect deps).
  return {
    left: layout.left,
    top: layout.top,
    width: layout.width,
    height: layout.height,
    scrollWidth: layout.scrollWidth ?? layout.width,
    scrollHeight: layout.scrollHeight ?? layout.height,
  };
}
