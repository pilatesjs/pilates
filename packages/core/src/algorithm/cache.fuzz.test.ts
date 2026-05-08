import fc from 'fast-check';
import { describe, it } from 'vitest';
import { Edge } from '../edge.js';
import { Node } from '../node.js';
import { clearAllCaches, diffLayouts, markDirtyDeep, snapshotTreeLayouts } from './cache.js';

interface NodeSpec {
  width?: number;
  height?: number;
  flexGrow?: number;
  flexShrink?: number;
  padding?: number;
  margin?: number;
  flexDirection: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  children: NodeSpec[];
}

const baseNodeProps = {
  width: fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined }),
  height: fc.option(fc.integer({ min: 1, max: 30 }), { nil: undefined }),
  flexGrow: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
  flexShrink: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
  padding: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
  margin: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
  flexDirection: fc.constantFrom('row', 'column', 'row-reverse', 'column-reverse') as fc.Arbitrary<
    NodeSpec['flexDirection']
  >,
};

const nodeSpecArbitrary: fc.Arbitrary<NodeSpec> = fc.letrec((tie) => ({
  leaf: fc.record({
    ...baseNodeProps,
    children: fc.constant([] as NodeSpec[]),
  }) as fc.Arbitrary<NodeSpec>,
  node: fc.record({
    ...baseNodeProps,
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

type Mutation =
  | { type: 'setWidth'; path: number[]; value: number }
  | { type: 'setHeight'; path: number[]; value: number }
  | { type: 'setFlexGrow'; path: number[]; value: number }
  | { type: 'setPadding'; path: number[]; value: number };

const mutationArbitrary: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({
    type: fc.constant('setWidth' as const),
    path: fc.array(fc.nat({ max: 3 }), { maxLength: 4 }),
    value: fc.integer({ min: 1, max: 50 }),
  }),
  fc.record({
    type: fc.constant('setHeight' as const),
    path: fc.array(fc.nat({ max: 3 }), { maxLength: 4 }),
    value: fc.integer({ min: 1, max: 30 }),
  }),
  fc.record({
    type: fc.constant('setFlexGrow' as const),
    path: fc.array(fc.nat({ max: 3 }), { maxLength: 4 }),
    value: fc.integer({ min: 0, max: 3 }),
  }),
  fc.record({
    type: fc.constant('setPadding' as const),
    path: fc.array(fc.nat({ max: 3 }), { maxLength: 4 }),
    value: fc.integer({ min: 0, max: 3 }),
  }),
);

function buildTree(spec: NodeSpec): Node {
  const n = Node.create();
  if (spec.width !== undefined) n.setWidth(spec.width);
  if (spec.height !== undefined) n.setHeight(spec.height);
  if (spec.flexGrow !== undefined) n.setFlexGrow(spec.flexGrow);
  if (spec.flexShrink !== undefined) n.setFlexShrink(spec.flexShrink);
  if (spec.padding !== undefined) n.setPadding(Edge.All, spec.padding);
  if (spec.margin !== undefined) n.setMargin(Edge.All, spec.margin);
  n.setFlexDirection(spec.flexDirection);
  for (let i = 0; i < spec.children.length; i++) {
    const child = buildTree(spec.children[i]!);
    n.insertChild(child, i);
  }
  return n;
}

function followPath(root: Node, path: number[]): Node {
  let n = root;
  for (const idx of path) {
    if (n.getChildCount() === 0) return n;
    n = n.getChild(idx % n.getChildCount())!;
  }
  return n;
}

function applyMutation(root: Node, m: Mutation): void {
  const target = followPath(root, m.path);
  switch (m.type) {
    case 'setWidth':
      target.setWidth(m.value);
      break;
    case 'setHeight':
      target.setHeight(m.value);
      break;
    case 'setFlexGrow':
      target.setFlexGrow(m.value);
      break;
    case 'setPadding':
      target.setPadding(Edge.All, m.value);
      break;
  }
}

describe('cache correctness fuzzer', () => {
  it('cached layout matches fresh-recompute layout after random mutation sequences', () => {
    fc.assert(
      fc.property(
        nodeSpecArbitrary,
        fc.array(mutationArbitrary, { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 20, max: 200 }),
        fc.integer({ min: 10, max: 80 }),
        (treeSpec, mutations, rootW, rootH) => {
          const root = buildTree(treeSpec);
          root.calculateLayout(rootW, rootH); // primes caches

          for (const m of mutations) {
            applyMutation(root, m);

            // Cached path
            root.calculateLayout(rootW, rootH);
            const cachedSnap = snapshotTreeLayouts(root);

            // Cold path: clear all caches, mark every node dirty, relayout
            clearAllCaches(root);
            markDirtyDeep(root);
            root.calculateLayout(rootW, rootH);
            const coldSnap = snapshotTreeLayouts(root);

            const diff = diffLayouts(cachedSnap, coldSnap);
            if (diff !== '') {
              throw new Error(`mutation produced cache divergence: ${diff}`);
            }
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
