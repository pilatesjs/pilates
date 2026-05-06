import { didYouMean } from './did-you-mean.js';

/**
 * Replacement suggestion for an unknown JSX host type. The host-config layer
 * uses this to compose the "did you mean ...?" line of the UnknownHostType
 * error message.
 *
 * `kind: 'html'` means the input matched a known HTML tag — the message
 * should explain that Pilates is not HTML and point at the Pilates equivalent.
 *
 * `kind: 'spelling'` means the input was close enough to a Pilates component
 * name (case-insensitive Levenshtein) — the message should be a "did you
 * mean X?" hint.
 *
 * `undefined` means no useful suggestion; caller should produce a plain
 * "unknown host type X" message.
 */
export type HostTypeSuggestion =
  | { kind: 'html'; component: string }
  | { kind: 'spelling'; component: string };

/**
 * Common DOM tags React-DOM authors copy-paste, mapped to Pilates equivalents.
 * Layout-style tags map to <Box>; text-style tags map to <Text>.
 */
const HTML_TO_PILATES: Readonly<Record<string, string>> = {
  div: 'Box',
  section: 'Box',
  article: 'Box',
  main: 'Box',
  header: 'Box',
  footer: 'Box',
  nav: 'Box',
  aside: 'Box',
  p: 'Text',
  span: 'Text',
  strong: 'Text',
  em: 'Text',
  b: 'Text',
  i: 'Text',
};

/** Public-facing Pilates component names for Levenshtein fallback. */
const PILATES_COMPONENTS: readonly string[] = ['Box', 'Text', 'Static'];

export function suggestHostTypeReplacement(type: string): HostTypeSuggestion | undefined {
  const lower = type.toLowerCase();
  const html = HTML_TO_PILATES[lower];
  if (html !== undefined) return { kind: 'html', component: html };
  const spelling = didYouMean(type, PILATES_COMPONENTS);
  if (spelling !== undefined) return { kind: 'spelling', component: spelling };
  return undefined;
}
