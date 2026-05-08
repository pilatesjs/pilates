/**
 * Layout-engine caches.
 *
 * Phase 1: `MeasureCache` — caches the result of a leaf node's
 * `MeasureFunc` so repeated calls with the same available-space
 * inputs don't reinvoke the measurer. Wired into every measure-func
 * call site in `main-axis.ts` via the `callMeasureFunc` helper.
 *
 * Caches are owned by `Node` (`_measureCache` field) and cleared
 * automatically by `markDirty()`. Consumers never interact with the
 * cache directly — it is `@internal`.
 *
 * Phase 2 added `LayoutCache` here (P2-T1).
 *
 * @internal
 */

import type { ComputedLayout } from '../layout.js';
import type { MeasureMode } from '../measure-func.js';
import type { Node } from '../node.js';

/** @internal */
export interface MeasureCacheKey {
  availableWidth: number;
  widthMode: MeasureMode;
  availableHeight: number;
  heightMode: MeasureMode;
}

/** @internal */
export interface MeasureCacheValue {
  width: number;
  height: number;
}

/**
 * Up to eight slots — matches Yoga's `LayoutResults::MaxCachedMeasurements`
 * with the documented rationale "98% of analyzed layouts require less
 * than 8 entries" (see facebook/yoga `node/LayoutResults.h`). Covers the
 * hypothetical-vs-final pattern (single leaf measured twice per pass)
 * plus broader reuse patterns where the same leaf is measured at multiple
 * cross-axis sizes during line packing or across consecutive layout calls.
 *
 * Linear scan over 8 slots is a few-cycle hot-path cost; slots are
 * lazy-allocated only on leaves with a `MeasureFunc` installed.
 *
 * @internal
 */
export class MeasureCache {
  private static readonly MAX_ENTRIES = 8;
  private slots: Array<MeasureCacheKey & MeasureCacheValue> = [];

  /**
   * Hit/miss counters for diagnostics (bench output, debugging). Always
   * on — the spec originally proposed `__DEV__`-gating these, but the
   * project has no build-tooling `__DEV__` define and the counters cost
   * two property writes per `lookup()` (negligible at any realistic
   * call rate). Counts are incremented only by `lookup()`; `store()`
   * assumes `lookup()` has already been called for the same key on the
   * same call site, so it does not double-count.
   *
   * @internal
   */
  hits = 0;
  /** See {@link hits}. @internal */
  misses = 0;

  lookup(key: MeasureCacheKey): MeasureCacheValue | undefined {
    for (const slot of this.slots) {
      if (
        slot.availableWidth === key.availableWidth &&
        slot.widthMode === key.widthMode &&
        slot.availableHeight === key.availableHeight &&
        slot.heightMode === key.heightMode
      ) {
        this.hits++;
        return { width: slot.width, height: slot.height };
      }
    }
    this.misses++;
    return undefined;
  }

  /**
   * Store `value` for `key`. If `key` is already present, overwrite in
   * place without growing the slot array; otherwise append, evicting
   * the oldest slot when the array is at `MAX_ENTRIES` capacity.
   *
   * Callers should always invoke `lookup(key)` first and only call
   * `store()` on a miss — the `misses` counter is incremented by
   * `lookup()`, not here, so calling `store()` without a prior lookup
   * would cause silent miss undercounting in diagnostics.
   */
  store(key: MeasureCacheKey, value: MeasureCacheValue): void {
    for (const slot of this.slots) {
      if (
        slot.availableWidth === key.availableWidth &&
        slot.widthMode === key.widthMode &&
        slot.availableHeight === key.availableHeight &&
        slot.heightMode === key.heightMode
      ) {
        slot.width = value.width;
        slot.height = value.height;
        return;
      }
    }
    if (this.slots.length < MeasureCache.MAX_ENTRIES) {
      this.slots.push({ ...key, ...value });
    } else {
      this.slots.shift();
      this.slots.push({ ...key, ...value });
    }
  }

  /**
   * Drop every cached entry. The `hits`/`misses` counters are
   * deliberately preserved across `clear()` calls — they're lifetime
   * diagnostics, not per-pass metrics, and zeroing them would mask the
   * total-pressure picture during bench runs.
   */
  clear(): void {
    this.slots.length = 0;
  }
}

/** @internal */
export interface LayoutCacheKey {
  availableWidth: number;
  widthMode: MeasureMode;
  availableHeight: number;
  heightMode: MeasureMode;
  // parentDirection deliberately NOT keyed — Yoga (LayoutResults.h) and
  // Taffy (tree/cache.rs) both treat it as implicit in available
  // {width,height} since flex algorithms reorient at each parent.
  // Differential mode catches divergence if this assumption is ever wrong.
}

/** @internal */
export interface CachedChildLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
}

/** @internal */
export interface LayoutCacheValue {
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
  childLayouts: CachedChildLayout[];
}

/**
 * Single-slot per-node layout cache. Matches Yoga's `cachedLayout`
 * (single overwrite-on-write) and Taffy's 1-slot layout-cache. Internal
 * nodes' final-pass keys converge to one stable input once the parent's
 * flex distribution has settled, so additional slots would be dead memory.
 *
 * Lazy-allocated by the algorithm in `algorithm/main-axis.ts` and
 * `algorithm/index.ts` only on nodes that actually go through the
 * `layoutChildren` recursion. Cleared by `Node.markDirty()` (which fires
 * on every style/tree mutation).
 *
 * Hit/miss counters are always-on (same rationale as `MeasureCache`).
 *
 * @internal
 */
export class LayoutCache {
  private slot: (LayoutCacheKey & { value: LayoutCacheValue }) | undefined = undefined;

  /** @internal */
  hits = 0;
  /** @internal */
  misses = 0;

  lookup(key: LayoutCacheKey): LayoutCacheValue | undefined {
    const slot = this.slot;
    if (
      slot !== undefined &&
      slot.availableWidth === key.availableWidth &&
      slot.widthMode === key.widthMode &&
      slot.availableHeight === key.availableHeight &&
      slot.heightMode === key.heightMode
    ) {
      this.hits++;
      return slot.value;
    }
    this.misses++;
    return undefined;
  }

  /**
   * Store `value` for `key`. Single-slot — replaces the previous entry
   * unconditionally. Caller must construct a fresh `LayoutCacheValue` per
   * store; this method does NOT deep-clone for performance, so any
   * subsequent mutation of `value` is visible through `lookup`. The
   * algorithm builds new values per layout pass so the contract holds.
   */
  store(key: LayoutCacheKey, value: LayoutCacheValue): void {
    this.slot = { ...key, value };
  }

  clear(): void {
    this.slot = undefined;
  }
}

/**
 * Pre-order traversal returning a flat array of layout snapshots, one per
 * node. Used by differential mode to capture and compare the entire tree's
 * layout state cheaply.
 *
 * Captures only the six `ComputedLayout` fields. `_dirty` flags, cache
 * contents, and other ancillary state are NOT in scope. Phase 2's
 * layout-cache work should add `_dirty` validation to the harness if
 * dirty-flag semantics ever become load-bearing for cache correctness.
 *
 * @internal
 */
export function snapshotTreeLayouts(root: Node): ComputedLayout[] {
  const out: ComputedLayout[] = [];
  visit(root);
  return out;

  function visit(n: Node): void {
    out.push({
      left: n.layout.left,
      top: n.layout.top,
      width: n.layout.width,
      height: n.layout.height,
      scrollWidth: n.layout.scrollWidth,
      scrollHeight: n.layout.scrollHeight,
    });
    for (let i = 0; i < n.getChildCount(); i++) visit(n.getChild(i)!);
  }
}

/**
 * Recursively clear `_measureCache` and `_layoutCache` on every node in
 * the subtree. Used by differential mode and the fuzzer to force the cold
 * path.
 *
 * @internal
 */
export function clearAllCaches(root: Node): void {
  root._measureCache?.clear();
  root._layoutCache?.clear();
  for (let i = 0; i < root.getChildCount(); i++) clearAllCaches(root.getChild(i)!);
}

/**
 * Mark every node in the subtree dirty. Used after `clearAllCaches` to
 * force `calculateLayout` down the full cold path.
 *
 * Note: `Node.markDirty()` also calls `_measureCache?.clear()` as a
 * side-effect of dirtying. So calling `clearAllCaches(root)` then
 * `markDirtyDeep(root)` clears each leaf's measure cache twice. The
 * second clear is harmless (no-op on an empty slot array), but
 * differential-mode callers should know the redundancy is intentional —
 * we want both invariants explicit at the call site.
 *
 * @internal
 */
export function markDirtyDeep(root: Node): void {
  root.markDirty();
  for (let i = 0; i < root.getChildCount(); i++) markDirtyDeep(root.getChild(i)!);
}

/**
 * Produce a human-readable diff of two tree-layout snapshots. Returns
 * an empty string if they match. Used by differential mode to surface
 * cache bugs with enough context to debug them.
 *
 * @internal
 */
export function diffLayouts(a: ComputedLayout[], b: ComputedLayout[]): string {
  if (a.length !== b.length) {
    return `tree length mismatch: cached has ${a.length} nodes, cold has ${b.length}`;
  }
  const fields = ['left', 'top', 'width', 'height', 'scrollWidth', 'scrollHeight'] as const;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    for (const f of fields) {
      if (av[f] !== bv[f]) {
        return `node[${i}].${f}: cached=${av[f]} cold=${bv[f]}`;
      }
    }
  }
  return '';
}
