import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Node } from '../node.js';

describe('calculateLayout — differential mode', () => {
  const ORIGINAL_ENV = process.env.PILATES_DIFFERENTIAL_LAYOUT;

  beforeEach(() => {
    process.env.PILATES_DIFFERENTIAL_LAYOUT = undefined;
  });

  afterEach(() => {
    if (ORIGINAL_ENV !== undefined) process.env.PILATES_DIFFERENTIAL_LAYOUT = ORIGINAL_ENV;
    else process.env.PILATES_DIFFERENTIAL_LAYOUT = undefined;
  });

  it('produces correct layout regardless of differential setting', () => {
    // Sanity: layout is what we expect either way. We can't toggle the
    // env var at runtime since the module reads it at import time, so
    // this test runs in the default (off) configuration. The Vitest CI
    // step `pnpm test:differential` runs the entire suite WITH the env
    // var on — that's what gives the differential check its coverage.
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(50);
    const child = Node.create();
    child.setFlex(1);
    root.insertChild(child, 0);
    root.calculateLayout(100, 50);
    expect(root.layout.width).toBe(100);
    expect(child.layout.width).toBe(100);
  });
});
