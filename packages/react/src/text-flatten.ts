import type { TextInstance } from './reconciler.js';

/**
 * Flatten a <Text> instance's children into a single string.
 *
 * Children are TextFragment refs (one per string/number child or
 * <Newline>) and nested TextInstance refs. Nested style props are
 * intentionally lost in v0.1 (only the text content propagates) — see
 * spec.
 *
 * Throws on any other value (e.g. a <Box> placed inside <Text>).
 */
export function flattenText(instance: TextInstance): string {
  let out = '';
  for (const f of instance.fragments) {
    const k = (f as { kind?: string } | null)?.kind;
    if (k === 'fragment') {
      out += (f as { text: string }).text;
    } else if (k === 'text') {
      out += flattenText(f as TextInstance);
    } else {
      const display = k ?? typeof f;
      throw new Error(
        `Pilates: <Text> children must be string, number, <Text>, or <Newline>. Got: ${display}`,
      );
    }
  }
  return out;
}
