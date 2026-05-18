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
 * For each generated tree the property asserts the grammar's FLOAT
 * layout matches the imperative's within a small tolerance. It does
 * NOT compare rounded integer cells: the grammar and the imperative
 * reach the same layout by different floating-point operation
 * orders, so a value on an exact `x.5` cell boundary can round in
 * opposite directions purely from sub-ULP noise. Byte-identical
 * rounding is covered by the curated `flex-grammar.test.ts` corpus;
 * this fuzzer's job is the grammar's *layout* correctness. Any
 * divergence should be reproduced from its `fast-check` seed and
 * pinned as a deterministic regression test in `flex-grammar.test.ts`.
 *
 * Coverage note: `display: 'none'` is generated as of phase 10 v29 —
 * a hidden node is emitted no rules and skipped in its parent's flow,
 * so the float-layout walks below skip hidden subtrees on both sides.
 * A measure function on an `'absolute'` node is generated as of v30 —
 * `emitAbsoluteRules` now consults the measurer. The grammar covers
 * the whole feature surface; nothing is deliberately excluded.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Edge } from '../../edge.js';
import type { MeasureMode } from '../../measure-func.js';
import { Node } from '../../node.js';
import { layoutChildren, resolveRootAxisSize } from '../main-axis.js';
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
  hidden: boolean;
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
  // Mostly visible; `display: 'none'` roughly 1-in-6.
  hidden: fc.constantFrom(false, false, false, false, false, true),
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
  if (spec.hidden) n.setDisplay('none');
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

  // A measurer is valid only on a childless node. As of v30 the
  // grammar consults the measurer for an absolute leaf too, so an
  // absolute node is no longer excluded.
  if (spec.children.length === 0 && spec.measure !== undefined) {
    const { w, h } = spec.measure;
    n.setMeasureFunc((cw: number, cwm: MeasureMode, ch: number, chm: MeasureMode) => ({
      width: cwm === 'at-most' ? Math.min(cw, w) : w,
      height: chm === 'at-most' ? Math.min(ch, h) : h,
    }));
  }
  return n;
}

// ─── differential evaluation ────────────────────────────────────────────
//
// The fuzzer compares the FLOAT layouts (pre-rounding) within a small
// tolerance, not the rounded integer cells. The grammar and the
// imperative reach the same layout by different floating-point
// operation orders, so a value sitting exactly on an `x.5` cell
// boundary can round in opposite directions purely from sub-ULP
// noise — not a layout bug. Integer-cell rounding (`round.ts`) is
// deterministic shared code, covered byte-identically by the curated
// `flex-grammar.test.ts` corpus; here we assert the grammar computes
// the same *layout*, leaving rounding out of the comparison.

/** Per-node float layout, in pre-order. */
function grammarFloats(root: Node, available: { width?: number; height?: number }): Box[] {
  const { grammar, allFields } = buildFlexGrammar(root, available);
  const interp = new TopoInterpreter(grammar);
  const byNode = new Map<Node, Box>();
  for (const f of allFields) {
    byNode.set(f.node, {
      left: interp.evaluate(f.left),
      top: interp.evaluate(f.top),
      width: interp.evaluate(f.width),
      height: interp.evaluate(f.height),
    });
  }
  const out: Box[] = [];
  function visit(n: Node): void {
    // A `display: 'none'` subtree is emitted no fields — skip it on
    // both sides so the two float walks stay shape-aligned.
    if (n.style.display === 'none') return;
    out.push(byNode.get(n)!);
    for (let i = 0; i < n.getChildCount(); i++) visit(n.getChild(i)!);
  }
  visit(root);
  return out;
}

/**
 * The imperative float layout — `resolveRootAxisSize` + `layoutChildren`
 * with no `roundLayout` pass, so `_layout` holds the raw float result.
 */
function imperativeFloats(root: Node, available: { width?: number; height?: number }): Box[] {
  root._layout.left = 0;
  root._layout.top = 0;
  root._layout.width = resolveRootAxisSize(root, 'row', available.width);
  root._layout.height = resolveRootAxisSize(root, 'column', available.height);
  layoutChildren(root);
  const out: Box[] = [];
  function visit(n: Node): void {
    if (n.style.display === 'none') return;
    out.push({
      left: n._layout.left,
      top: n._layout.top,
      width: n._layout.width,
      height: n._layout.height,
    });
    for (let i = 0; i < n.getChildCount(); i++) visit(n.getChild(i)!);
  }
  visit(root);
  return out;
}

const EPSILON = 1e-6;

function expectClose(grammar: Box[], imperative: Box[]): void {
  expect(grammar.length).toBe(imperative.length);
  for (let i = 0; i < grammar.length; i++) {
    const g = grammar[i]!;
    const m = imperative[i]!;
    for (const k of ['left', 'top', 'width', 'height'] as const) {
      if (Math.abs(g[k] - m[k]) >= EPSILON) {
        // Surface the full pair on failure for a legible counterexample.
        expect(grammar).toEqual(imperative);
      }
    }
  }
}

// ─── the property ───────────────────────────────────────────────────────

describe('flex grammar differential fuzzer (phase 7, v17)', () => {
  it('grammar layout matches the imperative for random feature combinations', () => {
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
          expectClose(
            grammarFloats(buildTree(treeSpec), available),
            imperativeFloats(buildTree(treeSpec), available),
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});
