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
