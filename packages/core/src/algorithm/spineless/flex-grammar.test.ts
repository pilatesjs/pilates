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
 * Run the grammar through the topological interpreter, then apply the
 * same integer-cell rounding rule the imperative pipeline does in
 * `round.ts`: round each node's absolute corner (and absolute right /
 * bottom edge), derive width/height from the rounded edges, and the
 * sibling-relative `left`/`top` from the rounded absolute positions.
 *
 * The grammar itself emits floating-point layouts — describing the
 * layout equations is the v3 scope; folding rounding into the field
 * graph as derived fields is reserved for a later slice. Doing it as a
 * post-pass on the grammar's output keeps the comparison against the
 * imperative byte-identical when fractional widths arise (any
 * flex-grow ratio that doesn't divide cleanly into the budget).
 */
function evaluateGrammar(
  root: Node,
): Array<{ left: number; top: number; width: number; height: number }> {
  const { grammar, allFields } = buildFlexGrammar(root);
  const interp = new TopoInterpreter(grammar);
  const floatByNode = new Map<Node, { left: number; top: number; width: number; height: number }>();
  for (const f of allFields) {
    floatByNode.set(f.node, {
      left: interp.evaluate(f.left),
      top: interp.evaluate(f.top),
      width: interp.evaluate(f.width),
      height: interp.evaluate(f.height),
    });
  }

  const out: Array<{ left: number; top: number; width: number; height: number }> = [];
  function visitForRound(
    node: Node,
    parentAbsX: number,
    parentAbsY: number,
    parentRoundedX: number,
    parentRoundedY: number,
  ): void {
    const f = floatByNode.get(node)!;
    const absX = parentAbsX + f.left;
    const absY = parentAbsY + f.top;
    const roundedX = Math.round(absX);
    const roundedY = Math.round(absY);
    const roundedR = Math.round(absX + f.width);
    const roundedB = Math.round(absY + f.height);
    out.push({
      left: roundedX - parentRoundedX,
      top: roundedY - parentRoundedY,
      width: Math.max(0, roundedR - roundedX),
      height: Math.max(0, roundedB - roundedY),
    });
    for (let i = 0; i < node.getChildCount(); i++) {
      visitForRound(node.getChild(i)!, absX, absY, roundedX, roundedY);
    }
  }
  visitForRound(root, 0, 0, 0, 0);
  return out;
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

describe('buildFlexGrammar — flex-grow (slice v3)', () => {
  describe('row direction', () => {
    it('single child with flexGrow=1 fills remaining space', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(30);
      c.setFlexGrow(1);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('two equal-grow children split leftover space evenly', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(10);
        c.setHeight(30);
        c.setFlexGrow(1);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('weighted grow distributes leftover by ratio (1:2)', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      const a = Node.create();
      a.setWidth(10);
      a.setHeight(30);
      a.setFlexGrow(1);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(10);
      b.setHeight(30);
      b.setFlexGrow(2);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('fixed-width sibling next to grow child: grow takes the remainder', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      const fixed = Node.create();
      fixed.setWidth(30);
      fixed.setHeight(30);
      root.insertChild(fixed, 0);
      const grow = Node.create();
      grow.setWidth(0);
      grow.setHeight(30);
      grow.setFlexGrow(1);
      root.insertChild(grow, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('exact-fit container with grow set: no growth occurs', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      const a = Node.create();
      a.setWidth(60);
      a.setHeight(30);
      a.setFlexGrow(1);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(40);
      b.setHeight(30);
      b.setFlexGrow(1);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('overflow with default shrink=0: widths unchanged (matches imperative)', () => {
      const root = Node.create();
      root.setWidth(50);
      root.setHeight(30);
      root.setFlexDirection('row');
      const a = Node.create();
      a.setWidth(40);
      a.setHeight(30);
      a.setFlexGrow(1);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(40);
      b.setHeight(30);
      b.setFlexGrow(1);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('column direction', () => {
    it('single grow child fills the remaining height', () => {
      const root = Node.create();
      root.setWidth(40);
      root.setHeight(100);
      root.setFlexDirection('column');
      const c = Node.create();
      c.setWidth(40);
      c.setHeight(20);
      c.setFlexGrow(1);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('fixed-height sibling next to grow child: grow takes the remainder', () => {
      const root = Node.create();
      root.setWidth(40);
      root.setHeight(100);
      root.setFlexDirection('column');
      const fixed = Node.create();
      fixed.setWidth(40);
      fixed.setHeight(30);
      root.insertChild(fixed, 0);
      const grow = Node.create();
      grow.setWidth(40);
      grow.setHeight(0);
      grow.setFlexGrow(1);
      root.insertChild(grow, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('weighted column grow: 1:3 split of leftover height', () => {
      const root = Node.create();
      root.setWidth(40);
      root.setHeight(100);
      root.setFlexDirection('column');
      const a = Node.create();
      a.setWidth(40);
      a.setHeight(0);
      a.setFlexGrow(1);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(40);
      b.setHeight(0);
      b.setFlexGrow(3);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('precondition errors', () => {
    it('throws when a flex-grow sibling lacks an explicit numeric basis', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      const a = Node.create();
      a.setWidth(20);
      a.setHeight(30);
      a.setFlexGrow(1);
      root.insertChild(a, 0);
      const b = Node.create();
      // No setWidth — style.width stays at 'auto'. Building the grammar
      // for `a` must fail because its sibling-basis read returns a
      // non-number, which the grow distribution can't consume.
      b.setHeight(30);
      root.insertChild(b, 1);
      expect(() => buildFlexGrammar(root)).toThrow(/flex sibling requires explicit numeric width/);
    });
  });

  describe('regression: pure fixed-size trees still work', () => {
    it('v2 column tree without any grow still matches imperative', () => {
      const root = buildFixedColumnTree(100, 50, [10, 20, 30]);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('v1 row tree without any grow still matches imperative', () => {
      const root = buildFixedRowTree(100, 50, [10, 20, 30]);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });
});

describe('buildFlexGrammar — flex-shrink + flex-basis (slice v4)', () => {
  describe('shrink in row direction', () => {
    it('two equal-shrink children split overflow proportionally to basis', () => {
      // Bases sum 120, budget 100 → overflow 20. Equal shrink=1 and equal
      // bases → each shrinks by 10. Result: both children at 50.
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(30);
        c.setFlexShrink(1);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('asymmetric shrink weights (1 vs 2) shrink proportionally to shrink*basis', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      const a = Node.create();
      a.setWidth(60);
      a.setHeight(30);
      a.setFlexShrink(1);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(60);
      b.setHeight(30);
      b.setFlexShrink(2);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('shrink=0 sibling stays fixed while shrink=1 sibling absorbs all overflow', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      const fixed = Node.create();
      fixed.setWidth(60);
      fixed.setHeight(30);
      // No setFlexShrink → default 0, so 'fixed' must stay at 60.
      root.insertChild(fixed, 0);
      const shrink = Node.create();
      shrink.setWidth(60);
      shrink.setHeight(30);
      shrink.setFlexShrink(1);
      root.insertChild(shrink, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('different bases with equal shrink: larger child shrinks more', () => {
      // basis 90 + basis 30 = 120, budget 100 → overflow 20.
      // Scaled: 90*1 = 90; 30*1 = 30; total 120.
      // Reductions: 20*(90/120)=15 and 20*(30/120)=5. → finals 75 and 25.
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      const big = Node.create();
      big.setWidth(90);
      big.setHeight(30);
      big.setFlexShrink(1);
      root.insertChild(big, 0);
      const small = Node.create();
      small.setWidth(30);
      small.setHeight(30);
      small.setFlexShrink(1);
      root.insertChild(small, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('shrink in column direction', () => {
    it('two equal-shrink column children shrink along the height axis', () => {
      const root = Node.create();
      root.setWidth(40);
      root.setHeight(100);
      root.setFlexDirection('column');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(60);
        c.setFlexShrink(1);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('flex-basis as a separate property', () => {
    it('flexBasis overrides style.width as the hypothetical main size', () => {
      // The hypothetical for distribution uses flexBasis (20), not the
      // style.width (50). With no grow or shrink, the final size equals
      // the hypothetical, so the child ends up at width 20 even though
      // style.width was 50.
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      const c = Node.create();
      c.setWidth(50);
      c.setHeight(30);
      c.setFlexBasis(20);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('flexBasis combined with flexGrow: distribution sums from basis values', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      const a = Node.create();
      a.setWidth(99); // ignored
      a.setHeight(30);
      a.setFlexBasis(20);
      a.setFlexGrow(1);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(99); // ignored
      b.setHeight(30);
      b.setFlexBasis(30);
      b.setFlexGrow(1);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('flexBasis combined with flexShrink: overflow shrinks from basis values', () => {
      const root = Node.create();
      root.setWidth(60);
      root.setHeight(30);
      root.setFlexDirection('row');
      const a = Node.create();
      a.setWidth(0);
      a.setHeight(30);
      a.setFlexBasis(50);
      a.setFlexShrink(1);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(0);
      b.setHeight(30);
      b.setFlexBasis(30);
      b.setFlexShrink(1);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('precondition errors', () => {
    it('throws when a shrink sibling lacks an explicit numeric basis', () => {
      const root = Node.create();
      root.setWidth(50);
      root.setHeight(30);
      root.setFlexDirection('row');
      const a = Node.create();
      a.setWidth(40);
      a.setHeight(30);
      a.setFlexShrink(1);
      root.insertChild(a, 0);
      const b = Node.create();
      // No setWidth and no setFlexBasis — both are 'auto'.
      b.setHeight(30);
      root.insertChild(b, 1);
      expect(() => buildFlexGrammar(root)).toThrow(/flex sibling requires explicit numeric/);
    });
  });

  describe('regression: prior slices still match', () => {
    it('v3 grow tree (no shrink, no basis) still matches imperative', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      const a = Node.create();
      a.setWidth(10);
      a.setHeight(30);
      a.setFlexGrow(1);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(10);
      b.setHeight(30);
      b.setFlexGrow(2);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });
});
