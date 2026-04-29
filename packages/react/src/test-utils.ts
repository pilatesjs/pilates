import type { ReactElement } from 'react';

export interface RenderToStringOptions {
  width: number;
  height: number;
}

/**
 * Mount a React element with a fake stdout, run one commit, and return
 * the concatenated string of all writes. Test-only — NOT in the public
 * package barrel.
 */
export function renderToString(_element: ReactElement, _options: RenderToStringOptions): string {
  throw new Error('renderToString not implemented');
}
