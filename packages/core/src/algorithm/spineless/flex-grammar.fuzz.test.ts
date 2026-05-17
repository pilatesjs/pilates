/**
 * Differential fuzzer (phase 7, v17): the Spineless flex grammar vs
 * the imperative `calculateLayout`.
 *
 * `flex-grammar.test.ts` validates each feature byte-identically in
 * isolation; this file does the same for *random combinations* of
 * the whole v1–v16 surface — numeric / `'auto'` sizes, flexBasis,
 * grow / shrink, min / max, padding / margin / gap, every
 * `flex-direction` and `flex-wrap`, justify / align*, absolute
 * positioning, `aspectRatio`, and measure-function leaves.
 *
 * For each generated tree the property asserts
 * `evaluateGrammar(tree) === evaluateImperative(tree)` after the
 * shared integer-cell rounding. Any divergence should be reproduced
 * from its `fast-check` seed and pinned as a deterministic
 * regression test in `flex-grammar.test.ts`.
 *
 * Known uncovered (deliberately not generated): `display: none`,
 * and a measure function on an `'absolute'` node — the grammar's
 * `emitAbsoluteRules` does not consult the measurer (out of v16
 * scope), so that combination is excluded rather than flagged.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Edge } from '../../edge.js';
import type { MeasureMode } from '../../measure-func.js';
import { Node } from '../../node.js';
import { buildFlexGrammar } from './flex-grammar.js';
import { TopoInterpreter } from './grammar.js';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Dir = 'row' | 'column' | 'row-reverse' | 'column-reverse';
type Wrap = 'nowrap' | 'wrap' | 'wrap-reverse';
type Justify =
  | 'flex-start'
  | 'flex-end'
  | 'center'
  | 'space-between'
  | 'space-around'
  | 'space-evenly';
type Align = 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch';
type AlignContent =
  | 'flex-start'
  | 'flex-end'
  | 'center'
  | 'space-between'
  | 'space-around'
  | 'stretch';
type Edges = [number, number, number, number];

interface NodeSpec {
  width?: number; // omitted → 'auto'
  height?: number;
  flexBasis?: number;
  flexGrow: number;
  flexShrink: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  padding?: Edges;
  margin?: Edges;
  gapRow: number;
  gapColumn: number;
  flexDirection: Dir;
  flexWrap: Wrap;
  justifyContent: Justify;
  alignItems: Align;
  alignContent: AlignContent;
  alignSelf: Align;
  absolute: boolean;
  position?: [number | undefined, number | undefined, number | undefined, number | undefined];
  aspectRatio?: number;
  /** Constant-ish measurer; applied only to a non-absolute leaf. */
  measure?: { w: number; h: number };
  children: NodeSpec[];
}

// ─── arbitraries ────────────────────────────────────────────────────────

const optInt = (min: number, max: number) =>
  fc.option(fc.integer({ min, max }), { nil: undefined });

const edges = (): fc.Arbitrary<Edges> =>
  fc.tuple(
    fc.integer({ min: 0, max: 5 }),
    fc.integer({ min: 0, max: 5 }),
    fc.integer({ min: 0, max: 5 }),
    fc.integer({ min: 0, max: 5 }),
  );

const baseProps = {
  width: optInt(1, 60),
  height: optInt(1, 60),
  flexBasis: optInt(0, 50),
  flexGrow: fc.integer({ min: 0, max: 3 }),
  flexShrink: fc.integer({ min: 0, max: 3 }),
  minWidth: optInt(0, 40),
  minHeight: optInt(0, 40),
  maxWidth: optInt(1, 60),
  maxHeight: optInt(1, 60),
  padding: fc.option(edges(), { nil: undefined }),
  margin: fc.option(edges(), { nil: undefined }),
  gapRow: fc.integer({ min: 0, max: 6 }),
  gapColumn: fc.integer({ min: 0, max: 6 }),
  flexDirection: fc.constantFrom<Dir>('row', 'column', 'row-reverse', 'column-reverse'),
  flexWrap: fc.constantFrom<Wrap>('nowrap', 'wrap', 'wrap-reverse'),
  justifyContent: fc.constantFrom<Justify>(
    'flex-start',
    'flex-end',
    'center',
    'space-between',
    'space-around',
    'space-evenly',
  ),
  alignItems: fc.constantFrom<Align>('flex-start', 'flex-end', 'center', 'stretch'),
  alignContent: fc.constantFrom<AlignContent>(
    'flex-start',
    'flex-end',
    'center',
    'space-between',
    'space-around',
    'stretch',
  ),
  alignSelf: fc.constantFrom<Align>('auto', 'flex-start', 'flex-end', 'center', 'stretch'),
  // Mostly in-flow; absolute roughly 1-in-5.
  absolute: fc.constantFrom(false, false, false, false, true),
  position: fc.option(fc.tuple(optInt(0, 20), optInt(0, 20), optInt(0, 20), optInt(0, 20)), {
    nil: undefined,
  }),
  aspectRatio: fc.option(fc.constantFrom(0.5, 1, 1.5, 2, 3), { nil: undefined }),
};

const nodeSpecArbitrary: fc.Arbitrary<NodeSpec> = fc.letrec((tie) => ({
  leaf: fc.record({
    ...baseProps,
    measure: fc.option(
      fc.record({ w: fc.integer({ min: 0, max: 50 }), h: fc.integer({ min: 0, max: 40 }) }),
      { nil: undefined },
    ),
    children: fc.constant([] as NodeSpec[]),
  }) as fc.Arbitrary<NodeSpec>,
  node: fc.record({
    ...baseProps,
    // No `measure` key — a non-leaf never carries a measurer, and
    // `exactOptionalPropertyTypes` rejects an explicit `undefined`.
    children: fc.array(
      fc.oneof(
        { depthSize: 'small' },
        tie('leaf') as fc.Arbitrary<NodeSpec>,
        tie('node') as fc.Arbitrary<NodeSpec>,
      ),
      { maxLength: 4 },
    ),
  }) as fc.Arbitrary<NodeSpec>,
})).node;

// ─── tree construction ──────────────────────────────────────────────────

function buildTree(spec: NodeSpec): Node {
  const n = Node.create();
  // 'auto' is the default — only an explicit number needs a setter.
  if (spec.width !== undefined) n.setWidth(spec.width);
  if (spec.height !== undefined) n.setHeight(spec.height);
  if (spec.flexBasis !== undefined) n.setFlexBasis(spec.flexBasis);
  n.setFlexGrow(spec.flexGrow);
  n.setFlexShrink(spec.flexShrink);
  if (spec.minWidth !== undefined) n.setMinWidth(spec.minWidth);
  if (spec.minHeight !== undefined) n.setMinHeight(spec.minHeight);
  if (spec.maxWidth !== undefined) n.setMaxWidth(spec.maxWidth);
  if (spec.maxHeight !== undefined) n.setMaxHeight(spec.maxHeight);
  if (spec.padding !== undefined) {
    n.setPadding(Edge.Top, spec.padding[0]);
    n.setPadding(Edge.Right, spec.padding[1]);
    n.setPadding(Edge.Bottom, spec.padding[2]);
    n.setPadding(Edge.Left, spec.padding[3]);
  }
  if (spec.margin !== undefined) {
    n.setMargin(Edge.Top, spec.margin[0]);
    n.setMargin(Edge.Right, spec.margin[1]);
    n.setMargin(Edge.Bottom, spec.margin[2]);
    n.setMargin(Edge.Left, spec.margin[3]);
  }
  n.setGap('row', spec.gapRow);
  n.setGap('column', spec.gapColumn);
  n.setFlexDirection(spec.flexDirection);
  n.setFlexWrap(spec.flexWrap);
  n.setJustifyContent(spec.justifyContent);
  n.setAlignItems(spec.alignItems);
  n.setAlignContent(spec.alignContent);
  n.setAlignSelf(spec.alignSelf);
  if (spec.absolute) n.setPositionType('absolute');
  if (spec.position !== undefined) {
    const [t, r, b, l] = spec.position;
    if (t !== undefined) n.setPosition(Edge.Top, t);
    if (r !== undefined) n.setPosition(Edge.Right, r);
    if (b !== undefined) n.setPosition(Edge.Bottom, b);
    if (l !== undefined) n.setPosition(Edge.Left, l);
  }
  if (spec.aspectRatio !== undefined) n.setAspectRatio(spec.aspectRatio);

  for (let i = 0; i < spec.children.length; i++) {
    n.insertChild(buildTree(spec.children[i]!), i);
  }

  // A measurer is valid only on a childless node, and the grammar's
  // `emitAbsoluteRules` does not consult one — so an absolute node is
  // excluded (see the file header).
  if (spec.children.length === 0 && spec.measure !== undefined && !spec.absolute) {
    const { w, h } = spec.measure;
    n.setMeasureFunc((cw: number, cwm: MeasureMode, ch: number, chm: MeasureMode) => ({
      width: cwm === 'at-most' ? Math.min(cw, w) : w,
      height: chm === 'at-most' ? Math.min(ch, h) : h,
    }));
  }
  return n;
}

// ─── differential evaluation (mirrors flex-grammar.test.ts) ─────────────

function roundTree(root: Node, floatByNode: Map<Node, Box>): Box[] {
  const out: Box[] = [];
  function visit(
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
      visit(node.getChild(i)!, absX, absY, roundedX, roundedY);
    }
  }
  visit(root, 0, 0, 0, 0);
  return out;
}

function evaluateGrammar(root: Node, available: { width?: number; height?: number }): Box[] {
  const { grammar, allFields } = buildFlexGrammar(root, available);
  const interp = new TopoInterpreter(grammar);
  const floatByNode = new Map<Node, Box>();
  for (const f of allFields) {
    floatByNode.set(f.node, {
      left: interp.evaluate(f.left),
      top: interp.evaluate(f.top),
      width: interp.evaluate(f.width),
      height: interp.evaluate(f.height),
    });
  }
  return roundTree(root, floatByNode);
}

function evaluateImperative(root: Node, available: { width?: number; height?: number }): Box[] {
  root.calculateLayout(available.width, available.height);
  const out: Box[] = [];
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

// ─── the property ───────────────────────────────────────────────────────

describe('flex grammar differential fuzzer (phase 7, v17)', () => {
  it('evaluateGrammar matches evaluateImperative for random feature combinations', () => {
    fc.assert(
      fc.property(
        nodeSpecArbitrary,
        optInt(20, 200),
        optInt(10, 120),
        (treeSpec, availW, availH) => {
          // Build with only the defined axes present —
          // `exactOptionalPropertyTypes` rejects explicit `undefined`.
          const available: { width?: number; height?: number } = {};
          if (availW !== undefined) available.width = availW;
          if (availH !== undefined) available.height = availH;
          const grammarOut = evaluateGrammar(buildTree(treeSpec), available);
          const imperativeOut = evaluateImperative(buildTree(treeSpec), available);
          expect(grammarOut).toEqual(imperativeOut);
        },
      ),
      { numRuns: 500 },
    );
  });
});
