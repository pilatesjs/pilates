/**
 * Strip ANSI escape sequences for measurement purposes.
 *
 * Handles the escape forms that show up in TTY output:
 *   - CSI sequences:  ESC '[' ... <final byte 0x40-0x7E>     (e.g. SGR colors)
 *   - OSC sequences:  ESC ']' ... (BEL | ESC '\\' | ST 0x9C)  (e.g. hyperlinks, titles)
 *   - Two-byte ESC:   ESC <0x40-0x5F>                         (e.g. ESC = / ESC >)
 *   - DCS / SOS / PM / APC: ESC (P | X | ^ | _) ... ST        (treated like OSC)
 *   - Bare 0x9B (CSI) and 0x9D (OSC) C1 controls
 *
 * Does NOT strip C0 control characters (BS, BEL, etc.) other than the escape
 * itself — those are the caller's concern.
 */

const ESC = 0x1b;
const BEL = 0x07;
const CSI_C1 = 0x9b;
const OSC_C1 = 0x9d;
const ST_C1 = 0x9c;
const DCS_C1 = 0x90;
const SOS_C1 = 0x98;
const PM_C1 = 0x9e;
const APC_C1 = 0x9f;

export function stripAnsi(input: string): string {
  if (input.length === 0) return input;

  let out = '';
  let i = 0;
  const len = input.length;

  while (i < len) {
    const cp = input.charCodeAt(i);

    if (cp === ESC) {
      const next = i + 1 < len ? input.charCodeAt(i + 1) : -1;
      if (next === 0x5b /* '[' */ || next === CSI_C1) {
        i = skipCsi(input, i + 2);
        continue;
      }
      if (next === 0x5d /* ']' */) {
        i = skipString(input, i + 2);
        continue;
      }
      if (
        next === 0x50 /* P, DCS */ ||
        next === 0x58 /* X, SOS */ ||
        next === 0x5e /* ^, PM */ ||
        next === 0x5f /* _, APC */
      ) {
        i = skipString(input, i + 2);
        continue;
      }
      if (next >= 0x40 && next <= 0x5f) {
        // ESC <Fe> — two-byte sequence (handled above for CSI/OSC; this is the rest)
        i += 2;
        continue;
      }
      if (next >= 0x20 && next <= 0x2f) {
        // ESC <intermediate>* <final> — e.g. character set selection
        let j = i + 2;
        while (j < len) {
          const c = input.charCodeAt(j);
          if (c >= 0x30 && c <= 0x7e) {
            j++;
            break;
          }
          if (c >= 0x20 && c <= 0x2f) {
            j++;
            continue;
          }
          break;
        }
        i = j;
        continue;
      }
      // Lone ESC — drop it.
      i += 1;
      continue;
    }

    if (cp === CSI_C1) {
      i = skipCsi(input, i + 1);
      continue;
    }
    if (cp === OSC_C1 || cp === DCS_C1 || cp === SOS_C1 || cp === PM_C1 || cp === APC_C1) {
      i = skipString(input, i + 1);
      continue;
    }

    out += input[i];
    i++;
  }
  return out;
}

/** Skip a CSI body: parameters and intermediates, then a final byte 0x40..0x7E. */
function skipCsi(s: string, start: number): number {
  const len = s.length;
  let i = start;
  while (i < len) {
    const c = s.charCodeAt(i);
    if (c >= 0x40 && c <= 0x7e) return i + 1;
    i++;
  }
  return i;
}

/**
 * Skip an OSC/DCS/SOS/PM/APC body until ST (ESC '\\' or 0x9C) or BEL.
 * We accept BEL as an OSC terminator because xterm and most modern terminals do.
 */
function skipString(s: string, start: number): number {
  const len = s.length;
  let i = start;
  while (i < len) {
    const c = s.charCodeAt(i);
    if (c === BEL || c === ST_C1) return i + 1;
    if (c === ESC && i + 1 < len && s.charCodeAt(i + 1) === 0x5c /* '\\' */) {
      return i + 2;
    }
    i++;
  }
  return i;
}
