import { describe, expect, it } from 'vitest';
import { build } from './build.js';
import { Frame } from './frame.js';
import { paint } from './painter.js';
import type { ContainerNode, TextNode } from './types.js';

function makeText(text: string, props: Partial<TextNode> = {}): TextNode {
  return { kind: 'text', text, ...props } as TextNode;
}

function makeBox(
  children: (ContainerNode | TextNode)[],
  props: Partial<ContainerNode> = {},
): ContainerNode {
  return { kind: 'container', children, ...props } as ContainerNode;
}

describe('painter — overflow:hidden clips children', () => {
  it('children outside the parent rect are not painted', () => {
    // 10x3 viewport with a 10x10 child. With overflow:hidden, only the
    // first 3 rows of the child should appear.
    const tree = makeBox(
      [makeText('row0'), makeText('row1'), makeText('row2'), makeText('row3'), makeText('row4')],
      { width: 10, height: 3, overflow: 'hidden' },
    );
    const bridge = build(tree);
    bridge.root.calculateLayout();
    const f = new Frame(10, 5);
    paint(f, bridge);

    // Rows 0-2 visible
    expect(f.getCell(0, 0)?.char).toBe('r');
    expect(f.getCell(0, 1)?.char).toBe('r');
    expect(f.getCell(0, 2)?.char).toBe('r');
    // Row 3 should be empty (clipped) — frame default is space.
    expect(f.getCell(0, 3)?.char).toBe(' ');
    expect(f.getCell(0, 4)?.char).toBe(' ');
  });
});

describe('painter — overflow scroll offset translates children', () => {
  it('scrollTop=2 scrolls content up by 2 rows', () => {
    const tree = makeBox(
      [makeText('row0'), makeText('row1'), makeText('row2'), makeText('row3'), makeText('row4')],
      { width: 10, height: 3, overflow: 'hidden', scrollTop: 2 },
    );
    const bridge = build(tree);
    bridge.root.calculateLayout();
    const f = new Frame(10, 5);
    paint(f, bridge);

    // row2 should now be at viewport row 0
    expect(f.getCell(0, 0)?.char).toBe('r');
    expect(f.getCell(3, 0)?.char).toBe('2'); // 'row2' last char
  });
});

describe('painter — scrollbar', () => {
  it('overflow:scroll paints a thumb in the right gutter', () => {
    const tree = makeBox(
      [makeText('row0'), makeText('row1'), makeText('row2'), makeText('row3'), makeText('row4')],
      { width: 10, height: 3, overflow: 'scroll' },
    );
    const bridge = build(tree);
    bridge.root.calculateLayout();
    const f = new Frame(10, 5);
    paint(f, bridge);

    // Last column (x=9) should have thumb chars in the top portion.
    // 5 content rows / 3 viewport = thumb ≈ round(3 * 3/5) = 2.
    expect(f.getCell(9, 0)?.char).toBe('█');
    expect(f.getCell(9, 1)?.char).toBe('█');
  });

  it('overflow:auto with content fitting paints no scrollbar', () => {
    const tree = makeBox([makeText('a'), makeText('b')], {
      width: 10,
      height: 5,
      overflow: 'auto',
    });
    const bridge = build(tree);
    bridge.root.calculateLayout();
    const f = new Frame(10, 5);
    paint(f, bridge);

    // Last column should be untouched (default space) at every row.
    for (let y = 0; y < 5; y++) {
      expect(f.getCell(9, y)?.char).toBe(' ');
    }
  });
});
