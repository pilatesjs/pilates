import { describe, expect, it } from 'vitest';
import { Node } from '../node.js';

describe('calculateLayout — differential mode', () => {
  it('produces correct layout regardless of differential setting', () => {
    // Sanity test only. The differential wrapper reads
    // `PILATES_DIFFERENTIAL_LAYOUT` once at module import; we can't
    // toggle it at runtime, so this test runs in whichever mode the
    // process started in. The CI step `pnpm test:differential` runs
    // the entire suite with the env var ON — that's what gives the
    // differential check its coverage. This file just pins one
    // straightforward layout case so it would visibly fail if the
    // wrapper itself broke `calculateLayout` for the off path.
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
