/**
 * Snapshot regression tests for the render layer.
 *
 * Two snapshots per scene: `'ansi'` (raw with SGR sequences) catches color
 * / attribute drift; `'plain'` (post-stripAnsi) catches layout drift
 * independent of styling. When a regression diffs only one of the two,
 * the failing layer is obvious.
 */

import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { render } from './index.js';

function snap(out: string) {
  return { ansi: out, plain: stripAnsi(out) };
}

describe('render snapshots — borders', () => {
  it('single border with title', () => {
    const out = render({ width: 14, height: 3, border: 'single', title: 'Logs' }, { ansi: true });
    const s = snap(out);
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
  });

  it('rounded border', () => {
    const out = render({ width: 8, height: 3, border: 'rounded' }, { ansi: true });
    const s = snap(out);
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
  });

  it('double border', () => {
    const out = render({ width: 6, height: 3, border: 'double' }, { ansi: true });
    const s = snap(out);
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
  });
});

describe('render snapshots — colored text', () => {
  it('cyan text inside a single-bordered box', () => {
    const out = render(
      {
        width: 12,
        height: 3,
        border: 'single',
        children: [{ text: 'hi', color: 'cyan' }],
      },
      { ansi: true },
    );
    const s = snap(out);
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
  });

  it('bold red text on yellow background', () => {
    const out = render(
      {
        width: 12,
        height: 3,
        border: 'single',
        children: [{ text: 'WARN', color: 'red', bgColor: 'yellow', bold: true }],
      },
      { ansi: true },
    );
    const s = snap(out);
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
  });

  it('24-bit truecolor (#RRGGBB)', () => {
    // Locks the SGR shape `\e[38;2;R;G;B m` for foreground and the
    // matching `48;2;...` for background. Regression here would
    // typically be a fgSgr / bgSgr drift.
    const out = render(
      {
        width: 12,
        height: 3,
        border: 'single',
        children: [{ text: 'rgb', color: '#ff8000', bgColor: '#102030' }],
      },
      { ansi: true },
    );
    const s = snap(out);
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
  });

  it('256-color palette (numeric)', () => {
    // 38;5;N / 48;5;N path. Numeric 196 is bright red in xterm256, 21 is
    // a cool blue — values picked so the snapshot encodes the parameter
    // ordering (fg before bg) clearly.
    const out = render(
      {
        width: 12,
        height: 3,
        border: 'single',
        children: [{ text: 'idx', color: 196, bgColor: 21 }],
      },
      { ansi: true },
    );
    const s = snap(out);
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
  });

  it('multi-style transitions across cells in one row', () => {
    // Inverse on the left half and italic-underline on the right —
    // catches SGR state-machine drift, since the painter emits a reset
    // (or a delta SGR) on every style change between cells.
    const out = render(
      {
        width: 14,
        height: 3,
        border: 'single',
        flexDirection: 'row',
        children: [
          { width: 5, children: [{ text: 'INV', inverse: true }] },
          { width: 5, children: [{ text: 'I/U', italic: true, underline: true }] },
        ],
      },
      { ansi: true },
    );
    const s = snap(out);
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
  });
});

describe('render snapshots — flex layout', () => {
  it('row of two flex children with borders', () => {
    const out = render(
      {
        width: 20,
        height: 3,
        flexDirection: 'row',
        children: [
          { flex: 1, border: 'single' },
          { flex: 1, border: 'single' },
        ],
      },
      { ansi: true },
    );
    const s = snap(out);
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
  });

  it('column with header strip + body, distinct titles', () => {
    const out = render(
      {
        width: 16,
        height: 6,
        flexDirection: 'column',
        children: [
          { height: 3, border: 'single', title: 'Top' },
          { flex: 1, border: 'single', title: 'Bot' },
        ],
      },
      { ansi: true },
    );
    const s = snap(out);
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
  });
});

describe('render snapshots — text wrapping', () => {
  it('wraps long text inside the inner area', () => {
    const out = render(
      {
        width: 10,
        height: 4,
        border: 'single',
        children: [{ text: 'one two three four' }],
      },
      { ansi: true },
    );
    const s = snap(out);
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
  });

  it('truncates with ellipsis when wrap = "truncate"', () => {
    const out = render(
      {
        width: 10,
        height: 3,
        border: 'single',
        children: [{ text: 'this line is too long', wrap: 'truncate' }],
      },
      { ansi: true },
    );
    const s = snap(out);
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
  });

  it('handles wide CJK text', () => {
    const out = render(
      {
        width: 10,
        height: 3,
        border: 'single',
        children: [{ text: '你好世界' }],
      },
      { ansi: true },
    );
    const s = snap(out);
    expect(s.ansi).toMatchSnapshot('ansi');
    expect(s.plain).toMatchSnapshot('plain');
  });
});
