import { describe, expect, it } from 'vitest';
import { defaultStyle } from './style.js';

describe('Style — overflow', () => {
  it('defaults overflow / overflowX / overflowY to "visible"', () => {
    const s = defaultStyle();
    expect(s.overflow).toBe('visible');
    expect(s.overflowX).toBe('visible');
    expect(s.overflowY).toBe('visible');
  });
});
