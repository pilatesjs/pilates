/**
 * Incremental differential fuzzer (phase 7, v18): the
 * `SpinelessRuntime` incremental path vs the imperative
 * `calculateLayout`.
 *
 * v17 (`flex-grammar.fuzz.test.ts`) validated the grammar STATICALLY.
 * This file validates INCREMENTALITY: build a runtime for a random
 * tree, then apply a random sequence of value mutations — each
 * driven through `markStyleDirty` + `recompute()` — and assert the
 * runtime's float layout stays in step (within tolerance) with a
 * fresh imperative pass after every step. See `flex-grammar.fuzz.test.ts`
 * for why the comparison is float-with-tolerance, not rounded cells.
 *
 * Only VALUE mutations are generated: `setWidth` / `setHeight` (on an
 * already-numeric axis — an `'auto'` → numeric flip is structural),
 * `setMin*` / `setMax*`, `setGap`, `setPadding`, `setMargin`. Flex
 * weights, `flexBasis`, direction / wrap / align and `positionType`
 * can reshape the dependency graph and need a fresh
 * `buildFlexGrammar()`, so they are left to the static fuzzer.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Edge } from '../../edge.js';
import type { MeasureMode } from '../../measure-func.js';
import { Node } from '../../node.js';
import { layoutChildren, resolveRootAxisSize } from '../main-axis.js';
import { buildFlexGrammar } from './flex-grammar.js';
import type { Field } from './grammar.js';
import { SpinelessRuntime } from './runtime.js';
import { createStyleDirtier } from './style-dirty.js';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
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
  measure?: { w: number; h: number };
  children: NodeSpec[];
}

// ─── tree arbitrary ─────────────────────────────────────────────────────

const optInt = (min: number, max: number) =>
  fc.option(fc.integer({ min, max }), { nil: undefined });

// width / height numeric ~80% of the time so `setWidth` / `setHeight`
// mutations mostly land in-regime.
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
  absolute: fc.constantFrom(false, false, false, false, true),
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
  for (let i = 0; i < spec.children.length; i++) {
    n.insertChild(buildTree(spec.children[i]!), i);
  }
  if (spec.children.length === 0 && spec.measure !== undefined && !spec.absolute) {
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
  | { kind: ScalarKind; path: number[]; value: number }
  | { kind: 'padding' | 'margin'; path: number[]; edge: number; value: number };

const path = () => fc.array(fc.nat({ max: 3 }), { maxLength: 4 });

const mutationArbitrary: fc.Arbitrary<Mutation> = fc.oneof(
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

function followPath(root: Node, p: number[]): Node {
  let n = root;
  for (const idx of p) {
    if (n.getChildCount() === 0) return n;
    n = n.getChild(idx % n.getChildCount())!;
  }
  return n;
}

type StyleDirtier = ReturnType<typeof createStyleDirtier>;

/**
 * Apply one value mutation and mark the affected input Field dirty.
 * A `setWidth` / `setHeight` on a currently-`'auto'` axis is an
 * `'auto'` → numeric flip — structural — so it is skipped entirely
 * (the imperative tree is left untouched too, keeping the two sides
 * in step).
 */
function applyMutation(root: Node, m: Mutation, markStyleDirty: StyleDirtier): void {
  const t = followPath(root, m.path);
  switch (m.kind) {
    case 'width':
      if (typeof t.style.width !== 'number') return;
      t.setWidth(m.value);
      markStyleDirty(t, 'width');
      return;
    case 'height':
      if (typeof t.style.height !== 'number') return;
      t.setHeight(m.value);
      markStyleDirty(t, 'height');
      return;
    case 'minWidth':
      t.setMinWidth(m.value);
      markStyleDirty(t, 'minWidth');
      return;
    case 'minHeight':
      t.setMinHeight(m.value);
      markStyleDirty(t, 'minHeight');
      return;
    case 'maxWidth':
      t.setMaxWidth(m.value);
      markStyleDirty(t, 'maxWidth');
      return;
    case 'maxHeight':
      t.setMaxHeight(m.value);
      markStyleDirty(t, 'maxHeight');
      return;
    case 'gapRow':
      t.setGap('row', m.value);
      markStyleDirty(t, 'gapRow');
      return;
    case 'gapColumn':
      t.setGap('column', m.value);
      markStyleDirty(t, 'gapColumn');
      return;
    case 'padding':
      t.setPadding(m.edge as Edge, m.value);
      markStyleDirty(t, 'padding', m.edge);
      return;
    case 'margin':
      t.setMargin(m.edge as Edge, m.value);
      markStyleDirty(t, 'margin', m.edge);
      return;
  }
}

// ─── differential evaluation ────────────────────────────────────────────
//
// FLOAT layouts compared within a small tolerance — see the header of
// `flex-grammar.fuzz.test.ts` for why rounded integer cells are not
// the comparison surface (sub-ULP noise on an exact `x.5` boundary).

/**
 * The imperative float layout — `resolveRootAxisSize` + `layoutChildren`
 * with no `roundLayout` pass, so `_layout` holds the raw float result.
 * Re-runs from scratch (no cache), so it is correct after a mutation.
 */
function imperativeFloats(root: Node, available: { width?: number; height?: number }): Box[] {
  root._layout.left = 0;
  root._layout.top = 0;
  root._layout.width = resolveRootAxisSize(root, 'row', available.width);
  root._layout.height = resolveRootAxisSize(root, 'column', available.height);
  layoutChildren(root);
  const out: Box[] = [];
  function visit(n: Node): void {
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

function expectClose(runtime: Box[], imperative: Box[]): void {
  expect(runtime.length).toBe(imperative.length);
  for (let i = 0; i < runtime.length; i++) {
    const r = runtime[i]!;
    const m = imperative[i]!;
    for (const k of ['left', 'top', 'width', 'height'] as const) {
      if (Math.abs(r[k] - m[k]) >= EPSILON) {
        expect(runtime).toEqual(imperative);
      }
    }
  }
}

// ─── the property ───────────────────────────────────────────────────────

describe('SpinelessRuntime incremental fuzzer (phase 7, v18)', () => {
  it('recompute() after random value mutations stays in step with the imperative', () => {
    fc.assert(
      fc.property(
        nodeSpecArbitrary,
        fc.array(mutationArbitrary, { minLength: 1, maxLength: 15 }),
        optInt(20, 200),
        optInt(10, 120),
        (treeSpec, mutations, availW, availH) => {
          const available: { width?: number; height?: number } = {};
          if (availW !== undefined) available.width = availW;
          if (availH !== undefined) available.height = availH;

          const root = buildTree(treeSpec);
          const { grammar, allFields, styleInputs } = buildFlexGrammar(root, available);
          const rootFields: Field<unknown>[] = [];
          for (const f of allFields) {
            rootFields.push(f.width, f.height, f.left, f.top);
          }
          const rt = new SpinelessRuntime(grammar, rootFields);
          rt.init();
          const markStyleDirty = createStyleDirtier(rt, styleInputs);

          const readRuntime = (): Box[] => {
            const byNode = new Map<Node, Box>();
            for (const f of allFields) {
              byNode.set(f.node, {
                left: rt.evaluate(f.left),
                top: rt.evaluate(f.top),
                width: rt.evaluate(f.width),
                height: rt.evaluate(f.height),
              });
            }
            const out: Box[] = [];
            function visit(n: Node): void {
              out.push(byNode.get(n)!);
              for (let i = 0; i < n.getChildCount(); i++) visit(n.getChild(i)!);
            }
            visit(root);
            return out;
          };

          // Baseline: the freshly-init'd runtime matches the imperative.
          expectClose(readRuntime(), imperativeFloats(root, available));

          // Then each mutation, driven incrementally, keeps matching.
          for (const m of mutations) {
            applyMutation(root, m, markStyleDirty);
            rt.recompute();
            expectClose(readRuntime(), imperativeFloats(root, available));
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
