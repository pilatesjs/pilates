import { isPilatesError } from './pilates-error.js';

/**
 * Multi-line human-readable formatting of a PilatesError. Used by the default
 * ErrorBoundary fallback and (Phase 2) the in-frame ErrorOverview panel.
 *
 * Format:
 *   Pilates: <message>
 *     hint: <hint>           (dev only; omitted when hint is absent)
 *     caused by: <cause>     (recursive — indented two spaces per nesting)
 *
 * Plain Error / unknown values fall through to a single-line representation.
 */
export function formatPilatesError(err: unknown): string {
  if (isPilatesError(err)) {
    const lines = [`Pilates: ${err.message}`];
    if (err.hint) lines.push(`  hint: ${err.hint}`);
    if (err.cause !== undefined) {
      lines.push(`  caused by: ${formatCause(err.cause)}`);
    }
    return lines.join('\n');
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function formatCause(c: unknown): string {
  if (isPilatesError(c)) {
    return formatPilatesError(c).replace(/\n/g, '\n  ');
  }
  if (c instanceof Error) return `${c.name}: ${c.message}`;
  return String(c);
}
