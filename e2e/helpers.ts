/**
 * Shared utilities for e2e smoke tests.
 *
 * `mountWithInput()` from `@pilates/react/test-utils` returns the raw ANSI
 * stream produced by the reconciler. Tests want to assert on the visible
 * text, so strip both standard SGR sequences (`\x1b[…m`) and cursor-position
 * codes (`\x1b[…H` / `\x1b[…f`) — `strip-ansi` covers SGR but not the
 * cursor-position family.
 */

import baseStripAnsi from 'strip-ansi';

// Tests that call `act()` directly (e.g. wrapping vi.advanceTimersByTime)
// need the environment flag set; mountWithInput already toggles this for
// its own ops, but external act() calls would otherwise emit
// "not configured to support act" warnings.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

export function strip(s: string): string {
  return (
    baseStripAnsi(s)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: cursor-position escapes
      .replace(/\x1b\[[0-9;]*[Hf]/g, '')
      .replace(/\n+$/, '')
  );
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
