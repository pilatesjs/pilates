/**
 * Structural differential fuzzer (phase 11, v33): the
 * `SpinelessLayout` driver's structural fast-paths.
 *
 * The v17 grammar fuzzer validates random STATIC trees; the v18
 * runtime fuzzer validates random VALUE mutation sequences at the
 * runtime level. Neither exercises the driver's `tryGraftAppend` /
 * `tryDetachRemove` classifier, fragment application, or the
 * structural-then-value interaction.
 *
 * This fuzzer builds a random tree, then applies a random sequence of
 * INSERT / REMOVE / MOVE / value mutations — each driven through a
 * persistent `SpinelessLayout` — and after every step asserts the
 * incrementally-driven layout is byte-identical to a COLD
 * `SpinelessLayout` of the same tree.
 *
 * Incremental-vs-cold (not vs imperative) is deliberate: two runs of
 * the same engine round the same floats, so the comparison is exact
 * with no `x.5`-boundary noise — and "do the structural fast-paths
 * drift from a cold rebuild?" is precisely the property under test.
 * Spineless-vs-imperative correctness for any tree is the grammar
 * fuzzer's job.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Edge } from '../../edge.js';
import type { MeasureMode } from '../../measure-func.js';
import { Node } from '../../node.js';
import { SpinelessLayout } from './layout.js';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
}

type Dir = 'row' | 'column' | 'row-reverse' | 'column-reverse';
type Wrap = 'nowrap' | 'wrap' | 'wrap-reverse';
type Align = 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch';
type Edges = [number, number, number, number];

interface NodeSpec {
  width?: number;
  height?: number;
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
  alignItems: Align;
  alignSelf: Align;
  aspectRatio?: number;
  absolute: boolean;
  hidden: boolean;
  measure?: { w: number; h: number };
  children: NodeSpec[];
}

// ─── tree arbitrary ─────────────────────────────────────────────────────

const optInt = (min: number, max: number) =>
  fc.option(fc.integer({ min, max }), { nil: undefined });

// width / height numeric ~80% of the time so value mutations on a
// size mostly land in-regime.
const sizeArb = fc.oneof(
  fc.integer({ min: 1, max: 60 }),
  fc.integer({ min: 1, max: 60 }),
  fc.integer({ min: 1, max: 60 }),
  fc.integer({ min: 1, max: 60 }),
  fc.constant(undefined),
);

const edges = (): fc.Arbitrary<Edges> =>
  fc.tuple(
    fc.integer({ min: 0, max: 4 }),
    fc.integer({ min: 0, max: 4 }),
    fc.integer({ min: 0, max: 4 }),
    fc.integer({ min: 0, max: 4 }),
  );

const baseProps = {
  width: sizeArb,
  height: sizeArb,
  flexGrow: fc.integer({ min: 0, max: 3 }),
  flexShrink: fc.integer({ min: 0, max: 3 }),
  minWidth: optInt(0, 30),
  minHeight: optInt(0, 30),
  maxWidth: optInt(1, 60),
  maxHeight: optInt(1, 60),
  padding: fc.option(edges(), { nil: undefined }),
  margin: fc.option(edges(), { nil: undefined }),
  gapRow: fc.integer({ min: 0, max: 5 }),
  gapColumn: fc.integer({ min: 0, max: 5 }),
  flexDirection: fc.constantFrom<Dir>('row', 'column', 'row-reverse', 'column-reverse'),
  flexWrap: fc.constantFrom<Wrap>('nowrap', 'wrap', 'wrap-reverse'),
  alignItems: fc.constantFrom<Align>('flex-start', 'flex-end', 'center', 'stretch'),
  alignSelf: fc.constantFrom<Align>('auto', 'flex-start', 'flex-end', 'center', 'stretch'),
  aspectRatio: fc.option(fc.constantFrom(0.5, 1, 2), { nil: undefined }),
  // Mostly in-flow; absolute ~1-in-5, `display: 'none'` ~1-in-6.
  absolute: fc.constantFrom(false, false, false, false, true),
  hidden: fc.constantFrom(false, false, false, false, false, true),
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

function buildTree(spec: NodeSpec): Node {
  const n = Node.create();
  if (spec.width !== undefined) n.setWidth(spec.width);
  if (spec.height !== undefined) n.setHeight(spec.height);
  n.setFlexGrow(spec.flexGrow);
  n.setFlexShrink(spec.flexShrink);
  if (spec.minWidth !== undefined) n.setMinWidth(spec.minWidth);
  if (spec.minHeight !== undefined) n.setMinHeight(spec.minHeight);
  if (spec.maxWidth !== undefined) n.setMaxWidth(spec.maxWidth);
  if (spec.maxHeight !== undefined) n.setMaxHeight(spec.maxHeight);
  if (spec.padding !== undefined) {
    for (let e = 0; e < 4; e++) n.setPadding(e as Edge, spec.padding[e]!);
  }
  if (spec.margin !== undefined) {
    for (let e = 0; e < 4; e++) n.setMargin(e as Edge, spec.margin[e]!);
  }
  n.setGap('row', spec.gapRow);
  n.setGap('column', spec.gapColumn);
  n.setFlexDirection(spec.flexDirection);
  n.setFlexWrap(spec.flexWrap);
  n.setAlignItems(spec.alignItems);
  n.setAlignSelf(spec.alignSelf);
  if (spec.aspectRatio !== undefined) n.setAspectRatio(spec.aspectRatio);
  if (spec.absolute) n.setPositionType('absolute');
  if (spec.hidden) n.setDisplay('none');
  for (let i = 0; i < spec.children.length; i++) {
    n.insertChild(buildTree(spec.children[i]!), i);
  }
  if (spec.children.length === 0 && spec.measure !== undefined) {
    const { w, h } = spec.measure;
    n.setMeasureFunc((cw: number, cwm: MeasureMode, ch: number, chm: MeasureMode) => ({
      width: cwm === 'at-most' ? Math.min(cw, w) : w,
      height: chm === 'at-most' ? Math.min(ch, h) : h,
    }));
  }
  return n;
}

// ─── mutations ──────────────────────────────────────────────────────────

type ScalarKind =
  | 'width'
  | 'height'
  | 'minWidth'
  | 'minHeight'
  | 'maxWidth'
  | 'maxHeight'
  | 'gapRow'
  | 'gapColumn';

type Mutation =
  | { kind: 'insert'; path: number[]; index: number; subtree: NodeSpec }
  | { kind: 'remove'; path: number[]; index: number }
  | { kind: 'move'; path: number[]; from: number; to: number }
  | { kind: ScalarKind; path: number[]; value: number }
  | { kind: 'padding' | 'margin'; path: number[]; edge: number; value: number };

const path = () => fc.array(fc.nat({ max: 3 }), { maxLength: 4 });

const mutationArbitrary: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({
    kind: fc.constant<'insert'>('insert'),
    path: path(),
    index: fc.nat({ max: 5 }),
    subtree: nodeSpecArbitrary,
  }),
  fc.record({ kind: fc.constant<'remove'>('remove'), path: path(), index: fc.nat({ max: 5 }) }),
  fc.record({
    kind: fc.constant<'move'>('move'),
    path: path(),
    from: fc.nat({ max: 5 }),
    to: fc.nat({ max: 5 }),
  }),
  fc.record({
    kind: fc.constantFrom<ScalarKind>(
      'width',
      'height',
      'minWidth',
      'minHeight',
      'maxWidth',
      'maxHeight',
      'gapRow',
      'gapColumn',
    ),
    path: path(),
    value: fc.integer({ min: 0, max: 60 }),
  }),
  fc.record({
    kind: fc.constantFrom<'padding' | 'margin'>('padding', 'margin'),
    path: path(),
    edge: fc.nat({ max: 3 }),
    value: fc.integer({ min: 0, max: 5 }),
  }),
);

/** Walk `p` as child indices (mod the live child count). */
function followPath(root: Node, p: number[]): Node {
  let n = root;
  for (const idx of p) {
    if (n.getChildCount() === 0) return n;
    n = n.getChild(idx % n.getChildCount())!;
  }
  return n;
}

/** Apply one mutation to a tree. The same `Mutation` data drives both
 *  the incremental and the cold tree, so they stay structurally
 *  identical. A no-op (e.g. remove on a childless node) is applied to
 *  both — and is itself a useful relayout case. */
function applyMutation(root: Node, m: Mutation): void {
  const t = followPath(root, m.path);
  switch (m.kind) {
    case 'insert':
      // A measure leaf cannot take children — skip (on both trees).
      if (t.getMeasureFunc() !== null) return;
      t.insertChild(buildTree(m.subtree), Math.min(m.index, t.getChildCount()));
      return;
    case 'remove': {
      const cc = t.getChildCount();
      if (cc > 0) t.removeChild(t.getChild(m.index % cc)!);
      return;
    }
    case 'move': {
      const cc = t.getChildCount();
      if (cc < 2) return;
      const child = t.getChild(m.from % cc)!;
      t.removeChild(child);
      t.insertChild(child, Math.min(m.to, t.getChildCount()));
      return;
    }
    case 'width':
      t.setWidth(m.value);
      return;
    case 'height':
      t.setHeight(m.value);
      return;
    case 'minWidth':
      t.setMinWidth(m.value);
      return;
    case 'minHeight':
      t.setMinHeight(m.value);
      return;
    case 'maxWidth':
      t.setMaxWidth(m.value);
      return;
    case 'maxHeight':
      t.setMaxHeight(m.value);
      return;
    case 'gapRow':
      t.setGap('row', m.value);
      return;
    case 'gapColumn':
      t.setGap('column', m.value);
      return;
    case 'padding':
      t.setPadding(m.edge as Edge, m.value);
      return;
    case 'margin':
      t.setMargin(m.edge as Edge, m.value);
      return;
  }
}

/** Pre-order dump of every node's computed (rounded) layout. */
function snapshot(root: Node): Box[] {
  const out: Box[] = [];
  function visit(n: Node): void {
    const l = n.layout;
    out.push({
      left: l.left,
      top: l.top,
      width: l.width,
      height: l.height,
      scrollWidth: l.scrollWidth,
      scrollHeight: l.scrollHeight,
    });
    for (let i = 0; i < n.getChildCount(); i++) visit(n.getChild(i)!);
  }
  visit(root);
  return out;
}

// ─── the property ───────────────────────────────────────────────────────

describe('SpinelessLayout structural fuzzer (phase 11, v33)', () => {
  it('an incremental insert / remove / move / value sequence matches a cold rebuild', () => {
    fc.assert(
      fc.property(
        nodeSpecArbitrary,
        fc.array(mutationArbitrary, { minLength: 1, maxLength: 12 }),
        optInt(20, 200),
        optInt(10, 120),
        (treeSpec, mutations, availW, availH) => {
          // Tree A is driven incrementally by one persistent driver;
          // tree B is laid out cold by a fresh driver each step.
          const incremental = buildTree(treeSpec);
          const cold = buildTree(treeSpec);
          const sl = new SpinelessLayout(incremental);

          sl.layout(availW, availH);
          new SpinelessLayout(cold).layout(availW, availH);
          expect(snapshot(incremental)).toEqual(snapshot(cold));

          for (const m of mutations) {
            applyMutation(incremental, m);
            applyMutation(cold, m);
            sl.layout(availW, availH);
            new SpinelessLayout(cold).layout(availW, availH);
            expect(snapshot(incremental)).toEqual(snapshot(cold));
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
