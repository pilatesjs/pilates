/**
 * Cell-width measurement for terminal text.
 *
 *   cellWidth(cp)         — width of a single Unicode code point: 0 | 1 | 2.
 *   stringWidth(s)        — visual cell width of a string, in monospace cells.
 *
 * Strategy:
 *   - ASCII fast-path for the common case.
 *   - Zero width for C0/C1 controls (other than tab/newline which the caller
 *     should handle explicitly), zero-width joiners, default-ignorables, and
 *     Mn/Me/SpacingMark Extend characters.
 *   - Width 2 for East Asian Wide / Fullwidth and Emoji_Presentation code
 *     points.
 *   - The width of a *grapheme cluster* is determined by its base:
 *       * Regional indicator pair → 2 (flag).
 *       * Extended_Pictographic anywhere in the cluster, OR a VS16 (U+FE0F)
 *         emoji presentation selector → 2.
 *       * Otherwise → max(width of base codepoint, 1) — but combining
 *         marks contribute 0 and never expand the cluster.
 *
 * stringWidth() strips ANSI escapes before measuring, so it is safe to feed
 * styled strings.
 */

import { stripAnsi } from './ansi.js';
import { graphemes } from './grapheme.js';
import { inRanges } from './range-search.js';
import {
  DEFAULT_IGNORABLE,
  EMOJI_PRESENTATION_RANGES,
  EXT_PICTOGRAPHIC_RANGES,
  GB_EXTEND,
  GB_ZWJ,
  WIDE_RANGES,
} from './tables.js';

const VS16 = 0xfe0f;

/**
 * Width of a single code point. Does NOT account for grapheme context — for
 * accurate string measurement use `stringWidth`.
 */
export function cellWidth(cp: number): 0 | 1 | 2 {
  // ASCII printable.
  if (cp >= 0x20 && cp < 0x7f) return 1;
  // C0 controls (other than null) — render as 0 cells; caller handles tab/newline.
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  // Combining marks / ZWJ / default ignorables — zero width.
  if (inRanges(cp, GB_EXTEND)) return 0;
  if (inRanges(cp, GB_ZWJ)) return 0;
  if (inRanges(cp, DEFAULT_IGNORABLE)) return 0;
  // Wide / fullwidth.
  if (inRanges(cp, WIDE_RANGES)) return 2;
  // Emoji that default to emoji presentation are width 2.
  if (inRanges(cp, EMOJI_PRESENTATION_RANGES)) return 2;
  // Everything else (ambiguous, narrow, neutral) is width 1.
  return 1;
}

/** Cell width of a single grapheme cluster, given its constituent code points. */
function graphemeWidth(cps: readonly number[]): 0 | 1 | 2 {
  if (cps.length === 0) return 0;
  const base = cps[0]!;

  // Flag: pair of regional indicators.
  if (cps.length >= 2 && isRegionalIndicator(base) && isRegionalIndicator(cps[1]!)) {
    return 2;
  }

  // VS16 emoji presentation selector forces width 2.
  if (cps.includes(VS16)) return 2;

  // Any Extended_Pictographic codepoint in the cluster (e.g. emoji ZWJ
  // sequence like 👨‍👩‍👧) → width 2.
  for (const cp of cps) {
    if (inRanges(cp, EXT_PICTOGRAPHIC_RANGES)) return 2;
  }

  return cellWidth(base);
}

function isRegionalIndicator(cp: number): boolean {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

/**
 * Visual cell width of `s` in monospace cells. Strips ANSI escapes first.
 *
 * Returns 0 for empty strings. Counts grapheme clusters using UAX #29 rules,
 * then sums per-cluster widths under the policy described at the top of the
 * file.
 */
export function stringWidth(s: string): number {
  if (s.length === 0) return 0;
  const cleaned = stripAnsi(s);
  let total = 0;
  for (const g of graphemes(cleaned)) {
    total += graphemeWidth(g.codepoints);
  }
  return total;
}
