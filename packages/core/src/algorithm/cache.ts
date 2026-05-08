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
 * Phase 2 will add `LayoutCache` here.
 *
 * @internal
 */

import type { MeasureMode } from '../measure-func.js';

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
