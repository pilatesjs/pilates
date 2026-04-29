import { describe, expect, it } from 'vitest';
import { VERSION } from './index.js';

describe('@pilates/core', () => {
  it('exposes a version string', () => {
    expect(typeof VERSION).toBe('string');
  });
});
