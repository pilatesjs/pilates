/**
 * End-to-end snapshot tests for the render layer.
 *
 * Each fixture builds a small declarative tree and asserts the painted
 * output, using `toPlainString()` to avoid noise from ANSI sequences.
 * Separate tests cover ANSI emission and TTY mode toggling.
 */

import { describe, expect, it } from 'vitest';
import { render, renderToFrame } from './index.js';

describe('render — basic boxes', () => {
  it('paints a single bordered box with title', () => {
    const out = renderToFrame({
      width: 14,
      height: 3,
      border: 'single',
      title: 'Logs',
    }).toPlainString();
    // Format: corner + ─ + " title " + ─...─ + corner.
    expect(out).toBe(['┌─ Logs ─────┐', '│            │', '└────────────┘'].join('\n'));
  });

  it('paints rounded borders', () => {
    const out = renderToFrame({
      width: 8,
      height: 3,
      border: 'rounded',
    }).toPlainString();
    expect(out).toBe(['╭──────╮', '│      │', '╰──────╯'].join('\n'));
  });

  it('paints double borders', () => {
    const out = renderToFrame({
      width: 6,
      height: 3,
      border: 'double',
    }).toPlainString();
    expect(out).toBe(['╔════╗', '║    ║', '╚════╝'].join('\n'));
  });

  it('paints bold borders', () => {
    const out = renderToFrame({
      width: 6,
      height: 3,
      border: 'bold',
    }).toPlainString();
    expect(out).toBe(['┏━━━━┓', '┃    ┃', '┗━━━━┛'].join('\n'));
  });

  it('a node with no border and no children produces blank cells', () => {
    const out = renderToFrame({ width: 4, height: 2 }).toPlainString();
    expect(out).toBe(['    ', '    '].join('\n'));
  });
});

describe('render — layout', () => {
  it('row of two flex children with borders', () => {
    const out = renderToFrame({
      width: 20,
      height: 3,
      flexDirection: 'row',
      children: [
        { flex: 1, border: 'single' },
        { flex: 1, border: 'single' },
      ],
    }).toPlainString();
    expect(out).toBe(
      ['┌────────┐┌────────┐', '│        ││        │', '└────────┘└────────┘'].join('\n'),
    );
  });

  it('column with header strip + body', () => {
    const out = renderToFrame({
      width: 12,
      height: 5,
      flexDirection: 'column',
      children: [
        { height: 1, border: 'single' },
        { flex: 1, border: 'single' },
      ],
    }).toPlainString();
    // Header row is height 1 with a border — collapses to a horizontal line.
    expect(out.split('\n').length).toBe(5);
  });
});

describe('render — text', () => {
  it('renders short text inside a bordered box', () => {
    const out = renderToFrame({
      width: 10,
      height: 3,
      border: 'single',
      children: [{ text: 'hi' }],
    }).toPlainString();
    expect(out).toBe(['┌────────┐', '│hi      │', '└────────┘'].join('\n'));
  });

  it('wraps long text inside the inner area', () => {
    const out = renderToFrame({
      width: 10,
      height: 4,
      border: 'single',
      children: [{ text: 'one two three four' }],
    }).toPlainString();
    const lines = out.split('\n');
    expect(lines[0]).toBe('┌────────┐');
    // Inner area is 8 cells wide; two lines of wrapped text.
    expect(lines[1]).toBe('│one two │');
    expect(lines[2]).toBe('│three   │');
    expect(lines[3]).toBe('└────────┘');
  });

  it('truncates with ellipsis when wrap = "truncate"', () => {
    const out = renderToFrame({
      width: 10,
      height: 3,
      border: 'single',
      children: [{ text: 'this line is too long', wrap: 'truncate' }],
    }).toPlainString();
    const lines = out.split('\n');
    expect(lines[1]).toBe('│this li…│');
  });

  it('handles wide CJK text', () => {
    const out = renderToFrame({
      width: 10,
      height: 3,
      border: 'single',
      children: [{ text: '你好世界' }], // 4 CJK chars = 8 cells
    }).toPlainString();
    const lines = out.split('\n');
    expect(lines[1]).toBe('│你好世界│');
  });

  it('respects hard newlines in text', () => {
    const out = renderToFrame({
      width: 10,
      height: 4,
      border: 'single',
      children: [{ text: 'a\nb' }],
    }).toPlainString();
    const lines = out.split('\n');
    expect(lines[1]).toBe('│a       │');
    expect(lines[2]).toBe('│b       │');
  });
});

describe('render — ANSI styling', () => {
  it('wraps text in SGR codes when ansi: true', () => {
    const out = render(
      {
        width: 8,
        height: 1,
        children: [{ text: 'hello', color: 'red' }],
      },
      { ansi: true },
    );
    expect(out).toContain('\x1b[31m');
    expect(out).toContain('hello');
    expect(out).toContain('\x1b[0m');
  });

  it('strips SGR codes when ansi: false', () => {
    const out = render(
      {
        width: 8,
        height: 1,
        children: [{ text: 'hello', color: 'red', bold: true }],
      },
      { ansi: false },
    );
    expect(out).not.toContain('\x1b[');
    expect(out).toContain('hello');
  });

  it('emits 24-bit color for hex strings', () => {
    const out = render(
      {
        width: 6,
        height: 1,
        children: [{ text: 'hi', color: '#ff5500' }],
      },
      { ansi: true },
    );
    expect(out).toContain('38;2;255;85;0');
  });

  it('emits 256-color for numeric color', () => {
    const out = render(
      {
        width: 6,
        height: 1,
        children: [{ text: 'hi', color: 208 }],
      },
      { ansi: true },
    );
    expect(out).toContain('38;5;208');
  });

  it('combines bold + color into a single SGR sequence', () => {
    const out = render(
      {
        width: 6,
        height: 1,
        children: [{ text: 'hi', color: 'green', bold: true }],
      },
      { ansi: true },
    );
    // Order is attrs then color in our emitter.
    expect(out).toContain('\x1b[1;32m');
  });

  it('borders honor borderColor', () => {
    const out = render(
      {
        width: 4,
        height: 3,
        border: 'single',
        borderColor: 'cyan',
      },
      { ansi: true },
    );
    expect(out).toContain('\x1b[36m');
    expect(out).toContain('┌──┐');
  });
});

describe('render — title slot', () => {
  it('truncates an oversized title with ellipsis', () => {
    const out = renderToFrame({
      width: 10,
      height: 3,
      border: 'single',
      title: 'A very long title indeed',
    }).toPlainString();
    const lines = out.split('\n');
    // Inner = 10 - 5 = 5 cells; truncation adds '…'.
    expect(lines[0]).toMatch(/^┌─ .+… ─*┐$/);
  });

  it('omits the title when there is no room', () => {
    const out = renderToFrame({
      width: 5,
      height: 3,
      border: 'single',
      title: 'X',
    }).toPlainString();
    // Need at least 6 cells: corners + ─ + " X " + corner.
    const lines = out.split('\n');
    expect(lines[0]).toBe('┌───┐');
  });
});

describe('render — practical layouts', () => {
  it('two-pane app shell', () => {
    const out = renderToFrame({
      width: 30,
      height: 5,
      flexDirection: 'row',
      children: [
        {
          flex: 1,
          border: 'rounded',
          title: 'Logs',
          children: [{ text: 'user logged in' }],
        },
        {
          width: 14,
          border: 'single',
          title: 'Status',
          children: [{ text: 'ok' }],
        },
      ],
    }).toPlainString();
    const lines = out.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('Logs');
    expect(lines[0]).toContain('Status');
    expect(lines[0]!.indexOf('Status')).toBeGreaterThan(15);
  });
});
