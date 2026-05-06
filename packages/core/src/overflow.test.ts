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
