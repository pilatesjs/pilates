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
 *
 * Cycles (e.g. `err.cause === err`) are detected via a per-call WeakSet and
 * rendered as `Pilates: [Circular]` rather than recursing infinitely. Without
 * this, the default `<ErrorBoundary>` fallback would itself crash if a user
 * constructed a self-referential cause chain.
 */
export function formatPilatesError(err: unknown): string {
  return formatPilatesErrorInternal(err, new WeakSet());
}

function formatPilatesErrorInternal(err: unknown, seen: WeakSet<object>): string {
  if (isPilatesError(err)) {
    if (seen.has(err)) return 'Pilates: [Circular]';
    seen.add(err);
    const lines = [`Pilates: ${err.message}`];
    if (err.hint) lines.push(`  hint: ${err.hint}`);
    if (err.cause !== undefined) {
      lines.push(`  caused by: ${formatCause(err.cause, seen)}`);
    }
    return lines.join('\n');
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function formatCause(c: unknown, seen: WeakSet<object>): string {
  if (isPilatesError(c)) {
    return formatPilatesErrorInternal(c, seen).replace(/\n/g, '\n  ');
  }
  if (c instanceof Error) return `${c.name}: ${c.message}`;
  return String(c);
}
