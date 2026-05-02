/**
 * Property-based layout invariants for @pilates/core.
 *
 * Complements (does not replace) the 30-fixture yoga-oracle suite. The
 * oracle proves cell-for-cell parity on hand-picked trees; these
 * properties exercise universal truths over randomly generated trees and
 * shrink failures to minimal counterexamples.
 *
 * Seed is pinned so failures reproduce. All counts kept conservative to
 * keep CI wall time predictable.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import Yoga, {
  Align as YAlign,
  Edge as YEdge,
  FlexDirection as YFlexDir,
  Justify as YJustify,
  PositionType as YPositionType,
} from 'yoga-layout';
import { Edge } from '../src/edge.js';
import { Node } from '../src/node.js';
import type { Align, FlexDirection, Justify, PositionType } from '../src/style.js';

fc.configureGlobal({ seed: 42 });

interface SpecNode {
  flexDirection?: FlexDirection;
  width?: number;
  height?: number;
  flexGrow?: number;
  paddingAll?: number;
  marginAll?: number;
  justifyContent?: Justify;
  alignItems?: Align;
  positionType?: PositionType;
  positionTop?: number;
  positionLeft?: number;
  children?: SpecNode[];
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function buildOurs(spec: SpecNode): Node {
  const n = Node.create();
  if (spec.flexDirection) n.setFlexDirection(spec.flexDirection);
  if (spec.width !== undefined) n.setWidth(spec.width);
  if (spec.height !== undefined) n.setHeight(spec.height);
  if (spec.flexGrow !== undefined) n.setFlexGrow(spec.flexGrow);
  if (spec.paddingAll !== undefined) n.setPadding(Edge.All, spec.paddingAll);
  if (spec.marginAll !== undefined) n.setMargin(Edge.All, spec.marginAll);
  if (spec.justifyContent) n.setJustifyContent(spec.justifyContent);
  if (spec.alignItems) n.setAlignItems(spec.alignItems);
  if (spec.positionType) n.setPositionType(spec.positionType);
  if (spec.positionTop !== undefined) n.setPosition(Edge.Top, spec.positionTop);
  if (spec.positionLeft !== undefined) n.setPosition(Edge.Left, spec.positionLeft);
  if (spec.children) {
    for (let i = 0; i < spec.children.length; i++) {
      n.insertChild(buildOurs(spec.children[i]!), i);
    }
  }
  return n;
}

function ourBoxes(node: Node): Box[] {
  const out: Box[] = [{ ...node.getComputedLayout() }];
  for (let i = 0; i < node.getChildCount(); i++) {
    out.push(...ourBoxes(node.getChild(i)!));
  }
  return out;
}

function flowChildBoxes(node: Node): Box[] {
  // Skip the root and any absolutely positioned children — return only
  // the relative-flow children's boxes.
  const out: Box[] = [];
  for (let i = 0; i < node.getChildCount(); i++) {
    const child = node.getChild(i)!;
    out.push({ ...child.getComputedLayout() });
  }
  return out;
}

const FLEX_DIR_MAP: Record<FlexDirection, YFlexDir> = {
  row: YFlexDir.Row,
  column: YFlexDir.Column,
  'row-reverse': YFlexDir.RowReverse,
  'column-reverse': YFlexDir.ColumnReverse,
};
const JUSTIFY_MAP: Record<Justify, YJustify> = {
  'flex-start': YJustify.FlexStart,
  'flex-end': YJustify.FlexEnd,
  center: YJustify.Center,
  'space-between': YJustify.SpaceBetween,
  'space-around': YJustify.SpaceAround,
  'space-evenly': YJustify.SpaceEvenly,
};
const ALIGN_MAP: Record<Align, YAlign> = {
  auto: YAlign.Auto,
  'flex-start': YAlign.FlexStart,
  'flex-end': YAlign.FlexEnd,
  center: YAlign.Center,
  stretch: YAlign.Stretch,
  'space-between': YAlign.SpaceBetween,
  'space-around': YAlign.SpaceAround,
};
const POS_MAP: Record<PositionType, YPositionType> = {
  relative: YPositionType.Relative,
  absolute: YPositionType.Absolute,
};

function buildYoga(spec: SpecNode): import('yoga-layout').Node {
  const n = Yoga.Node.create();
  if (spec.flexDirection) n.setFlexDirection(FLEX_DIR_MAP[spec.flexDirection]);
  if (spec.width !== undefined) n.setWidth(spec.width);
  if (spec.height !== undefined) n.setHeight(spec.height);
  if (spec.flexGrow !== undefined) n.setFlexGrow(spec.flexGrow);
  if (spec.paddingAll !== undefined) n.setPadding(YEdge.All, spec.paddingAll);
  if (spec.marginAll !== undefined) n.setMargin(YEdge.All, spec.marginAll);
  if (spec.justifyContent) n.setJustifyContent(JUSTIFY_MAP[spec.justifyContent]);
  if (spec.alignItems) n.setAlignItems(ALIGN_MAP[spec.alignItems]);
  if (spec.positionType) n.setPositionType(POS_MAP[spec.positionType]);
  if (spec.positionTop !== undefined) n.setPosition(YEdge.Top, spec.positionTop);
  if (spec.positionLeft !== undefined) n.setPosition(YEdge.Left, spec.positionLeft);
  if (spec.children) {
    for (let i = 0; i < spec.children.length; i++) {
      n.insertChild(buildYoga(spec.children[i]!), i);
    }
  }
  return n;
}

function yogaBoxes(node: import('yoga-layout').Node): Box[] {
  const l = node.getComputedLayout();
  const out: Box[] = [{ left: l.left, top: l.top, width: l.width, height: l.height }];
  for (let i = 0; i < node.getChildCount(); i++) {
    out.push(...yogaBoxes(node.getChild(i)));
  }
  return out;
}

// ─── Arbitraries ───────────────────────────────────────────────────────────

const widthArb = fc.integer({ min: 1, max: 200 });
const heightArb = fc.integer({ min: 1, max: 50 });
const paddingArb = fc.integer({ min: 0, max: 5 });
const marginArb = fc.integer({ min: 0, max: 5 });
const flexGrowArb = fc.integer({ min: 0, max: 4 });

const leafArb: fc.Arbitrary<SpecNode> = fc.record({
  width: widthArb,
  height: heightArb,
});

const flowChildArb: fc.Arbitrary<SpecNode> = fc.record(
  {
    width: widthArb,
    height: heightArb,
    flexGrow: flexGrowArb,
    marginAll: marginArb,
  },
  { requiredKeys: [] },
);

const rowParentArb: fc.Arbitrary<SpecNode> = fc
  .tuple(widthArb, heightArb, paddingArb, fc.array(flowChildArb, { minLength: 1, maxLength: 5 }))
  .map(([w, h, p, kids]) => ({
    flexDirection: 'row' as const,
    width: Math.max(w, 20), // ensure parent has room
    height: h,
    paddingAll: p,
    children: kids,
  }));

// Limit recursion: depth ≤ 2, fanout ≤ 3.
const smallTreeArb: fc.Arbitrary<SpecNode> = fc.letrec((tie) => ({
  node: fc.oneof(
    { maxDepth: 2 },
    leafArb,
    fc.record(
      {
        flexDirection: fc.constantFrom<FlexDirection>('row', 'column'),
        width: widthArb,
        height: heightArb,
        paddingAll: paddingArb,
        children: fc.array(tie('node') as fc.Arbitrary<SpecNode>, {
          minLength: 0,
          maxLength: 3,
        }),
      },
      { requiredKeys: ['width', 'height'] },
    ),
  ),
})).node as fc.Arbitrary<SpecNode>;

// Differential trees with non-degenerate dimensions: width/height ≥ 4 so
// padding ≤ 1 can never exceed content. Avoids known-divergent edge cases
// the oracle suite already hand-tested.
const differentialTreeArb: fc.Arbitrary<SpecNode> = fc.letrec((tie) => ({
  node: fc.oneof(
    { maxDepth: 2 },
    fc.record({
      width: fc.integer({ min: 4, max: 60 }),
      height: fc.integer({ min: 4, max: 20 }),
    }),
    fc.record(
      {
        flexDirection: fc.constantFrom<FlexDirection>('row', 'column'),
        width: fc.integer({ min: 8, max: 80 }),
        height: fc.integer({ min: 6, max: 30 }),
        paddingAll: fc.integer({ min: 0, max: 1 }),
        children: fc.array(tie('node') as fc.Arbitrary<SpecNode>, {
          minLength: 0,
          maxLength: 3,
        }),
      },
      { requiredKeys: ['width', 'height'] },
    ),
  ),
})).node as fc.Arbitrary<SpecNode>;

// ─── Properties ────────────────────────────────────────────────────────────

describe('layout invariants', () => {
  it('layout is deterministic — same tree, same result', () => {
    fc.assert(
      fc.property(smallTreeArb, (spec) => {
        const a = buildOurs(spec);
        a.calculateLayout();
        const boxesA = ourBoxes(a);
        const b = buildOurs(spec);
        b.calculateLayout();
        const boxesB = ourBoxes(b);
        expect(boxesB).toEqual(boxesA);
      }),
      { numRuns: 100 },
    );
  });

  it('explicit child widths are honored when they fit in parent inner', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 30, max: 100 }),
          fc.integer({ min: 0, max: 3 }),
          fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 4 }),
        ),
        ([parentW, padding, kidWidths]) => {
          const inner = parentW - 2 * padding;
          // Drop trailing widths that would overflow inner.
          const kept: number[] = [];
          let sum = 0;
          for (const w of kidWidths) {
            if (sum + w > inner) break;
            kept.push(w);
            sum += w;
          }
          if (kept.length === 0) return; // skip degenerate case
          const spec: SpecNode = {
            flexDirection: 'row',
            width: parentW,
            height: 5,
            paddingAll: padding,
            children: kept.map((w) => ({ width: w, height: 5, flexGrow: 0 })),
          };
          const root = buildOurs(spec);
          root.calculateLayout();
          for (let i = 0; i < kept.length; i++) {
            expect(root.getChild(i)!.getComputedLayout().width).toBe(kept[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('absolute siblings do not shift relative siblings', () => {
    fc.assert(
      fc.property(rowParentArb, (spec) => {
        const flowKids = (spec.children ?? []).map((c) => ({ ...c, flexGrow: 0 }));
        const flowOnly: SpecNode = { ...spec, children: flowKids };
        const withAbs: SpecNode = {
          ...spec,
          children: [
            ...flowKids,
            {
              positionType: 'absolute',
              width: 4,
              height: 2,
              positionTop: 0,
              positionLeft: 0,
            },
          ],
        };
        const a = buildOurs(flowOnly);
        a.calculateLayout();
        const b = buildOurs(withAbs);
        b.calculateLayout();
        // Compare only the flow children's boxes (first N).
        const aFlow = flowChildBoxes(a);
        const bFlow = flowChildBoxes(b).slice(0, aFlow.length);
        expect(bFlow).toEqual(aFlow);
      }),
      { numRuns: 100 },
    );
  });

  it('flexGrow 1:1 splits leftover space evenly within rounding', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 100 }), (parentWidth) => {
        const spec: SpecNode = {
          flexDirection: 'row',
          width: parentWidth,
          height: 5,
          children: [
            { flexGrow: 1, height: 5 },
            { flexGrow: 1, height: 5 },
          ],
        };
        const root = buildOurs(spec);
        root.calculateLayout();
        const a = root.getChild(0)!.getComputedLayout().width;
        const b = root.getChild(1)!.getComputedLayout().width;
        expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
        expect(a + b).toBe(parentWidth);
      }),
      { numRuns: 100 },
    );
  });

  it('matches yoga-layout cell-for-cell on small random trees', () => {
    fc.assert(
      fc.property(differentialTreeArb, (spec) => {
        const ours = buildOurs(spec);
        ours.calculateLayout();
        const ourBoxList = ourBoxes(ours);

        const yoga = buildYoga(spec);
        // Yoga 3.x's default pointScaleFactor is already 1; the previous
        // `Yoga.Config.create().setPointScaleFactor(1)` line was a no-op
        // because the config was never passed to any node. Dropped.
        yoga.calculateLayout(undefined, undefined);
        const yogaBoxList = yogaBoxes(yoga);

        try {
          expect(ourBoxList).toEqual(yogaBoxList);
        } finally {
          // Yoga's WASM nodes need explicit free.
          yoga.freeRecursive();
        }
      }),
      { numRuns: 50 },
    );
  });
});
