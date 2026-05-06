import { describe, expect, it } from 'vitest';
import { Node } from './node.js';
import { defaultStyle } from './style.js';

describe('Style — overflow', () => {
  it('defaults overflow / overflowX / overflowY to "visible"', () => {
    const s = defaultStyle();
    expect(s.overflow).toBe('visible');
    expect(s.overflowX).toBe('visible');
    expect(s.overflowY).toBe('visible');
  });
});

describe('Node — setOverflow', () => {
  it('setOverflow() updates the shorthand and both axes', () => {
    const n = Node.create();
    n.setOverflow('scroll');
    expect(n.style.overflow).toBe('scroll');
    expect(n.style.overflowX).toBe('scroll');
    expect(n.style.overflowY).toBe('scroll');
  });

  it('setOverflowX() / setOverflowY() override one axis only', () => {
    const n = Node.create();
    n.setOverflow('hidden');
    n.setOverflowX('scroll');
    expect(n.style.overflow).toBe('hidden'); // shorthand untouched
    expect(n.style.overflowX).toBe('scroll');
    expect(n.style.overflowY).toBe('hidden');
  });

  it('marks the node dirty when overflow changes', () => {
    const n = Node.create();
    n.calculateLayout(); // clears dirty
    expect(n.isDirty()).toBe(false);
    n.setOverflow('hidden');
    expect(n.isDirty()).toBe(true);
  });
});

describe('Node — scrollLeft / scrollTop', () => {
  it('default scroll offsets are 0', () => {
    const n = Node.create();
    expect(n.scrollLeft).toBe(0);
    expect(n.scrollTop).toBe(0);
  });

  it('scroll offsets are mutable', () => {
    const n = Node.create();
    n.scrollLeft = 5;
    n.scrollTop = 12;
    expect(n.scrollLeft).toBe(5);
    expect(n.scrollTop).toBe(12);
  });

  it('changing scroll offsets does NOT mark the node dirty (paint-time concern, not layout)', () => {
    const n = Node.create();
    n.calculateLayout();
    expect(n.isDirty()).toBe(false);
    n.scrollTop = 7;
    expect(n.isDirty()).toBe(false);
  });
});
