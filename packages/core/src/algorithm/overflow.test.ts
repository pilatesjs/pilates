import { describe, expect, it } from 'vitest';
import { Node } from '../node.js';

describe('algorithm — overflow:scroll preserves child natural size', () => {
  it('child with width 100 inside overflow:scroll parent of width 50 stays width 100', () => {
    const parent = Node.create();
    parent.setWidth(50);
    parent.setHeight(20);
    parent.setOverflow('scroll');

    const child = Node.create();
    child.setWidth(100);
    child.setHeight(10);
    parent.insertChild(child, 0);

    parent.calculateLayout();

    // Child must keep its 100-cell natural width even though parent is 50.
    // If this fails, the layout engine treats overflow as advisory only and
    // shrinks children to fit — see plan note about a 2-pass measurement
    // layer.
    expect(child.getComputedLayout().width).toBe(100);
  });

  it('child with width 100 inside overflow:hidden parent of width 50 also stays width 100', () => {
    // overflow:hidden semantically clips at paint time but does NOT change
    // layout. Children retain their natural size.
    const parent = Node.create();
    parent.setWidth(50);
    parent.setHeight(20);
    parent.setOverflow('hidden');

    const child = Node.create();
    child.setWidth(100);
    child.setHeight(10);
    parent.insertChild(child, 0);

    parent.calculateLayout();
    expect(child.getComputedLayout().width).toBe(100);
  });

  it('child with width 100 inside overflow:visible parent of width 50 also stays width 100 (sanity)', () => {
    const parent = Node.create();
    parent.setWidth(50);
    parent.setHeight(20);

    const child = Node.create();
    child.setWidth(100);
    child.setHeight(10);
    parent.insertChild(child, 0);

    parent.calculateLayout();
    expect(child.getComputedLayout().width).toBe(100);
  });
});

describe('algorithm — scrollWidth / scrollHeight', () => {
  it('overflow:scroll parent reports content size via scrollWidth/scrollHeight', () => {
    const parent = Node.create();
    parent.setWidth(50);
    parent.setHeight(20);
    parent.setOverflow('scroll');

    // Two children stacked vertically: total content height = 30.
    const a = Node.create();
    a.setWidth(100);
    a.setHeight(15);
    parent.insertChild(a, 0);
    const b = Node.create();
    b.setWidth(80);
    b.setHeight(15);
    parent.insertChild(b, 1);

    parent.calculateLayout();

    // Children stack: viewport is 50×20, content is max(100,80)=100 wide,
    // 15+15=30 tall.
    expect(parent.scrollWidth).toBe(100);
    expect(parent.scrollHeight).toBe(30);
  });

  it('overflow:visible parent has scrollWidth === width and scrollHeight === height', () => {
    // For non-overflow nodes, scroll dimensions match viewport — content
    // never exceeds the box.
    const parent = Node.create();
    parent.setWidth(50);
    parent.setHeight(20);

    const child = Node.create();
    child.setWidth(30);
    child.setHeight(10);
    parent.insertChild(child, 0);

    parent.calculateLayout();

    expect(parent.scrollWidth).toBe(parent.getComputedLayout().width);
    expect(parent.scrollHeight).toBe(parent.getComputedLayout().height);
  });
});
