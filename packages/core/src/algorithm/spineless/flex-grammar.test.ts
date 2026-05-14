import { describe, expect, it } from 'vitest';
import { Node } from '../../node.js';
import { buildFlexGrammar } from './flex-grammar.js';
import { TopoInterpreter } from './grammar.js';

/**
 * Build a fixed-width row tree: a root container of width `rootWidth`
 * with `childWidths.length` children, each of the specified width and
 * a constant height. Used as the input shape for the differential tests.
 */
function buildFixedRowTree(rootWidth: number, rootHeight: number, childWidths: number[]): Node {
  const root = Node.create();
  root.setWidth(rootWidth);
  root.setHeight(rootHeight);
  root.setFlexDirection('row');
  for (let i = 0; i < childWidths.length; i++) {
    const c = Node.create();
    c.setWidth(childWidths[i]!);
    c.setHeight(rootHeight);
    root.insertChild(c, i);
  }
  return root;
}

/**
 * Column analogue of `buildFixedRowTree`: children stack vertically.
 * Each child shares the root's width; heights vary across `childHeights`.
 */
function buildFixedColumnTree(rootWidth: number, rootHeight: number, childHeights: number[]): Node {
  const root = Node.create();
  root.setWidth(rootWidth);
  root.setHeight(rootHeight);
  root.setFlexDirection('column');
  for (let i = 0; i < childHeights.length; i++) {
    const c = Node.create();
    c.setWidth(rootWidth);
    c.setHeight(childHeights[i]!);
    root.insertChild(c, i);
  }
  return root;
}

/**
 * Run the grammar through the topological interpreter and collect the
 * computed `{left, top, width, height}` for every node in pre-order.
 */
function evaluateGrammar(
  root: Node,
): Array<{ left: number; top: number; width: number; height: number }> {
  const { grammar, allFields } = buildFlexGrammar(root);
  const interp = new TopoInterpreter(grammar);
  return allFields.map((f) => ({
    left: interp.evaluate(f.left),
    top: interp.evaluate(f.top),
    width: interp.evaluate(f.width),
    height: interp.evaluate(f.height),
  }));
}

/**
 * Run the imperative `calculateLayout` and collect the same layout
 * shape in pre-order. This is the oracle the grammar must match.
 */
function evaluateImperative(
  root: Node,
): Array<{ left: number; top: number; width: number; height: number }> {
  root.calculateLayout();
  const out: Array<{ left: number; top: number; width: number; height: number }> = [];
  function visit(n: Node): void {
    out.push({
      left: n.layout.left,
      top: n.layout.top,
      width: n.layout.width,
      height: n.layout.height,
    });
    for (let i = 0; i < n.getChildCount(); i++) visit(n.getChild(i)!);
  }
  visit(root);
  return out;
}

describe('buildFlexGrammar — fixed-width row (slice v1)', () => {
  describe('basic correctness', () => {
    it('single root with no children', () => {
      const root = buildFixedRowTree(100, 50, []);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('root with one child', () => {
      const root = buildFixedRowTree(100, 50, [30]);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('root with two children', () => {
      const root = buildFixedRowTree(100, 50, [30, 70]);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('root with five evenly-sized children', () => {
      const root = buildFixedRowTree(100, 50, [20, 20, 20, 20, 20]);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('root with widths that overflow (no shrink applied — explicit widths preserved)', () => {
      // With no flex-shrink, children retain their explicit widths even
      // when sum > root.width. The imperative algo also does this when
      // none of the children have flex-shrink set (default = 0).
      const root = buildFixedRowTree(100, 50, [60, 60]);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('butt-joint invariant', () => {
    it('each non-first child sits immediately after its predecessor', () => {
      const root = buildFixedRowTree(200, 30, [10, 20, 30, 40]);
      const out = evaluateGrammar(root);
      // out[0] = root, out[1..4] = children
      for (let i = 2; i < out.length; i++) {
        const prev = out[i - 1]!;
        const cur = out[i]!;
        expect(cur.left).toBe(prev.left + prev.width);
      }
    });
  });

  describe('nested trees', () => {
    it('row of rows: 2-deep tree of fixed-width children', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(50);
      root.setFlexDirection('row');
      for (let i = 0; i < 2; i++) {
        const child = Node.create();
        child.setWidth(50);
        child.setHeight(50);
        child.setFlexDirection('row');
        root.insertChild(child, i);
        for (let j = 0; j < 2; j++) {
          const gc = Node.create();
          gc.setWidth(25);
          gc.setHeight(50);
          child.insertChild(gc, j);
        }
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('precondition errors', () => {
    it('throws when a node has non-numeric width', () => {
      const root = Node.create();
      root.setHeight(50);
      // No setWidth → style.width is undefined/auto
      expect(() => buildFlexGrammar(root)).toThrow(/requires explicit numeric width/);
    });

    it('throws when a node has non-numeric height', () => {
      const root = Node.create();
      root.setWidth(100);
      expect(() => buildFlexGrammar(root)).toThrow(/requires explicit numeric height/);
    });
  });
});

describe('buildFlexGrammar — fixed-size column (slice v2)', () => {
  describe('basic correctness', () => {
    it('column root with one child', () => {
      const root = buildFixedColumnTree(100, 50, [20]);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('column root with two children', () => {
      const root = buildFixedColumnTree(100, 50, [20, 30]);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('column root with five evenly-sized children', () => {
      const root = buildFixedColumnTree(100, 50, [10, 10, 10, 10, 10]);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('column root with heights that overflow (no shrink applied)', () => {
      const root = buildFixedColumnTree(100, 50, [40, 40]);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('butt-joint invariant', () => {
    it('each non-first child sits immediately below its predecessor', () => {
      const root = buildFixedColumnTree(80, 200, [10, 20, 30, 40]);
      const out = evaluateGrammar(root);
      // out[0] = root, out[1..4] = children
      for (let i = 2; i < out.length; i++) {
        const prev = out[i - 1]!;
        const cur = out[i]!;
        expect(cur.top).toBe(prev.top + prev.height);
        // Cross-axis stays at 0 in this slice (no alignment).
        expect(cur.left).toBe(0);
      }
    });
  });

  describe('mixed-direction nesting', () => {
    it('column of rows: outer stacks vertically, each inner row stacks horizontally', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(60);
      root.setFlexDirection('column');
      for (let i = 0; i < 2; i++) {
        const innerRow = Node.create();
        innerRow.setWidth(100);
        innerRow.setHeight(30);
        innerRow.setFlexDirection('row');
        root.insertChild(innerRow, i);
        for (let j = 0; j < 2; j++) {
          const gc = Node.create();
          gc.setWidth(50);
          gc.setHeight(30);
          innerRow.insertChild(gc, j);
        }
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('row of columns: outer stacks horizontally, each inner column stacks vertically', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(60);
      root.setFlexDirection('row');
      for (let i = 0; i < 2; i++) {
        const innerCol = Node.create();
        innerCol.setWidth(50);
        innerCol.setHeight(60);
        innerCol.setFlexDirection('column');
        root.insertChild(innerCol, i);
        for (let j = 0; j < 2; j++) {
          const gc = Node.create();
          gc.setWidth(50);
          gc.setHeight(30);
          innerCol.insertChild(gc, j);
        }
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('out-of-scope directions', () => {
    it('throws on row-reverse — reserved for a later slice', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(50);
      root.setFlexDirection('row-reverse');
      expect(() => buildFlexGrammar(root)).toThrow(/flex-direction.*row-reverse/);
    });

    it('throws on column-reverse — reserved for a later slice', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(50);
      root.setFlexDirection('column-reverse');
      expect(() => buildFlexGrammar(root)).toThrow(/flex-direction.*column-reverse/);
    });
  });
});
