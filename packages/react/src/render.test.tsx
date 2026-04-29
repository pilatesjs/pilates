import { describe, expect, it } from 'vitest';
import { renderToString } from './test-utils.js';

describe('renderToString', () => {
  it('returns empty string when given an empty React element', () => {
    const out = renderToString(<></>, { width: 4, height: 1 });
    expect(out.replace(/\x1b\[[0-9;]*m/g, '')).toBe('    \n');
  });
});
