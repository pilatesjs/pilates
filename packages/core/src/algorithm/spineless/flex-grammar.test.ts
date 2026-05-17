import { describe, expect, it } from 'vitest';
import { Edge } from '../../edge.js';
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
  available?: { width?: number; height?: number },
): Array<{ left: number; top: number; width: number; height: number }> {
  const { grammar, allFields } = buildFlexGrammar(root, available);
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
  available?: { width?: number; height?: number },
): Array<{ left: number; top: number; width: number; height: number }> {
  root.calculateLayout(available?.width, available?.height);
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

describe('buildFlexGrammar — margin + padding + gap (slice v5)', () => {
  describe('padding', () => {
    it('row parent padding shifts children to the right', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      root.setPadding(Edge.Left, 10);
      root.setPadding(Edge.Right, 5);
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(30);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('column parent padding shifts children downward', () => {
      const root = Node.create();
      root.setWidth(30);
      root.setHeight(100);
      root.setFlexDirection('column');
      root.setPadding(Edge.Top, 8);
      root.setPadding(Edge.Bottom, 4);
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(30);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('row padding affects cross-axis position (children shift down by padding-top)', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(50);
      root.setFlexDirection('row');
      root.setPadding(Edge.Top, 6);
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(20);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('padding shrinks the flex-grow budget', () => {
      // Container 100 wide, padding 10+10 → inner 80. Two grow=1 children
      // with basis 0 → each gets 40.
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      root.setPadding(Edge.Left, 10);
      root.setPadding(Edge.Right, 10);
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(0);
        c.setHeight(30);
        c.setFlexGrow(1);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('gap', () => {
    it('column-gap spaces row children horizontally', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      root.setGap('column', 8);
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(30);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('row-gap spaces column children vertically', () => {
      const root = Node.create();
      root.setWidth(30);
      root.setHeight(100);
      root.setFlexDirection('column');
      root.setGap('row', 6);
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(30);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('gap is subtracted from the flex-grow budget', () => {
      // 100 wide, gap 10, two grow=1 children of basis 0 → leftover 90,
      // split 45/45, second child sits at 45+10 = 55.
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      root.setGap('column', 10);
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(0);
        c.setHeight(30);
        c.setFlexGrow(1);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('margin', () => {
    it('per-child margins shift their position along the main axis', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      const a = Node.create();
      a.setWidth(20);
      a.setHeight(30);
      a.setMargin(Edge.Left, 5);
      a.setMargin(Edge.Right, 3);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(20);
      b.setHeight(30);
      b.setMargin(Edge.Left, 2);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('cross-axis margin shifts the cross-axis position', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(50);
      root.setFlexDirection('row');
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(20);
      c.setMargin(Edge.Top, 6);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('margins are accounted for in the flex-grow budget', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      const a = Node.create();
      a.setWidth(0);
      a.setHeight(30);
      a.setFlexGrow(1);
      a.setMargin(Edge.Left, 4);
      a.setMargin(Edge.Right, 4);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(0);
      b.setHeight(30);
      b.setFlexGrow(1);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('margins are accounted for in the flex-shrink overflow', () => {
      const root = Node.create();
      root.setWidth(60);
      root.setHeight(30);
      root.setFlexDirection('row');
      const a = Node.create();
      a.setWidth(40);
      a.setHeight(30);
      a.setFlexShrink(1);
      a.setMargin(Edge.Left, 5);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(40);
      b.setHeight(30);
      b.setFlexShrink(1);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('combined', () => {
    it('padding + gap + margin together in a row, no flex', () => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(40);
      root.setFlexDirection('row');
      root.setPadding(Edge.Left, 6);
      root.setPadding(Edge.Top, 4);
      root.setGap('column', 8);
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(20);
        c.setMargin(Edge.Top, 2);
        if (i === 1) c.setMargin(Edge.Left, 3);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('padding + gap + margin together in a column with flex-grow', () => {
      const root = Node.create();
      root.setWidth(40);
      root.setHeight(120);
      root.setFlexDirection('column');
      root.setPadding(Edge.Top, 6);
      root.setPadding(Edge.Left, 4);
      root.setGap('row', 8);
      const a = Node.create();
      a.setWidth(40);
      a.setHeight(20);
      a.setMargin(Edge.Top, 2);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(40);
      b.setHeight(0);
      b.setFlexGrow(1);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('regression: prior slices still match', () => {
    it('v4 shrink tree with default zero spacing still matches imperative', () => {
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

    it('v2 column tree with default zero spacing still matches', () => {
      const root = buildFixedColumnTree(100, 50, [10, 20, 30]);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });
});

describe('buildFlexGrammar — alignment (slice v6)', () => {
  function makeRow(rootWidth: number, rootHeight: number, childWidths: number[]): Node {
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

  describe('justify-content', () => {
    it('flex-start (default) leaves children butt-jointed from the start edge', () => {
      const root = makeRow(120, 30, [20, 30]);
      root.setJustifyContent('flex-start');
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('flex-end pushes children to the trailing edge', () => {
      const root = makeRow(120, 30, [20, 30]);
      root.setJustifyContent('flex-end');
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('center centers the children as a group', () => {
      const root = makeRow(120, 30, [20, 30]);
      root.setJustifyContent('center');
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('space-between spreads gaps between (not before/after)', () => {
      const root = makeRow(120, 30, [20, 20, 20]);
      root.setJustifyContent('space-between');
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('space-around gives half-slot leading + full slot between', () => {
      const root = makeRow(120, 30, [20, 20, 20]);
      root.setJustifyContent('space-around');
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('space-evenly gives equal slots around every item', () => {
      const root = makeRow(120, 30, [20, 20, 20]);
      root.setJustifyContent('space-evenly');
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('justify with leftover=0 (grow consumed all space) is a no-op', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      root.setJustifyContent('center');
      const c = Node.create();
      c.setWidth(0);
      c.setHeight(30);
      c.setFlexGrow(1);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('justify on a column container distributes along the height axis', () => {
      const root = Node.create();
      root.setWidth(30);
      root.setHeight(120);
      root.setFlexDirection('column');
      root.setJustifyContent('center');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(30);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('justify interacts with padding: leftover is computed in inner space', () => {
      const root = makeRow(120, 30, [20, 30]);
      root.setJustifyContent('center');
      root.setPadding(Edge.Left, 10);
      root.setPadding(Edge.Right, 10);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('align-items', () => {
    it('flex-start (explicit) places child cross-pos at marginCrossStart', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(50);
      root.setFlexDirection('row');
      root.setAlignItems('flex-start');
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(20);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('flex-end pushes child to the trailing cross edge', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(50);
      root.setFlexDirection('row');
      root.setAlignItems('flex-end');
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(20);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('center centers the child along the cross axis', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(50);
      root.setFlexDirection('row');
      root.setAlignItems('center');
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(20);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('stretch with explicit child cross size keeps the explicit size', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(50);
      root.setFlexDirection('row');
      root.setAlignItems('stretch');
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(20);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('column-direction align-items centers along the horizontal axis', () => {
      const root = Node.create();
      root.setWidth(60);
      root.setHeight(100);
      root.setFlexDirection('column');
      root.setAlignItems('center');
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(30);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('align-items=flex-end accounts for the child cross-end margin', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(50);
      root.setFlexDirection('row');
      root.setAlignItems('flex-end');
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(20);
      c.setMargin(Edge.Bottom, 4);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('align-items interacts with cross-axis padding', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(50);
      root.setFlexDirection('row');
      root.setAlignItems('center');
      root.setPadding(Edge.Top, 4);
      root.setPadding(Edge.Bottom, 6);
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(20);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('align-self', () => {
    it('align-self=center overrides container align-items=flex-start for one child', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(50);
      root.setFlexDirection('row');
      root.setAlignItems('flex-start');
      const a = Node.create();
      a.setWidth(20);
      a.setHeight(20);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(20);
      b.setHeight(20);
      b.setAlignSelf('center');
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('align-self=auto falls back to container align-items', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(50);
      root.setFlexDirection('row');
      root.setAlignItems('flex-end');
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      c.setAlignSelf('auto');
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('combined justify + align', () => {
    it('row container with center justify and flex-end align places child in correct corner', () => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(60);
      root.setFlexDirection('row');
      root.setJustifyContent('center');
      root.setAlignItems('flex-end');
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('regression: v5 spacing trees still match with default alignment', () => {
    it('v5 padding + gap + margin tree (default flex-start / stretch) still matches', () => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(40);
      root.setFlexDirection('row');
      root.setPadding(Edge.Left, 6);
      root.setGap('column', 8);
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(20);
        c.setMargin(Edge.Top, 2);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });
});

describe('buildFlexGrammar — flex-wrap (slice v7)', () => {
  describe('row wrap', () => {
    it('items that fit in one line behave as nowrap', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(40);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(30);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('two items that overflow the row break onto a second line', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(60);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      const a = Node.create();
      a.setWidth(60);
      a.setHeight(20);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(60);
      b.setHeight(20);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('three items each oversized stack onto three separate lines', () => {
      const root = Node.create();
      root.setWidth(80);
      root.setHeight(100);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('column-gap participates in line capacity (3x40 + 2x10 gap > 100 → spills)', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(60);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      root.setGap('column', 10);
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('row-gap separates wrapped lines on the cross axis', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(80);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      root.setGap('row', 8);
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('each line independently runs flex-grow distribution', () => {
      // Each line has an oversized + a grow=1 child that fills the
      // line's remaining space.
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(80);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      for (let i = 0; i < 4; i++) {
        const c = Node.create();
        c.setWidth(0);
        c.setHeight(20);
        if (i % 2 === 0) {
          c.setWidth(60); // fixed
        } else {
          c.setFlexGrow(1); // takes remainder of its line
        }
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('wrap with container padding shrinks each line capacity', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(80);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      root.setPadding(Edge.Left, 10);
      root.setPadding(Edge.Right, 10);
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('column wrap', () => {
    it('items overflow the column height and break onto a second column', () => {
      const root = Node.create();
      root.setWidth(80);
      root.setHeight(80);
      root.setFlexDirection('column');
      root.setFlexWrap('wrap');
      const a = Node.create();
      a.setWidth(30);
      a.setHeight(60);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(30);
      b.setHeight(60);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('wrap with alignment within line', () => {
    it('align-items=flex-end places items at their line cross-end', () => {
      // Line 1: width 60, line 2: width 60. Both children align bottom.
      // Each line's crossSize = the item's own height (since they're the
      // only items on the line).
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(80);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      root.setAlignItems('flex-end');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('justify-content=center centers each wrapped line independently', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(80);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      root.setJustifyContent('center');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('justify-content=space-evenly spreads each wrapped line independently', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(80);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      root.setJustifyContent('space-evenly');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('align-items=center within multi-line wrap centers each item in its line', () => {
      // Two wrapped lines, each line cross-size = max(item, margin).
      // The second child's height differs so centering uses different
      // padding than flex-start would.
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(80);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      root.setAlignItems('center');
      const a = Node.create();
      a.setWidth(60);
      a.setHeight(20);
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(60);
      b.setHeight(30);
      root.insertChild(b, 1);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('regression: nowrap trees still match', () => {
    it('v6 alignment tree (nowrap by default) still matches imperative', () => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(60);
      root.setFlexDirection('row');
      root.setJustifyContent('center');
      root.setAlignItems('flex-end');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });
});

describe('buildFlexGrammar — align-content (slice v9)', () => {
  // A row-wrap container whose items are each wider than the line,
  // so they stack one-per-line — `count` lines — inside a cross
  // (height) box with `crossLeftover` slack for align-content to
  // distribute.
  function rowWrapLines(count: number, alignContent: string, crossLeftover: number): Node {
    const root = Node.create();
    root.setWidth(80);
    root.setHeight(count * 20 + crossLeftover);
    root.setFlexDirection('row');
    root.setFlexWrap('wrap');
    root.setAlignContent(alignContent as never);
    for (let i = 0; i < count; i++) {
      const c = Node.create();
      c.setWidth(60);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    return root;
  }

  for (const ac of [
    'flex-start',
    'flex-end',
    'center',
    'space-between',
    'space-around',
    'stretch',
  ]) {
    it(`row wrap, 3 lines, align-content: ${ac} — matches imperative`, () => {
      expect(evaluateGrammar(rowWrapLines(3, ac, 60))).toEqual(
        evaluateImperative(rowWrapLines(3, ac, 60)),
      );
    });
  }

  it('row wrap, 2 lines, align-content center — matches imperative', () => {
    expect(evaluateGrammar(rowWrapLines(2, 'center', 50))).toEqual(
      evaluateImperative(rowWrapLines(2, 'center', 50)),
    );
  });

  it('align-content with no cross leftover is a no-op', () => {
    expect(evaluateGrammar(rowWrapLines(3, 'space-between', 0))).toEqual(
      evaluateImperative(rowWrapLines(3, 'space-between', 0)),
    );
  });

  it('single-line wrap ignores align-content', () => {
    const make = (): Node => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(60);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      root.setAlignContent('center');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(30);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });

  it('column wrap distributes lines along the width — matches imperative', () => {
    const make = (): Node => {
      const root = Node.create();
      root.setWidth(150);
      root.setHeight(80);
      root.setFlexDirection('column');
      root.setFlexWrap('wrap');
      root.setAlignContent('space-around');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(30);
        c.setHeight(60);
        root.insertChild(c, i);
      }
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });

  it('align-content stretch composes with per-item align-items', () => {
    const make = (): Node => {
      const root = Node.create();
      root.setWidth(80);
      root.setHeight(120);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      root.setAlignContent('stretch');
      root.setAlignItems('center');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });
});

describe('buildFlexGrammar — flex-wrap: wrap-reverse (slice v10)', () => {
  // A wrap-reverse row whose oversized items stack one-per-line —
  // `count` lines — mirrored on the cross (height) axis.
  function wrapReverseRow(count: number, alignContent: string, crossLeftover: number): Node {
    const root = Node.create();
    root.setWidth(80);
    root.setHeight(count * 20 + crossLeftover);
    root.setFlexDirection('row');
    root.setFlexWrap('wrap-reverse');
    root.setAlignContent(alignContent as never);
    for (let i = 0; i < count; i++) {
      const c = Node.create();
      c.setWidth(60);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    return root;
  }

  it('row wrap-reverse, 3 lines — line stack is mirrored, matches imperative', () => {
    expect(evaluateGrammar(wrapReverseRow(3, 'flex-start', 40))).toEqual(
      evaluateImperative(wrapReverseRow(3, 'flex-start', 40)),
    );
  });

  for (const ac of ['flex-end', 'center', 'space-between', 'space-around', 'stretch']) {
    it(`row wrap-reverse, 3 lines, align-content: ${ac} — matches imperative`, () => {
      expect(evaluateGrammar(wrapReverseRow(3, ac, 50))).toEqual(
        evaluateImperative(wrapReverseRow(3, ac, 50)),
      );
    });
  }

  it('single-line wrap-reverse — matches imperative', () => {
    const make = (): Node => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(60);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap-reverse');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(30);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });

  it('column wrap-reverse mirrors the line stack along the width', () => {
    const make = (): Node => {
      const root = Node.create();
      root.setWidth(150);
      root.setHeight(80);
      root.setFlexDirection('column');
      root.setFlexWrap('wrap-reverse');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(30);
        c.setHeight(60);
        root.insertChild(c, i);
      }
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });

  it('wrap-reverse composes with per-item align-items', () => {
    const make = (): Node => {
      const root = Node.create();
      root.setWidth(80);
      root.setHeight(120);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap-reverse');
      root.setAlignItems('center');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });
});

describe('buildFlexGrammar — reverse directions (slice v11)', () => {
  // A `row-reverse` / `column-reverse` container with `count` fixed
  // children — the main axis runs from the container's END.
  function reverseRow(count: number): Node {
    const root = Node.create();
    root.setWidth(200);
    root.setHeight(40);
    root.setFlexDirection('row-reverse');
    for (let i = 0; i < count; i++) {
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(20);
      root.insertChild(c, i);
    }
    return root;
  }

  it('row-reverse, 3 fixed children — children laid out from the end', () => {
    expect(evaluateGrammar(reverseRow(3))).toEqual(evaluateImperative(reverseRow(3)));
  });

  it('column-reverse, 3 fixed children — matches imperative', () => {
    const make = (): Node => {
      const root = Node.create();
      root.setWidth(40);
      root.setHeight(200);
      root.setFlexDirection('column-reverse');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(30);
        root.insertChild(c, i);
      }
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });

  for (const j of [
    'flex-start',
    'flex-end',
    'center',
    'space-between',
    'space-around',
    'space-evenly',
  ]) {
    it(`row-reverse, justify-content: ${j} — matches imperative`, () => {
      const make = (): Node => {
        const root = reverseRow(3);
        root.setJustifyContent(j as never);
        return root;
      };
      expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
    });
  }

  it('row-reverse with flex-grow distribution — matches imperative', () => {
    const make = (): Node => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(40);
      root.setFlexDirection('row-reverse');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(20);
        c.setFlexGrow(i + 1);
        root.insertChild(c, i);
      }
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });

  it('row-reverse with flex-shrink — matches imperative', () => {
    const make = (): Node => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(40);
      root.setFlexDirection('row-reverse');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(20);
        c.setFlexShrink(1);
        root.insertChild(c, i);
      }
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });

  it('column-reverse with padding, margin and gap — matches imperative', () => {
    const make = (): Node => {
      const root = Node.create();
      root.setWidth(80);
      root.setHeight(200);
      root.setFlexDirection('column-reverse');
      root.setPadding(Edge.Top, 12);
      root.setPadding(Edge.Bottom, 8);
      root.setGap('row', 6);
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(30);
        c.setMargin(Edge.Top, 4);
        c.setMargin(Edge.Bottom, 2);
        root.insertChild(c, i);
      }
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });

  it('row-reverse composes with align-items: center', () => {
    const make = (): Node => {
      const root = reverseRow(3);
      root.setHeight(80);
      root.setAlignItems('center');
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });

  it('row-reverse with flex-wrap — each line reversed on the main axis', () => {
    const make = (): Node => {
      const root = Node.create();
      root.setWidth(150);
      root.setHeight(80);
      root.setFlexDirection('row-reverse');
      root.setFlexWrap('wrap');
      for (let i = 0; i < 4; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });

  it('column-reverse with flex-wrap: wrap-reverse — both axes mirrored', () => {
    const make = (): Node => {
      const root = Node.create();
      root.setWidth(150);
      root.setHeight(80);
      root.setFlexDirection('column-reverse');
      root.setFlexWrap('wrap-reverse');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(60);
        root.insertChild(c, i);
      }
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });

  it('row-reverse with an absolute child — only in-flow children flip', () => {
    const make = (): Node => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(40);
      root.setFlexDirection('row-reverse');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(30);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      const abs = Node.create();
      abs.setPositionType('absolute');
      abs.setWidth(25);
      abs.setHeight(15);
      abs.setPosition(Edge.Left, 10);
      abs.setPosition(Edge.Top, 5);
      root.insertChild(abs, 2);
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });

  it('nested reverse containers — matches imperative', () => {
    const make = (): Node => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(100);
      root.setFlexDirection('row-reverse');
      for (let i = 0; i < 2; i++) {
        const col = Node.create();
        col.setWidth(80);
        col.setHeight(80);
        col.setFlexDirection('column-reverse');
        for (let j = 0; j < 2; j++) {
          const leaf = Node.create();
          leaf.setWidth(40);
          leaf.setHeight(30);
          col.insertChild(leaf, j);
        }
        root.insertChild(col, i);
      }
      return root;
    };
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  });
});

describe('buildFlexGrammar — min/max clamping (slice v12a)', () => {
  // A single-child container; the child carries explicit width +
  // height and optional min/max clamps. No flex weights / numeric
  // flexBasis, so the parent does NOT flex-distribute — this is the
  // v12a no-freeze-loop path.
  function clampedChild(opts: {
    width: number;
    height: number;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    direction?: 'row' | 'column';
  }): Node {
    const root = Node.create();
    root.setWidth(140);
    root.setHeight(140);
    if (opts.direction) root.setFlexDirection(opts.direction);
    const c = Node.create();
    c.setWidth(opts.width);
    c.setHeight(opts.height);
    if (opts.minWidth !== undefined) c.setMinWidth(opts.minWidth);
    if (opts.maxWidth !== undefined) c.setMaxWidth(opts.maxWidth);
    if (opts.minHeight !== undefined) c.setMinHeight(opts.minHeight);
    if (opts.maxHeight !== undefined) c.setMaxHeight(opts.maxHeight);
    root.insertChild(c, 0);
    return root;
  }

  const matches = (make: () => Node): void => {
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  };

  it('min-height raises a too-small main size (column parent)', () => {
    matches(() => clampedChild({ width: 40, height: 10, minHeight: 50 }));
  });

  it('max-height caps an oversized main size (column parent)', () => {
    matches(() => clampedChild({ width: 40, height: 200, maxHeight: 60 }));
  });

  it('min-width raises a too-small cross size (column parent)', () => {
    matches(() => clampedChild({ width: 10, height: 40, minWidth: 35 }));
  });

  it('max-width caps an oversized cross size (column parent)', () => {
    matches(() => clampedChild({ width: 300, height: 40, maxWidth: 90 }));
  });

  it('main size clamped on the width axis (row parent)', () => {
    matches(() => clampedChild({ width: 8, height: 40, minWidth: 30, direction: 'row' }));
  });

  it('min greater than max — the cap wins, mirroring clampSize', () => {
    matches(() => clampedChild({ width: 40, height: 50, minHeight: 80, maxHeight: 20 }));
  });

  it('cross clamp feeds align-items: center positioning', () => {
    matches(() => {
      const root = clampedChild({ width: 12, height: 40, minWidth: 60 });
      root.setAlignItems('center');
      return root;
    });
  });

  it('cross clamp feeds align-items: flex-end positioning', () => {
    matches(() => {
      const root = clampedChild({ width: 250, height: 40, maxWidth: 70 });
      root.setAlignItems('flex-end');
      return root;
    });
  });

  it('clamps compose with padding, margin and gap', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(160);
      root.setHeight(220);
      root.setPadding(Edge.Top, 10);
      root.setPadding(Edge.Bottom, 6);
      root.setGap('row', 8);
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(20);
        c.setMargin(Edge.Top, 4);
        c.setMinHeight(35);
        c.setMaxWidth(30);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('clamped main sizes feed justify-content leftover', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(300);
      root.setHeight(40);
      root.setFlexDirection('row');
      root.setJustifyContent('space-between');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(200);
        c.setHeight(20);
        c.setMaxWidth(50);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('clamped main size feeds a reverse-direction flip', () => {
    matches(() => {
      const root = clampedChild({ width: 4, height: 40, minWidth: 36, direction: 'row' });
      root.setFlexDirection('row-reverse');
      return root;
    });
  });

  it('root node clamps its own width and height', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(180);
      root.setHeight(20);
      root.setMaxWidth(100);
      root.setMinHeight(60);
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(30);
      root.insertChild(c, 0);
      return root;
    });
  });

  it('absolute child: explicit width / height clamped', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(120);
      const abs = Node.create();
      abs.setPositionType('absolute');
      abs.setWidth(300);
      abs.setHeight(5);
      abs.setMaxWidth(70);
      abs.setMinHeight(40);
      abs.setPosition(Edge.Left, 10);
      abs.setPosition(Edge.Top, 8);
      root.insertChild(abs, 0);
      return root;
    });
  });

  it('absolute child: edge-derived size clamped', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(120);
      const abs = Node.create();
      abs.setPositionType('absolute');
      abs.setMaxWidth(30);
      abs.setPosition(Edge.Left, 10);
      abs.setPosition(Edge.Right, 10);
      abs.setPosition(Edge.Top, 8);
      root.insertChild(abs, 0);
      return root;
    });
  });

  it('absolute child: min-width binds even with no explicit width', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(120);
      const abs = Node.create();
      abs.setPositionType('absolute');
      abs.setHeight(20);
      abs.setMinWidth(45);
      abs.setPosition(Edge.Left, 6);
      abs.setPosition(Edge.Top, 6);
      root.insertChild(abs, 0);
      return root;
    });
  });

  it('regression: trees with no min/max are unaffected', () => {
    matches(() => buildFixedRowTree(200, 30, [40, 50, 60]));
  });
});

describe('buildFlexGrammar — min/max in the freeze loop (slice v12b)', () => {
  const matches = (make: () => Node): void => {
    expect(evaluateGrammar(make())).toEqual(evaluateImperative(make()));
  };

  // A row flex container; each child is height 20 with the given
  // per-child grow / shrink / basis / width / min / max.
  function flexRow(
    rootWidth: number,
    children: Array<{
      grow?: number;
      shrink?: number;
      basis?: number;
      width?: number;
      minWidth?: number;
      maxWidth?: number;
    }>,
  ): Node {
    const root = Node.create();
    root.setWidth(rootWidth);
    root.setHeight(40);
    root.setFlexDirection('row');
    children.forEach((opt, i) => {
      const c = Node.create();
      c.setWidth(opt.width ?? 20);
      c.setHeight(20);
      if (opt.grow !== undefined) c.setFlexGrow(opt.grow);
      if (opt.shrink !== undefined) c.setFlexShrink(opt.shrink);
      if (opt.basis !== undefined) c.setFlexBasis(opt.basis);
      if (opt.minWidth !== undefined) c.setMinWidth(opt.minWidth);
      if (opt.maxWidth !== undefined) c.setMaxWidth(opt.maxWidth);
      root.insertChild(c, i);
    });
    return root;
  }

  it('flex-grow: a child hitting max-width freezes, leftover redistributes', () => {
    matches(() => flexRow(300, [{ grow: 1, maxWidth: 40 }, { grow: 1 }, { grow: 1 }]));
  });

  it('flex-grow: a child with min-width raises its hypothetical', () => {
    matches(() => flexRow(200, [{ grow: 1, minWidth: 70 }, { grow: 1 }]));
  });

  it('flex-shrink: a child hitting min-width freezes, overflow redistributes', () => {
    matches(() =>
      flexRow(120, [
        { shrink: 1, width: 80, minWidth: 60 },
        { shrink: 1, width: 80 },
        { shrink: 1, width: 80 },
      ]),
    );
  });

  it('flex-shrink: a child with max-width below basis is pre-clamped', () => {
    matches(() =>
      flexRow(150, [
        { shrink: 1, width: 100, maxWidth: 50 },
        { shrink: 1, width: 100 },
      ]),
    );
  });

  it('flex-grow: cascading freezes need multiple freeze-loop iterations', () => {
    matches(() =>
      flexRow(400, [
        { grow: 1, maxWidth: 30 },
        { grow: 1, maxWidth: 60 },
        { grow: 1 },
        { grow: 1 },
      ]),
    );
  });

  it('flex-grow: every child hits max — leftover stays unconsumed', () => {
    matches(() =>
      flexRow(500, [
        { grow: 1, maxWidth: 40 },
        { grow: 1, maxWidth: 40 },
        { grow: 1, maxWidth: 40 },
      ]),
    );
  });

  it('numeric flex-basis clamped up to min-width', () => {
    matches(() =>
      flexRow(300, [
        { grow: 1, basis: 10, minWidth: 80 },
        { grow: 1, basis: 10 },
      ]),
    );
  });

  it('numeric flex-basis clamped down to max-width', () => {
    matches(() =>
      flexRow(300, [
        { grow: 1, basis: 200, maxWidth: 60 },
        { grow: 1, basis: 40 },
      ]),
    );
  });

  it('min greater than max during distribution — the cap wins', () => {
    matches(() => flexRow(300, [{ grow: 1, minWidth: 90, maxWidth: 30 }, { grow: 1 }]));
  });

  it('column-direction flex distribution clamps on the height axis', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(40);
      root.setHeight(300);
      root.setFlexDirection('column');
      const specs = [
        { minHeight: 50 },
        { maxHeight: 60 },
        {} as { minHeight?: number; maxHeight?: number },
      ];
      specs.forEach((opt, i) => {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(20);
        c.setFlexGrow(1);
        if (opt.minHeight !== undefined) c.setMinHeight(opt.minHeight);
        if (opt.maxHeight !== undefined) c.setMaxHeight(opt.maxHeight);
        root.insertChild(c, i);
      });
      return root;
    });
  });

  it('freeze-loop clamps feed justify-content leftover', () => {
    matches(() => {
      const root = flexRow(360, [{ grow: 1, maxWidth: 50 }, { grow: 1 }, { grow: 1 }]);
      root.setJustifyContent('space-between');
      return root;
    });
  });

  it('freeze-loop clamps feed a reverse-direction flip', () => {
    matches(() => {
      const root = flexRow(300, [{ grow: 1, maxWidth: 40 }, { grow: 1 }, { grow: 1 }]);
      root.setFlexDirection('row-reverse');
      return root;
    });
  });

  it('wrap container: clamped hypothetical changes line packing', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(160);
      root.setHeight(120);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      const widths = [100, 100, 100];
      widths.forEach((w, i) => {
        const c = Node.create();
        c.setWidth(w);
        c.setHeight(20);
        c.setFlexShrink(1);
        c.setMaxWidth(70);
        root.insertChild(c, i);
      });
      return root;
    });
  });

  it('wrap container: per-line distribution runs the freeze loop', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(150);
      root.setHeight(120);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      for (let i = 0; i < 4; i++) {
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(20);
        c.setFlexGrow(1);
        if (i === 0) c.setMaxWidth(55);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('wrap container: cross-axis clamp feeds line cross sizing', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(140);
      root.setHeight(200);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      for (let i = 0; i < 4; i++) {
        const c = Node.create();
        c.setWidth(80);
        c.setHeight(20);
        c.setFlexGrow(1);
        c.setMinHeight(i === 1 ? 50 : 0);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('regression: flex trees with no min/max are unaffected', () => {
    matches(() => flexRow(300, [{ grow: 1 }, { grow: 2 }, { grow: 1 }]));
  });
});

describe("buildFlexGrammar — 'auto' main-axis sizing (slice v13)", () => {
  // v13 covers `'auto'` on the MAIN axis (→ 0, mirroring
  // `resolveHypotheticalMainSize`) and the `'auto'` root (→ caller
  // `available`). `'auto'` on the CROSS axis interacts with
  // `align-items: stretch` and lands in a later slice — these tests
  // keep the cross axis explicit.
  const matches = (make: () => Node, available?: { width?: number; height?: number }): void => {
    expect(evaluateGrammar(make(), available)).toEqual(evaluateImperative(make(), available));
  };

  it("a leaf with 'auto' main (height in a column parent) resolves to 0", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(100);
      const c = Node.create();
      c.setWidth(30); // height 'auto' → main axis of a column parent
      root.insertChild(c, 0);
      return root;
    });
  });

  it("a leaf with 'auto' main (width in a row parent) resolves to 0", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(100);
      root.setFlexDirection('row');
      const c = Node.create();
      c.setHeight(30); // width 'auto' → main axis of a row parent
      root.insertChild(c, 0);
      return root;
    });
  });

  it("an 'auto' root sizes both axes from the caller's available", () => {
    matches(
      () => {
        const root = Node.create(); // both axes 'auto'
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(20);
        root.insertChild(c, 0);
        return root;
      },
      { width: 90, height: 60 },
    );
  });

  it("an 'auto' root with no available resolves to 0", () => {
    matches(() => {
      const root = Node.create();
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, 0);
      return root;
    });
  });

  it("an 'auto' root with one explicit axis sizes the other from available", () => {
    matches(
      () => {
        const root = Node.create();
        root.setWidth(100); // height 'auto'
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(20);
        root.insertChild(c, 0);
        return root;
      },
      { width: 999, height: 50 },
    );
  });

  it("'auto' main basis composes with flex-grow (grows from 0)", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(300);
      root.setHeight(40);
      root.setFlexDirection('row');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setHeight(20); // width 'auto' → basis 0
        c.setFlexGrow(i + 1);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it("'auto' main size composes with min-width clamping", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(40);
      root.setFlexDirection('row');
      const c = Node.create();
      c.setHeight(20); // width 'auto' → 0, then clamped up
      c.setMinWidth(35);
      root.insertChild(c, 0);
      return root;
    });
  });

  it("'auto' main size composes with justify-content", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(240);
      root.setHeight(40);
      root.setFlexDirection('row');
      root.setJustifyContent('space-between');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setHeight(20);
        c.setWidth(40); // explicit; only the test below varies it
        root.insertChild(c, i);
      }
      // middle child auto main → 0, shifts the space-between gaps
      root.getChild(1)!.setWidth('auto' as never);
      return root;
    });
  });

  it("an 'auto' absolute child with no derivable size resolves to 0", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(120);
      const abs = Node.create();
      abs.setPositionType('absolute');
      abs.setPosition(Edge.Left, 10);
      abs.setPosition(Edge.Top, 8);
      // no width / height, only one edge per axis → 0×0
      root.insertChild(abs, 0);
      return root;
    });
  });

  it('nested containers with auto main sizes match the imperative', () => {
    matches(
      () => {
        const root = Node.create(); // auto, from available
        root.setFlexDirection('column');
        for (let i = 0; i < 2; i++) {
          const mid = Node.create(); // height 'auto' (main) → 0
          mid.setWidth(50); // explicit cross — no stretch interaction
          const leaf = Node.create();
          leaf.setWidth(15);
          leaf.setHeight(15);
          mid.insertChild(leaf, 0);
          root.insertChild(mid, i);
        }
        return root;
      },
      { width: 70, height: 70 },
    );
  });
});

describe("buildFlexGrammar — 'auto' cross axis + align-items stretch (slice v14)", () => {
  const matches = (make: () => Node, available?: { width?: number; height?: number }): void => {
    expect(evaluateGrammar(make(), available)).toEqual(evaluateImperative(make(), available));
  };

  it("an 'auto' cross size stretches to fill the parent's inner cross (column)", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(100);
      const c = Node.create();
      c.setHeight(20); // width 'auto' → cross axis, stretches to 100
      root.insertChild(c, 0);
      return root;
    });
  });

  it("an 'auto' cross size stretches to fill the parent's inner cross (row)", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(80);
      root.setFlexDirection('row');
      const c = Node.create();
      c.setWidth(20); // height 'auto' → cross axis, stretches to 80
      root.insertChild(c, 0);
      return root;
    });
  });

  it("align-items: flex-start leaves an 'auto' cross size at 0", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(100);
      root.setAlignItems('flex-start');
      const c = Node.create();
      c.setHeight(20);
      root.insertChild(c, 0);
      return root;
    });
  });

  it("align-self overrides a stretch parent — 'auto' cross stays 0", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(100);
      const c = Node.create();
      c.setHeight(20);
      c.setAlignSelf('center');
      root.insertChild(c, 0);
      return root;
    });
  });

  it('the stretch fill subtracts parent padding', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(100);
      root.setPadding(Edge.Left, 15);
      root.setPadding(Edge.Right, 25);
      const c = Node.create();
      c.setHeight(20);
      root.insertChild(c, 0);
      return root;
    });
  });

  it("the stretch fill subtracts the child's own cross margins", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(100);
      const c = Node.create();
      c.setHeight(20);
      c.setMargin(Edge.Left, 10);
      c.setMargin(Edge.Right, 8);
      root.insertChild(c, 0);
      return root;
    });
  });

  it('a stretched cross size is clamped to min / max', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(40);
      root.setHeight(100);
      const a = Node.create();
      a.setHeight(20);
      a.setMinWidth(70); // stretch fills 40, clamped up to 70
      root.insertChild(a, 0);
      const b = Node.create();
      b.setHeight(20);
      b.setMaxWidth(15); // stretch fills 40, clamped down to 15
      root.insertChild(b, 1);
      return root;
    });
  });

  it("'auto' cross stretch composes with an 'auto' root from available", () => {
    matches(
      () => {
        const root = Node.create(); // auto, from available
        const c = Node.create();
        c.setHeight(20);
        root.insertChild(c, 0);
        return root;
      },
      { width: 64, height: 64 },
    );
  });

  it('both axes auto on a leaf — main resolves to 0, cross stretches', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(80);
      root.setHeight(80);
      root.setFlexDirection('row');
      const c = Node.create(); // width 'auto' (main → 0), height 'auto' (cross → stretch)
      root.insertChild(c, 0);
      return root;
    });
  });

  it("'auto' cross stretch in a single-line wrap container", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(60);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(40); // explicit main
        // height 'auto' → cross, stretches to the single line's cross
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it("'auto' cross stretch in a multi-line wrap container", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(150);
      root.setHeight(120);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      // 60-wide items: two per 150-wide line → two lines.
      for (let i = 0; i < 4; i++) {
        const c = Node.create();
        c.setWidth(60);
        if (i % 2 === 0) c.setHeight(30); // explicit — gives the line a height
        // odd children: height 'auto' → stretch to their line's cross
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it("'auto' cross stretch picks up an align-content line boost", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(150);
      root.setHeight(200);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      root.setAlignContent('stretch');
      for (let i = 0; i < 4; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(20);
        if (i % 2 === 1) c.setHeight('auto' as never); // stretches per line
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it("'auto' cross stretch composes with reverse direction", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(100);
      root.setFlexDirection('row-reverse');
      const c = Node.create();
      c.setWidth(30);
      root.insertChild(c, 0); // height 'auto' → cross stretch
      return root;
    });
  });

  it('nested auto-cross containers each stretch to their parent', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(90);
      root.setHeight(90);
      const mid = Node.create();
      mid.setHeight(50); // width 'auto' → stretches to 90
      const leaf = Node.create();
      leaf.setHeight(20); // width 'auto' → stretches to mid's width
      mid.insertChild(leaf, 0);
      root.insertChild(mid, 0);
      return root;
    });
  });
});

describe('buildFlexGrammar — aspectRatio derivation (slice v15)', () => {
  const matches = (make: () => Node, available?: { width?: number; height?: number }): void => {
    expect(evaluateGrammar(make(), available)).toEqual(evaluateImperative(make(), available));
  };

  it("'auto' width derives from height × aspectRatio", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(200);
      root.setAlignItems('flex-start'); // keep the auto width from stretching
      const c = Node.create();
      c.setHeight(40); // width 'auto', ratio 2 → width 80
      c.setAspectRatio(2);
      root.insertChild(c, 0);
      return root;
    });
  });

  it("'auto' height derives from width ÷ aspectRatio", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(200);
      const c = Node.create();
      c.setWidth(90); // height 'auto', ratio 3 → height 30
      c.setAspectRatio(3);
      root.insertChild(c, 0);
      return root;
    });
  });

  it('a fractional aspectRatio derives correctly', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(200);
      const c = Node.create();
      c.setWidth(50); // height 'auto', ratio 0.5 → height 100
      c.setAspectRatio(0.5);
      root.insertChild(c, 0);
      return root;
    });
  });

  it('both axes auto + aspectRatio → ratio cannot derive, both content-sized', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(120);
      root.setAlignItems('flex-start');
      const c = Node.create(); // both 'auto'
      c.setAspectRatio(2);
      root.insertChild(c, 0);
      return root;
    });
  });

  it('both axes explicit + aspectRatio → ratio ignored', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(120);
      const c = Node.create();
      c.setWidth(40);
      c.setHeight(70); // explicit; ratio 2 would say 80 — ignored
      c.setAspectRatio(2);
      root.insertChild(c, 0);
      return root;
    });
  });

  it('an aspectRatio-derived main size feeds flex layout', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(300);
      root.setHeight(60);
      root.setFlexDirection('row');
      root.setJustifyContent('flex-end');
      const c = Node.create();
      c.setHeight(40); // width 'auto' (main), ratio 2 → main 80
      c.setAspectRatio(2);
      root.insertChild(c, 0);
      return root;
    });
  });

  it('an aspectRatio-derived main size is the flex-grow basis', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(300);
      root.setHeight(60);
      root.setFlexDirection('row');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setHeight(30); // width 'auto', ratio 2 → basis 60
        c.setAspectRatio(2);
        c.setFlexGrow(1);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('an aspectRatio-derived cross size is definite — not stretched', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(80);
      root.setFlexDirection('row'); // cross = height; alignItems stretch (default)
      const c = Node.create();
      c.setWidth(50); // height 'auto', ratio 2 → height 25 (NOT stretched to 80)
      c.setAspectRatio(2);
      root.insertChild(c, 0);
      return root;
    });
  });

  it("an 'auto' root derives its size from aspectRatio over available", () => {
    matches(
      () => {
        const root = Node.create();
        root.setHeight(60); // width 'auto', ratio 3 → width 180 (not available's 999)
        root.setAspectRatio(3);
        const c = Node.create();
        c.setWidth(10);
        c.setHeight(10);
        root.insertChild(c, 0);
        return root;
      },
      { width: 999, height: 999 },
    );
  });

  it('an aspectRatio-derived size is clamped to min / max', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(200);
      const c = Node.create();
      c.setWidth(100); // height 'auto', ratio 1 → 100, capped by maxHeight 40
      c.setAspectRatio(1);
      c.setMaxHeight(40);
      root.insertChild(c, 0);
      return root;
    });
  });

  it('aspectRatio derivation composes with flex-wrap', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(150);
      root.setHeight(120);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      for (let i = 0; i < 4; i++) {
        const c = Node.create();
        c.setHeight(30); // width 'auto', ratio 2 → 60 → two per line
        c.setAspectRatio(2);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('nested aspectRatio-derived containers match the imperative', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(160);
      root.setHeight(160);
      const mid = Node.create();
      mid.setHeight(80); // width 'auto', ratio 1.5 → 120
      mid.setAspectRatio(1.5);
      const leaf = Node.create();
      leaf.setHeight(20); // width 'auto', ratio 2 → 40
      leaf.setAspectRatio(2);
      mid.insertChild(leaf, 0);
      root.insertChild(mid, 0);
      return root;
    });
  });
});

describe('buildFlexGrammar — measure-func leaves, main axis (slice v16a)', () => {
  const matches = (make: () => Node, available?: { width?: number; height?: number }): void => {
    expect(evaluateGrammar(make(), available)).toEqual(evaluateImperative(make(), available));
  };

  it("a measure leaf's 'auto' main resolves to the measured size (column parent)", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(100);
      const leaf = Node.create();
      leaf.setWidth(40); // explicit cross
      leaf.setMeasureFunc(() => ({ width: 40, height: 26 }));
      root.insertChild(leaf, 0);
      return root;
    });
  });

  it("a measure leaf's 'auto' main resolves to the measured size (row parent)", () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(100);
      root.setFlexDirection('row');
      const leaf = Node.create();
      leaf.setHeight(30); // explicit cross
      leaf.setMeasureFunc(() => ({ width: 55, height: 30 }));
      root.insertChild(leaf, 0);
      return root;
    });
  });

  it('the measurer receives the cross style size as its AtMost constraint', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(100);
      const leaf = Node.create();
      leaf.setWidth(45); // cross constraint passed to the measurer
      // height (main) depends on the width constraint — text-wrap style.
      leaf.setMeasureFunc((w) => ({ width: w, height: Math.floor(w / 3) + 4 }));
      root.insertChild(leaf, 0);
      return root;
    });
  });

  it('a numeric flex-basis wins over the measurer (no measure call)', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(100);
      const leaf = Node.create();
      leaf.setWidth(40);
      leaf.setFlexBasis(33); // numeric basis → measurer not consulted for main
      leaf.setMeasureFunc(() => ({ width: 40, height: 999 }));
      root.insertChild(leaf, 0);
      return root;
    });
  });

  it('a measured main size feeds flex-grow as the basis', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(300);
      root.setHeight(60);
      root.setFlexDirection('row');
      for (let i = 0; i < 2; i++) {
        const leaf = Node.create();
        leaf.setHeight(30);
        leaf.setFlexGrow(1);
        leaf.setMeasureFunc(() => ({ width: 20 + i * 10, height: 30 }));
        root.insertChild(leaf, i);
      }
      return root;
    });
  });

  it('a measured main size is clamped to min / max', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(200);
      const a = Node.create();
      a.setWidth(30);
      a.setMinHeight(50); // measured 12, clamped up to 50
      a.setMeasureFunc(() => ({ width: 30, height: 12 }));
      root.insertChild(a, 0);
      const b = Node.create();
      b.setWidth(30);
      b.setMaxHeight(20); // measured 90, clamped down to 20
      b.setMeasureFunc(() => ({ width: 30, height: 90 }));
      root.insertChild(b, 1);
      return root;
    });
  });

  it('a measure leaf coexists with non-measure siblings in a flex row', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(50);
      root.setFlexDirection('row');
      const plain = Node.create();
      plain.setWidth(40);
      plain.setHeight(30);
      root.insertChild(plain, 0);
      const leaf = Node.create();
      leaf.setHeight(30);
      leaf.setMeasureFunc(() => ({ width: 35, height: 30 }));
      root.insertChild(leaf, 1);
      return root;
    });
  });

  it('measured main sizes feed justify-content leftover', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(300);
      root.setHeight(40);
      root.setFlexDirection('row');
      root.setJustifyContent('space-between');
      for (let i = 0; i < 3; i++) {
        const leaf = Node.create();
        leaf.setHeight(20);
        leaf.setMeasureFunc(() => ({ width: 30 + i * 15, height: 20 }));
        root.insertChild(leaf, i);
      }
      return root;
    });
  });

  it('measure leaves compose with flex-wrap', () => {
    matches(() => {
      const root = Node.create();
      root.setWidth(150);
      root.setHeight(120);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      for (let i = 0; i < 4; i++) {
        const leaf = Node.create();
        leaf.setHeight(25);
        leaf.setMeasureFunc(() => ({ width: 60, height: 25 }));
        root.insertChild(leaf, i);
      }
      return root;
    });
  });

  it('a measure leaf inside an auto-sized column container', () => {
    matches(
      () => {
        const root = Node.create(); // auto from available
        root.setFlexDirection('column');
        const leaf = Node.create();
        leaf.setWidth(40);
        leaf.setMeasureFunc(() => ({ width: 40, height: 22 }));
        root.insertChild(leaf, 0);
        return root;
      },
      { width: 80, height: 80 },
    );
  });
});

describe('buildFlexGrammar — absolute positioning (slice v8)', () => {
  describe('basic absolute layout', () => {
    it('absolute child with explicit size + top/left edges anchors to parent outer corner', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(60);
      const c = Node.create();
      c.setPositionType('absolute');
      c.setWidth(20);
      c.setHeight(15);
      c.setPosition(Edge.Top, 4);
      c.setPosition(Edge.Left, 8);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('absolute child anchored to right edge', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(60);
      const c = Node.create();
      c.setPositionType('absolute');
      c.setWidth(20);
      c.setHeight(15);
      c.setPosition(Edge.Right, 10);
      c.setPosition(Edge.Top, 4);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('absolute child anchored to bottom edge', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(60);
      const c = Node.create();
      c.setPositionType('absolute');
      c.setWidth(20);
      c.setHeight(15);
      c.setPosition(Edge.Bottom, 6);
      c.setPosition(Edge.Left, 4);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('absolute child with no edges uses its margins as offsets', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(60);
      const c = Node.create();
      c.setPositionType('absolute');
      c.setWidth(20);
      c.setHeight(15);
      c.setMargin(Edge.Left, 5);
      c.setMargin(Edge.Top, 3);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('derived size from opposing edges', () => {
    it('absolute child with left + right edges derives width', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(60);
      const c = Node.create();
      c.setPositionType('absolute');
      c.setHeight(15);
      c.setPosition(Edge.Left, 10);
      c.setPosition(Edge.Right, 20);
      c.setPosition(Edge.Top, 4);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('absolute child with top + bottom edges derives height', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(60);
      const c = Node.create();
      c.setPositionType('absolute');
      c.setWidth(20);
      c.setPosition(Edge.Top, 4);
      c.setPosition(Edge.Bottom, 6);
      c.setPosition(Edge.Left, 10);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('coexistence with in-flow siblings', () => {
    it('absolute children do not shift in-flow siblings', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(40);
      root.setFlexDirection('row');
      // Two in-flow children at widths 30 each.
      const a = Node.create();
      a.setWidth(30);
      a.setHeight(40);
      root.insertChild(a, 0);
      // Absolute child in the middle of the children list.
      const abs = Node.create();
      abs.setPositionType('absolute');
      abs.setWidth(20);
      abs.setHeight(20);
      abs.setPosition(Edge.Top, 5);
      abs.setPosition(Edge.Left, 5);
      root.insertChild(abs, 1);
      const b = Node.create();
      b.setWidth(30);
      b.setHeight(40);
      root.insertChild(b, 2);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });

    it('in-flow flex-grow correctly ignores absolute siblings', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(40);
      root.setFlexDirection('row');
      // Two in-flow children: one fixed, one grow=1. Plus an absolute.
      const fixed = Node.create();
      fixed.setWidth(20);
      fixed.setHeight(40);
      root.insertChild(fixed, 0);
      const abs = Node.create();
      abs.setPositionType('absolute');
      abs.setWidth(15);
      abs.setHeight(15);
      abs.setPosition(Edge.Right, 4);
      abs.setPosition(Edge.Top, 4);
      root.insertChild(abs, 1);
      const grow = Node.create();
      grow.setWidth(0);
      grow.setHeight(40);
      grow.setFlexGrow(1);
      root.insertChild(grow, 2);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('parent outer box semantics', () => {
    it('absolute children ignore parent padding (use outer corner)', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(60);
      root.setPadding(Edge.Left, 10);
      root.setPadding(Edge.Top, 8);
      const c = Node.create();
      c.setPositionType('absolute');
      c.setWidth(20);
      c.setHeight(15);
      c.setPosition(Edge.Left, 5);
      c.setPosition(Edge.Top, 5);
      root.insertChild(c, 0);
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });

  describe('regression: prior slices unaffected', () => {
    it('a v7 wrap tree still matches when no children are absolute', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(80);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      expect(evaluateGrammar(root)).toEqual(evaluateImperative(root));
    });
  });
});
