/**
 * Grapheme cluster segmentation per UAX #29 (subset adequate for terminal text).
 *
 * Implements rules GB1, GB2, GB3, GB4, GB5, GB6, GB7, GB8, GB9, GB9a, GB9b,
 * GB11 (extended pictographic + ZWJ + extended pictographic), GB12/GB13
 * (regional indicator pairs), and GB999 (otherwise break).
 *
 * Operates on Unicode code points, not UTF-16 code units, so surrogate pairs
 * are handled via String.prototype.codePointAt in the iterator.
 */

import { inRanges } from './range-search.js';
import {
  EXT_PICTOGRAPHIC_RANGES,
  GB_CONTROL,
  GB_EXTEND,
  GB_L,
  GB_LV,
  GB_LVT,
  GB_PREPEND,
  GB_REGIONAL_INDICATOR,
  GB_SPACINGMARK,
  GB_T,
  GB_V,
  GB_ZWJ,
} from './tables.js';

export enum GBC {
  Other = 0,
  CR = 1,
  LF = 2,
  Control = 3,
  Extend = 4,
  ZWJ = 5,
  Regional_Indicator = 6,
  Prepend = 7,
  SpacingMark = 8,
  L = 9,
  V = 10,
  T = 11,
  LV = 12,
  LVT = 13,
  // Synthetic — drives GB11.
  ExtPict = 14,
}

export function gbClass(cp: number): GBC {
  if (cp === 0x000d) return GBC.CR;
  if (cp === 0x000a) return GBC.LF;
  if (inRanges(cp, GB_CONTROL)) return GBC.Control;
  if (inRanges(cp, GB_ZWJ)) return GBC.ZWJ;
  if (inRanges(cp, GB_EXTEND)) return GBC.Extend;
  if (inRanges(cp, GB_REGIONAL_INDICATOR)) return GBC.Regional_Indicator;
  if (inRanges(cp, GB_PREPEND)) return GBC.Prepend;
  if (inRanges(cp, GB_SPACINGMARK)) return GBC.SpacingMark;
  if (inRanges(cp, GB_L)) return GBC.L;
  if (inRanges(cp, GB_V)) return GBC.V;
  if (inRanges(cp, GB_T)) return GBC.T;
  if (inRanges(cp, GB_LV)) return GBC.LV;
  if (inRanges(cp, GB_LVT)) return GBC.LVT;
  if (inRanges(cp, EXT_PICTOGRAPHIC_RANGES)) return GBC.ExtPict;
  return GBC.Other;
}

/**
 * Decide whether a break occurs between `prev` and `next`.
 *
 * `state` carries information used by GB11 (saw an extended pictographic
 * followed by zero or more Extend, then a ZWJ?) and GB12/13 (parity of
 * regional indicators in the current run).
 */
interface BreakState {
  /** GB11: most recent base was Extended_Pictographic, optionally followed by Extend, then ZWJ. */
  gb11Armed: boolean;
  /** GB11: most recent base was Extended_Pictographic (possibly followed by Extend). */
  gb11Pictographic: boolean;
  /** GB12/13: number of consecutive Regional_Indicators in the current run (mod 2). */
  riCount: number;
}

function freshState(): BreakState {
  return { gb11Armed: false, gb11Pictographic: false, riCount: 0 };
}

function shouldBreak(prev: GBC, next: GBC, state: BreakState): boolean {
  // GB3: CR × LF
  if (prev === GBC.CR && next === GBC.LF) return false;
  // GB4: (Control | CR | LF) ÷
  if (prev === GBC.Control || prev === GBC.CR || prev === GBC.LF) return true;
  // GB5: ÷ (Control | CR | LF)
  if (next === GBC.Control || next === GBC.CR || next === GBC.LF) return true;

  // GB6: L × (L | V | LV | LVT)
  if (prev === GBC.L && (next === GBC.L || next === GBC.V || next === GBC.LV || next === GBC.LVT))
    return false;
  // GB7: (LV | V) × (V | T)
  if ((prev === GBC.LV || prev === GBC.V) && (next === GBC.V || next === GBC.T)) return false;
  // GB8: (LVT | T) × T
  if ((prev === GBC.LVT || prev === GBC.T) && next === GBC.T) return false;

  // GB9: × (Extend | ZWJ)
  if (next === GBC.Extend || next === GBC.ZWJ) return false;
  // GB9a: × SpacingMark
  if (next === GBC.SpacingMark) return false;
  // GB9b: Prepend ×
  if (prev === GBC.Prepend) return false;

  // GB11: \p{Extended_Pictographic} Extend* ZWJ × \p{Extended_Pictographic}
  if (state.gb11Armed && next === GBC.ExtPict) return false;

  // GB12/13: regional indicators come in pairs.
  if (prev === GBC.Regional_Indicator && next === GBC.Regional_Indicator) {
    return state.riCount % 2 === 0;
  }

  // GB999: otherwise break.
  return true;
}

function advanceState(state: BreakState, cls: GBC): void {
  // GB11 state machine.
  if (cls === GBC.ExtPict) {
    state.gb11Pictographic = true;
    state.gb11Armed = false;
  } else if (cls === GBC.Extend && state.gb11Pictographic) {
    // stay armed-able
  } else if (cls === GBC.ZWJ && state.gb11Pictographic) {
    state.gb11Armed = true;
    state.gb11Pictographic = false;
  } else {
    state.gb11Pictographic = false;
    state.gb11Armed = false;
  }

  // GB12/13 RI parity.
  if (cls === GBC.Regional_Indicator) {
    state.riCount += 1;
  } else {
    state.riCount = 0;
  }
}

/**
 * Iterate grapheme clusters in `s`. Each yielded value is an object with the
 * cluster string, its starting JS code-unit index, and the array of code points
 * it contains. The code points are useful for downstream width calculations.
 */
export function* graphemes(s: string): Generator<Grapheme> {
  if (s.length === 0) return;

  const len = s.length;
  let i = 0;

  let clusterStart = 0;
  let clusterCps: number[] = [];
  let prevClass: GBC | null = null;
  const state = freshState();

  while (i < len) {
    const cp = s.codePointAt(i)!;
    const step = cp > 0xffff ? 2 : 1;
    const cls = gbClass(cp);

    if (prevClass !== null && shouldBreak(prevClass, cls, state)) {
      yield {
        text: s.slice(clusterStart, i),
        start: clusterStart,
        codepoints: clusterCps,
      };
      clusterStart = i;
      clusterCps = [];
      // Reset the GB12/13 RI parity at every break.
      state.riCount = 0;
    }

    clusterCps.push(cp);
    advanceState(state, cls);
    prevClass = cls;
    i += step;
  }

  yield {
    text: s.slice(clusterStart, len),
    start: clusterStart,
    codepoints: clusterCps,
  };
}

export interface Grapheme {
  /** The substring of the cluster, as originally encoded. */
  text: string;
  /** Starting JS code-unit index in the source string. */
  start: number;
  /** Code points in the cluster, in order. */
  codepoints: number[];
}
