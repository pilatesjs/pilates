import { describe, expect, it, vi } from 'vitest';
import { Edge } from './edge.js';
import { MeasureMode } from './measure-func.js';
import { Node } from './node.js';

describe('Node — defaults', () => {
  it('starts with sensible CSS-Flexbox defaults', () => {
    const n = Node.create();
    const s = n.style;
    expect(s.flexDirection).toBe('column');
    expect(s.flexWrap).toBe('nowrap');
    expect(s.flexGrow).toBe(0);
    expect(s.flexShrink).toBe(0);
    expect(s.flexBasis).toBe('auto');
    expect(s.width).toBe('auto');
    expect(s.height).toBe('auto');
    expect(s.justifyContent).toBe('flex-start');
    expect(s.alignItems).toBe('stretch');
    expect(s.alignContent).toBe('flex-start');
    expect(s.alignSelf).toBe('auto');
    expect(s.positionType).toBe('relative');
    expect(s.display).toBe('flex');
    expect(s.padding).toEqual([0, 0, 0, 0]);
    expect(s.margin).toEqual([0, 0, 0, 0]);
    expect(s.position).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('starts with zeroed computed layout', () => {
    expect(Node.create().getComputedLayout()).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });

  it('starts dirty (never been laid out)', () => {
    expect(Node.create().isDirty()).toBe(true);
  });
});

describe('Node — public surface immutability (type-level)', () => {
  // These directives confirm that the public types of `style` and `layout`
  // are `Readonly<...>` so external callers can't bypass `markDirty()` by
  // mutating fields directly. The `@ts-expect-error` lines fail typecheck
  // if the field type ever loosens to mutable.
  it('rejects external mutation of style at the type level', () => {
    const n = Node.create();
    // @ts-expect-error — `style` is exposed as Readonly<Style>; mutate via setX().
    n.style.flexGrow = 99;
    // Runtime is still mutable (the cast is type-only). The point of the
    // typecheck guard is to catch the mistake at compile time — the runtime
    // fact below just makes it visible that the directive isn't lying.
    expect(n.style.flexGrow).toBe(99);
  });

  it('rejects external mutation of layout at the type level', () => {
    const n = Node.create();
    // @ts-expect-error — `layout` is exposed as Readonly<ComputedLayout>.
    n.layout.left = 99;
    expect(n.layout.left).toBe(99);
  });
});

describe('Node — flex shorthand', () => {
  it('positive flex sets grow and basis 0', () => {
    const n = Node.create();
    n.setFlex(3);
    expect(n.style.flexGrow).toBe(3);
    expect(n.style.flexShrink).toBe(1);
    expect(n.style.flexBasis).toBe(0);
  });

  it('zero flex resets shorthand', () => {
    const n = Node.create();
    n.setFlex(2);
    n.setFlex(0);
    expect(n.style.flexGrow).toBe(0);
    expect(n.style.flexShrink).toBe(0);
    expect(n.style.flexBasis).toBe('auto');
  });

  it('negative flex maps to shrink-only', () => {
    const n = Node.create();
    n.setFlex(-2);
    expect(n.style.flexGrow).toBe(0);
    expect(n.style.flexShrink).toBe(2);
    expect(n.style.flexBasis).toBe('auto');
  });

  it('rejects non-finite flex values', () => {
    expect(() => Node.create().setFlex(Number.NaN)).toThrow(/flex must be finite/);
  });
});

describe('Node — sizing setters', () => {
  it('width and height accept numbers and "auto"', () => {
    const n = Node.create();
    n.setWidth(40);
    n.setHeight(10);
    expect(n.style.width).toBe(40);
    expect(n.style.height).toBe(10);
    n.setWidth('auto');
    n.setHeight('auto');
    expect(n.style.width).toBe('auto');
    expect(n.style.height).toBe('auto');
  });

  it('rejects negative widths', () => {
    expect(() => Node.create().setWidth(-1)).toThrow(/non-negative/);
  });

  it('clamps negative flexGrow / flexShrink to 0', () => {
    const n = Node.create();
    n.setFlexGrow(-1);
    n.setFlexShrink(-2);
    expect(n.style.flexGrow).toBe(0);
    expect(n.style.flexShrink).toBe(0);
  });

  it('max-width undefined removes the bound', () => {
    const n = Node.create();
    n.setMaxWidth(100);
    expect(n.style.maxWidth).toBe(100);
    n.setMaxWidth(undefined);
    expect(n.style.maxWidth).toBeUndefined();
  });
});

describe('Node — Edge writes', () => {
  it('Edge.All sets all four sides', () => {
    const n = Node.create();
    n.setPadding(Edge.All, 2);
    expect(n.style.padding).toEqual([2, 2, 2, 2]);
  });

  it('Edge.Horizontal sets left and right only', () => {
    const n = Node.create();
    n.setPadding(Edge.Horizontal, 3);
    // padding tuple is [top, right, bottom, left]
    expect(n.style.padding).toEqual([0, 3, 0, 3]);
  });

  it('Edge.Vertical sets top and bottom only', () => {
    const n = Node.create();
    n.setMargin(Edge.Vertical, 1);
    expect(n.style.margin).toEqual([1, 0, 1, 0]);
  });

  it('individual edges write only that side', () => {
    const n = Node.create();
    n.setPadding(Edge.Top, 5);
    n.setPadding(Edge.Right, 6);
    n.setPadding(Edge.Bottom, 7);
    n.setPadding(Edge.Left, 8);
    expect(n.style.padding).toEqual([5, 6, 7, 8]);
  });

  it('position edges accept undefined to unconstrain', () => {
    const n = Node.create();
    n.setPositionType('absolute');
    n.setPosition(Edge.Top, 4);
    n.setPosition(Edge.Left, 0);
    expect(n.style.position).toEqual([4, undefined, undefined, 0]);
    n.setPosition(Edge.Top, undefined);
    expect(n.style.position).toEqual([undefined, undefined, undefined, 0]);
  });

  it('rejects negative padding', () => {
    expect(() => Node.create().setPadding(Edge.Top, -1)).toThrow(/non-negative/);
  });
});

describe('Node — gap', () => {
  it('row and column gap are independent', () => {
    const n = Node.create();
    n.setGap('row', 1);
    n.setGap('column', 2);
    expect(n.style.gapRow).toBe(1);
    expect(n.style.gapColumn).toBe(2);
  });
});

describe('Node — tree mutation', () => {
  it('insertChild attaches child and parent', () => {
    const parent = Node.create();
    const child = Node.create();
    parent.insertChild(child, 0);
    expect(parent.getChildCount()).toBe(1);
    expect(parent.getChild(0)).toBe(child);
    expect(child.getParent()).toBe(parent);
    expect(child.isRoot()).toBe(false);
    expect(parent.isRoot()).toBe(true);
  });

  it('insertChild clamps the index', () => {
    const parent = Node.create();
    const a = Node.create();
    const b = Node.create();
    const c = Node.create();
    parent.insertChild(a, 0);
    parent.insertChild(b, 999);
    parent.insertChild(c, -5);
    expect(parent.getChildren()).toEqual([c, a, b]);
  });

  it('removeChild detaches', () => {
    const parent = Node.create();
    const child = Node.create();
    parent.insertChild(child, 0);
    parent.removeChild(child);
    expect(parent.getChildCount()).toBe(0);
    expect(child.getParent()).toBeNull();
  });

  it('rejects inserting a node that already has a parent', () => {
    const parent = Node.create();
    const other = Node.create();
    const child = Node.create();
    parent.insertChild(child, 0);
    expect(() => other.insertChild(child, 0)).toThrow(/already has a parent/);
  });

  it('rejects inserting a node into itself', () => {
    const n = Node.create();
    expect(() => n.insertChild(n, 0)).toThrow(/itself/);
  });
});

describe('Node — measure function', () => {
  it('setMeasureFunc rejects nodes that have children', () => {
    const parent = Node.create();
    parent.insertChild(Node.create(), 0);
    expect(() => parent.setMeasureFunc(() => ({ width: 0, height: 0 }))).toThrow(
      /measure function/,
    );
  });

  it('insertChild rejects nodes that have a measure function', () => {
    const leaf = Node.create();
    leaf.setMeasureFunc(() => ({ width: 0, height: 0 }));
    expect(() => leaf.insertChild(Node.create(), 0)).toThrow(/measure function/);
  });

  it('round-trips the measure function', () => {
    const fn = vi.fn(() => ({ width: 5, height: 1 }));
    const n = Node.create();
    n.setMeasureFunc(fn);
    expect(n.getMeasureFunc()).toBe(fn);
    // Sanity-check the documented signature compiles and runs.
    const out = n.getMeasureFunc()!(20, MeasureMode.AtMost, 5, MeasureMode.Undefined);
    expect(out).toEqual({ width: 5, height: 1 });
  });

  it('setMeasureFunc(null) clears it', () => {
    const n = Node.create();
    n.setMeasureFunc(() => ({ width: 0, height: 0 }));
    n.setMeasureFunc(null);
    expect(n.getMeasureFunc()).toBeNull();
  });
});

describe('Node — dirty tracking', () => {
  it('any setter marks the node dirty', () => {
    const n = Node.create();
    n.clearDirty();
    expect(n.isDirty()).toBe(false);
    n.setWidth(10);
    expect(n.isDirty()).toBe(true);
  });

  it('mutating a child marks the parent dirty', () => {
    const root = Node.create();
    const child = Node.create();
    root.insertChild(child, 0);
    root.clearDirty();
    child.clearDirty();
    child.setHeight(5);
    expect(child.isDirty()).toBe(true);
    expect(root.isDirty()).toBe(true);
  });
});

describe('Node — layout entry points', () => {
  it('getComputedLayout returns a fresh object each call', () => {
    const n = Node.create();
    const a = n.getComputedLayout();
    const b = n.getComputedLayout();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('calculateLayout produces a layout for a leaf root', () => {
    const n = Node.create();
    n.setWidth(40);
    n.setHeight(10);
    n.calculateLayout();
    expect(n.getComputedLayout()).toEqual({ left: 0, top: 0, width: 40, height: 10 });
  });
});
