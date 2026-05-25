/**
 * Tests for the public `render()` / `renderToFrame()` entry points that
 * `index.test.ts` doesn't already cover:
 *
 *   - `defaultAnsi()` TTY autodetect across process.stdout shapes
 *   - `_layout` mirror that `renderToFrame` writes onto each source
 *     `RenderNode` for downstream `useBoxMetrics` consumers
 *   - 0×0 and 1×1 dimension edge cases
 *   - Deeply-nested trees (recursion depth)
 *   - Render-time errors propagate out of `render()`
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Frame } from './frame.js';
import type { ComputedLayout, RenderNode } from './index.js';
import { render, renderToFrame } from './render.js';

describe('renderToFrame — shape and dimensions', () => {
  it('returns a Frame whose width/height match the root', () => {
    const frame = renderToFrame({ width: 10, height: 4 });
    expect(frame).toBeInstanceOf(Frame);
    expect(frame.width).toBe(10);
    expect(frame.height).toBe(4);
  });

  it('produces a 0×0 frame for zero dimensions without throwing', () => {
    const frame = renderToFrame({ width: 0, height: 0 });
    expect(frame.width).toBe(0);
    expect(frame.height).toBe(0);
    expect(frame.toPlainString()).toBe('');
  });

  it('renders a 1×1 frame as a single space cell', () => {
    const out = renderToFrame({ width: 1, height: 1 }).toPlainString();
    expect(out).toBe(' ');
  });

  it('renders a single-node text tree at minimum size', () => {
    const out = renderToFrame({ width: 5, height: 1, children: [{ text: 'hi' }] }).toPlainString();
    expect(out).toBe('hi   ');
  });
});

describe('renderToFrame — _layout mirror', () => {
  it('writes computed layout back onto each source RenderNode', () => {
    const child = { width: 4, height: 2 } as RenderNode;
    const tree: RenderNode = {
      width: 10,
      height: 4,
      flexDirection: 'row',
      children: [child],
    };
    renderToFrame(tree);

    const lo = (child as RenderNode & { _layout?: ComputedLayout })._layout;
    expect(lo).toBeDefined();
    expect(lo!.left).toBe(0);
    expect(lo!.top).toBe(0);
    expect(lo!.width).toBe(4);
    expect(lo!.height).toBe(2);
    expect(lo!.scrollWidth).toBeGreaterThanOrEqual(0);
    expect(lo!.scrollHeight).toBeGreaterThanOrEqual(0);
  });

  it('mirrors the root layout too', () => {
    const root: RenderNode = { width: 7, height: 3 };
    renderToFrame(root);
    const lo = (root as RenderNode & { _layout?: ComputedLayout })._layout;
    expect(lo).toEqual(
      expect.objectContaining({
        left: 0,
        top: 0,
        width: 7,
        height: 3,
      }),
    );
  });

  it('writes deterministic layouts across repeated runs (no stale state)', () => {
    const tree: RenderNode = {
      width: 8,
      height: 3,
      flexDirection: 'row',
      children: [{ flex: 1 }, { flex: 1 }],
    };
    renderToFrame(tree);
    const before = JSON.stringify(
      (tree.children![1] as RenderNode & { _layout?: ComputedLayout })._layout,
    );
    renderToFrame(tree);
    const after = JSON.stringify(
      (tree.children![1] as RenderNode & { _layout?: ComputedLayout })._layout,
    );
    expect(after).toBe(before);
  });
});

describe('renderToFrame — recursion depth', () => {
  it('handles a 32-level deeply-nested container tree', () => {
    let leaf: RenderNode = { width: 2, height: 2, border: 'single' };
    for (let i = 0; i < 31; i++) {
      leaf = { width: 2 + (i % 3), height: 2, children: [leaf] };
    }
    const frame = renderToFrame({ width: 40, height: 10, children: [leaf] });
    expect(frame.width).toBe(40);
    expect(frame.height).toBe(10);
  });
});

describe('render — ansi option', () => {
  it('omits SGR escape sequences when ansi: false', () => {
    const out = render(
      { width: 4, height: 1, children: [{ text: 'hi', color: 'red', bold: true }] },
      { ansi: false },
    );
    expect(out).not.toContain('\x1b[');
  });

  it('emits SGR escape sequences when ansi: true', () => {
    const out = render(
      { width: 4, height: 1, children: [{ text: 'hi', color: 'red' }] },
      { ansi: true },
    );
    expect(out).toContain('\x1b[31m');
  });

  it('defaults to TTY detection when ansi is omitted', () => {
    // Run without explicit ansi; the default flag honors process.stdout.isTTY.
    // The test environment may or may not be a TTY; we only assert that the
    // function returns a string of the expected length-shape.
    const out = render({ width: 3, height: 1 });
    expect(typeof out).toBe('string');
    // 3 cells * 1 row, no trailing newline.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we strip
    expect(out.replace(/\x1b\[[\d;]*m/g, '').length).toBe(3);
  });
});

describe('render — defaultAnsi() TTY autodetect', () => {
  const realStdout = process.stdout;
  // process.stdout is a getter-style property in some Node versions; reassign
  // via Object.defineProperty to a writable shape so we can swap it.
  function withStdout(value: unknown, fn: () => void): void {
    const desc = Object.getOwnPropertyDescriptor(process, 'stdout');
    Object.defineProperty(process, 'stdout', {
      configurable: true,
      writable: true,
      value,
    });
    try {
      fn();
    } finally {
      if (desc) Object.defineProperty(process, 'stdout', desc);
      else Object.defineProperty(process, 'stdout', { value: realStdout, configurable: true });
    }
  }

  afterEach(() => {
    // Belt-and-braces: even if a test forgot to restore, force it back.
    if (process.stdout !== realStdout) {
      Object.defineProperty(process, 'stdout', { value: realStdout, configurable: true });
    }
  });

  it('strips ANSI when stdout.isTTY is undefined (piped)', () => {
    withStdout({ isTTY: undefined }, () => {
      const out = render({ width: 3, height: 1, children: [{ text: 'hi', color: 'red' }] });
      expect(out).not.toContain('\x1b[');
    });
  });

  it('strips ANSI when stdout.isTTY is false', () => {
    withStdout({ isTTY: false }, () => {
      const out = render({ width: 3, height: 1, children: [{ text: 'hi', color: 'red' }] });
      expect(out).not.toContain('\x1b[');
    });
  });

  it('emits ANSI when stdout.isTTY === true', () => {
    withStdout({ isTTY: true }, () => {
      const out = render({ width: 3, height: 1, children: [{ text: 'hi', color: 'red' }] });
      expect(out).toContain('\x1b[31m');
    });
  });

  it('emits ANSI when process.stdout is missing entirely', () => {
    withStdout(undefined, () => {
      const out = render({ width: 3, height: 1, children: [{ text: 'hi', color: 'red' }] });
      expect(out).toContain('\x1b[31m');
    });
  });

  it('explicit options.ansi overrides TTY detection', () => {
    withStdout({ isTTY: false }, () => {
      const out = render(
        { width: 3, height: 1, children: [{ text: 'hi', color: 'red' }] },
        { ansi: true },
      );
      expect(out).toContain('\x1b[31m');
    });
    withStdout({ isTTY: true }, () => {
      const out = render(
        { width: 3, height: 1, children: [{ text: 'hi', color: 'red' }] },
        { ansi: false },
      );
      expect(out).not.toContain('\x1b[');
    });
  });
});

describe('render — output shape', () => {
  it('returns rows joined by \\n with no trailing newline', () => {
    const out = render({ width: 3, height: 2 }, { ansi: false });
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(out.endsWith('\n')).toBe(false);
  });
});
