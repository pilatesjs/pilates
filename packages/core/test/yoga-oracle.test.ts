/**
 * Yoga oracle: build the same tree in @pilates/core and yoga-layout (Meta's
 * reference WASM build), call calculateLayout in both, and assert that the
 * computed layouts match cell-for-cell.
 *
 * Each fixture is described once as a "spec" tree and applied to both
 * engines, so the structures stay in lock-step.
 *
 * yoga-layout's `setPointScaleFactor(1)` keeps Yoga rounding to integer
 * cells the same way we do.
 */

import { describe, expect, it } from 'vitest';
import Yoga, {
  Align as YAlign,
  Edge as YEdge,
  FlexDirection as YFlexDir,
  Gutter as YGutter,
  Justify as YJustify,
  PositionType as YPositionType,
  Wrap as YWrap,
} from 'yoga-layout';
import { Edge } from '../src/edge.js';
import { Node } from '../src/node.js';
import type { Align, FlexDirection, FlexWrap, Justify, PositionType } from '../src/style.js';

interface SpecNode {
  flexDirection?: FlexDirection;
  flexWrap?: FlexWrap;
  width?: number;
  height?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number;
  flex?: number;
  paddingAll?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  marginAll?: number;
  gapRow?: number;
  gapColumn?: number;
  justifyContent?: Justify;
  alignItems?: Align;
  alignSelf?: Align;
  alignContent?: Align;
  positionType?: PositionType;
  positionTop?: number;
  positionRight?: number;
  positionBottom?: number;
  positionLeft?: number;
  children?: SpecNode[];
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const FLEX_DIR_MAP: Record<FlexDirection, YFlexDir> = {
  row: YFlexDir.Row,
  column: YFlexDir.Column,
  'row-reverse': YFlexDir.RowReverse,
  'column-reverse': YFlexDir.ColumnReverse,
};

const WRAP_MAP: Record<FlexWrap, YWrap> = {
  nowrap: YWrap.NoWrap,
  wrap: YWrap.Wrap,
  'wrap-reverse': YWrap.WrapReverse,
};

const JUSTIFY_MAP: Record<Justify, YJustify> = {
  'flex-start': YJustify.FlexStart,
  'flex-end': YJustify.FlexEnd,
  center: YJustify.Center,
  'space-between': YJustify.SpaceBetween,
  'space-around': YJustify.SpaceAround,
  'space-evenly': YJustify.SpaceEvenly,
};

const POSITION_TYPE_MAP: Record<PositionType, YPositionType> = {
  relative: YPositionType.Relative,
  absolute: YPositionType.Absolute,
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

function buildOurs(spec: SpecNode): Node {
  const n = Node.create();
  if (spec.flexDirection) n.setFlexDirection(spec.flexDirection);
  if (spec.flexWrap) n.setFlexWrap(spec.flexWrap);
  if (spec.width !== undefined) n.setWidth(spec.width);
  if (spec.height !== undefined) n.setHeight(spec.height);
  if (spec.minWidth !== undefined) n.setMinWidth(spec.minWidth);
  if (spec.maxWidth !== undefined) n.setMaxWidth(spec.maxWidth);
  if (spec.minHeight !== undefined) n.setMinHeight(spec.minHeight);
  if (spec.maxHeight !== undefined) n.setMaxHeight(spec.maxHeight);
  if (spec.flexGrow !== undefined) n.setFlexGrow(spec.flexGrow);
  if (spec.flexShrink !== undefined) n.setFlexShrink(spec.flexShrink);
  if (spec.flexBasis !== undefined) n.setFlexBasis(spec.flexBasis);
  if (spec.flex !== undefined) n.setFlex(spec.flex);
  if (spec.paddingAll !== undefined) n.setPadding(Edge.All, spec.paddingAll);
  if (spec.paddingTop !== undefined) n.setPadding(Edge.Top, spec.paddingTop);
  if (spec.paddingRight !== undefined) n.setPadding(Edge.Right, spec.paddingRight);
  if (spec.paddingBottom !== undefined) n.setPadding(Edge.Bottom, spec.paddingBottom);
  if (spec.paddingLeft !== undefined) n.setPadding(Edge.Left, spec.paddingLeft);
  if (spec.marginAll !== undefined) n.setMargin(Edge.All, spec.marginAll);
  if (spec.gapRow !== undefined) n.setGap('row', spec.gapRow);
  if (spec.gapColumn !== undefined) n.setGap('column', spec.gapColumn);
  if (spec.justifyContent) n.setJustifyContent(spec.justifyContent);
  if (spec.alignItems) n.setAlignItems(spec.alignItems);
  if (spec.alignSelf) n.setAlignSelf(spec.alignSelf);
  if (spec.alignContent) n.setAlignContent(spec.alignContent);
  if (spec.positionType) n.setPositionType(spec.positionType);
  if (spec.positionTop !== undefined) n.setPosition(Edge.Top, spec.positionTop);
  if (spec.positionRight !== undefined) n.setPosition(Edge.Right, spec.positionRight);
  if (spec.positionBottom !== undefined) n.setPosition(Edge.Bottom, spec.positionBottom);
  if (spec.positionLeft !== undefined) n.setPosition(Edge.Left, spec.positionLeft);
  if (spec.children) {
    for (let i = 0; i < spec.children.length; i++) {
      n.insertChild(buildOurs(spec.children[i]!), i);
    }
  }
  return n;
}

function buildYoga(spec: SpecNode): import('yoga-layout').Node {
  const n = Yoga.Node.create();
  if (spec.flexDirection) n.setFlexDirection(FLEX_DIR_MAP[spec.flexDirection]);
  if (spec.flexWrap) n.setFlexWrap(WRAP_MAP[spec.flexWrap]);
  if (spec.width !== undefined) n.setWidth(spec.width);
  if (spec.height !== undefined) n.setHeight(spec.height);
  if (spec.minWidth !== undefined) n.setMinWidth(spec.minWidth);
  if (spec.maxWidth !== undefined) n.setMaxWidth(spec.maxWidth);
  if (spec.minHeight !== undefined) n.setMinHeight(spec.minHeight);
  if (spec.maxHeight !== undefined) n.setMaxHeight(spec.maxHeight);
  if (spec.flexGrow !== undefined) n.setFlexGrow(spec.flexGrow);
  if (spec.flexShrink !== undefined) n.setFlexShrink(spec.flexShrink);
  if (spec.flexBasis !== undefined) n.setFlexBasis(spec.flexBasis);
  if (spec.flex !== undefined) n.setFlex(spec.flex);
  if (spec.paddingAll !== undefined) n.setPadding(YEdge.All, spec.paddingAll);
  if (spec.paddingTop !== undefined) n.setPadding(YEdge.Top, spec.paddingTop);
  if (spec.paddingRight !== undefined) n.setPadding(YEdge.Right, spec.paddingRight);
  if (spec.paddingBottom !== undefined) n.setPadding(YEdge.Bottom, spec.paddingBottom);
  if (spec.paddingLeft !== undefined) n.setPadding(YEdge.Left, spec.paddingLeft);
  if (spec.marginAll !== undefined) n.setMargin(YEdge.All, spec.marginAll);
  if (spec.gapRow !== undefined) n.setGap(YGutter.Row, spec.gapRow);
  if (spec.gapColumn !== undefined) n.setGap(YGutter.Column, spec.gapColumn);
  if (spec.justifyContent) n.setJustifyContent(JUSTIFY_MAP[spec.justifyContent]);
  if (spec.alignItems) n.setAlignItems(ALIGN_MAP[spec.alignItems]);
  if (spec.alignSelf) n.setAlignSelf(ALIGN_MAP[spec.alignSelf]);
  if (spec.alignContent) n.setAlignContent(ALIGN_MAP[spec.alignContent]);
  if (spec.positionType) n.setPositionType(POSITION_TYPE_MAP[spec.positionType]);
  if (spec.positionTop !== undefined) n.setPosition(YEdge.Top, spec.positionTop);
  if (spec.positionRight !== undefined) n.setPosition(YEdge.Right, spec.positionRight);
  if (spec.positionBottom !== undefined) n.setPosition(YEdge.Bottom, spec.positionBottom);
  if (spec.positionLeft !== undefined) n.setPosition(YEdge.Left, spec.positionLeft);
  if (spec.children) {
    for (let i = 0; i < spec.children.length; i++) {
      n.insertChild(buildYoga(spec.children[i]!), i);
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

function yogaBoxes(node: import('yoga-layout').Node): Box[] {
  const l = node.getComputedLayout();
  const out: Box[] = [{ left: l.left, top: l.top, width: l.width, height: l.height }];
  for (let i = 0; i < node.getChildCount(); i++) {
    out.push(...yogaBoxes(node.getChild(i)));
  }
  return out;
}

interface Fixture {
  name: string;
  spec: SpecNode;
  availableWidth?: number;
  availableHeight?: number;
}

const FIXTURES: Fixture[] = [
  {
    name: 'fixed-width row of three',
    spec: {
      flexDirection: 'row',
      width: 60,
      height: 10,
      children: [{ width: 20 }, { width: 15 }, { width: 25 }],
    },
  },
  {
    name: 'flex:1 distribution evenly',
    spec: {
      flexDirection: 'row',
      width: 60,
      height: 10,
      children: [{ flex: 1 }, { flex: 1 }, { flex: 1 }],
    },
  },
  {
    name: 'flex weights 1/2/3',
    spec: {
      flexDirection: 'row',
      width: 60,
      height: 1,
      children: [{ flexGrow: 1 }, { flexGrow: 2 }, { flexGrow: 3 }],
    },
  },
  {
    name: 'fixed sidebar + flex main',
    spec: {
      flexDirection: 'row',
      width: 80,
      height: 24,
      children: [{ flex: 1 }, { width: 20 }],
    },
  },
  {
    name: 'column with flex children',
    spec: {
      flexDirection: 'column',
      width: 20,
      height: 30,
      children: [{ flex: 1 }, { flex: 2 }],
    },
  },
  {
    name: 'padding on container',
    spec: {
      flexDirection: 'row',
      width: 40,
      height: 10,
      paddingAll: 1,
      children: [{ flex: 1 }],
    },
  },
  {
    name: 'gap row',
    spec: {
      flexDirection: 'row',
      width: 40,
      height: 5,
      gapColumn: 4,
      children: [{ flex: 1 }, { flex: 1 }],
    },
  },
  {
    name: 'gap column',
    spec: {
      flexDirection: 'column',
      width: 20,
      height: 10,
      gapRow: 2,
      children: [{ flex: 1 }, { flex: 1 }],
    },
  },
  {
    name: 'flex shrink with overflow',
    spec: {
      flexDirection: 'row',
      width: 40,
      height: 1,
      children: [{ width: 30 }, { width: 30 }],
    },
  },
  {
    name: 'flex shrink: 0 keeps size',
    spec: {
      flexDirection: 'row',
      width: 40,
      height: 1,
      children: [
        { width: 30, flexShrink: 0 },
        { width: 30, flexShrink: 1 },
      ],
    },
  },
  {
    name: 'min-width clamp',
    spec: {
      flexDirection: 'row',
      width: 60,
      height: 1,
      children: [{ flex: 1, minWidth: 50 }, { flex: 1 }],
    },
  },
  {
    name: 'max-width clamp',
    spec: {
      flexDirection: 'row',
      width: 60,
      height: 1,
      children: [{ flex: 1, maxWidth: 20 }, { flex: 1 }],
    },
  },
  {
    name: 'row-reverse fixed widths',
    spec: {
      flexDirection: 'row-reverse',
      width: 60,
      height: 10,
      children: [{ width: 20 }, { width: 15 }],
    },
  },
  {
    // Regression: flipMainAxis used to mirror about the OUTER container size,
    // which gave the wrong child position whenever main-axis padding was
    // asymmetric. With padLeft=2, padRight=1 the child should land at left=14
    // (mirrored about the inner content box), not left=13.
    name: 'row-reverse with asymmetric main-axis padding',
    spec: {
      flexDirection: 'row-reverse',
      width: 20,
      height: 5,
      paddingLeft: 2,
      paddingRight: 1,
      children: [{ width: 5, height: 1 }],
    },
  },
  {
    name: 'column-reverse with asymmetric main-axis padding',
    spec: {
      flexDirection: 'column-reverse',
      width: 10,
      height: 20,
      paddingTop: 3,
      paddingBottom: 1,
      children: [{ width: 1, height: 4 }],
    },
  },
  {
    name: 'row-reverse + asymmetric padding + multiple children + gap',
    spec: {
      flexDirection: 'row-reverse',
      width: 30,
      height: 5,
      paddingLeft: 4,
      paddingRight: 2,
      gapColumn: 1,
      children: [
        { width: 5, height: 1 },
        { width: 6, height: 1 },
      ],
    },
  },
  {
    name: 'two-pane app shell with header',
    spec: {
      flexDirection: 'column',
      width: 80,
      height: 24,
      children: [
        { height: 1 },
        {
          flex: 1,
          flexDirection: 'row',
          children: [{ flex: 1 }, { width: 20 }],
        },
      ],
    },
  },
  {
    name: 'available width passthrough on auto root',
    spec: {
      flexDirection: 'row',
      children: [{ flex: 1 }, { flex: 1 }],
    },
    availableWidth: 80,
    availableHeight: 24,
  },

  // ── M5: justify-content ──────────────────────────────────────────────
  {
    name: 'justify-content: flex-end',
    spec: {
      flexDirection: 'row',
      width: 60,
      height: 5,
      justifyContent: 'flex-end',
      children: [{ width: 10 }, { width: 10 }],
    },
  },
  {
    name: 'justify-content: center',
    spec: {
      flexDirection: 'row',
      width: 60,
      height: 5,
      justifyContent: 'center',
      children: [{ width: 10 }, { width: 10 }],
    },
  },
  {
    name: 'justify-content: space-between (3 items)',
    spec: {
      flexDirection: 'row',
      width: 60,
      height: 5,
      justifyContent: 'space-between',
      children: [{ width: 10 }, { width: 10 }, { width: 10 }],
    },
  },
  {
    name: 'justify-content: space-around (2 items)',
    spec: {
      flexDirection: 'row',
      width: 60,
      height: 5,
      justifyContent: 'space-around',
      children: [{ width: 10 }, { width: 10 }],
    },
  },
  {
    name: 'justify-content: flex-end on column',
    spec: {
      flexDirection: 'column',
      width: 20,
      height: 30,
      justifyContent: 'flex-end',
      children: [{ height: 5 }, { height: 5 }],
    },
  },

  // ── M5: align-items ──────────────────────────────────────────────────
  {
    name: 'align-items: flex-start',
    spec: {
      flexDirection: 'row',
      width: 40,
      height: 10,
      alignItems: 'flex-start',
      children: [
        { width: 10, height: 4 },
        { width: 10, height: 6 },
      ],
    },
  },
  {
    name: 'align-items: flex-end',
    spec: {
      flexDirection: 'row',
      width: 40,
      height: 10,
      alignItems: 'flex-end',
      children: [
        { width: 10, height: 4 },
        { width: 10, height: 6 },
      ],
    },
  },
  {
    name: 'align-items: center',
    spec: {
      flexDirection: 'row',
      width: 40,
      height: 10,
      alignItems: 'center',
      children: [
        { width: 10, height: 4 },
        { width: 10, height: 6 },
      ],
    },
  },

  // ── M5: align-self ───────────────────────────────────────────────────
  {
    name: 'align-self overrides align-items per item',
    spec: {
      flexDirection: 'row',
      width: 40,
      height: 10,
      alignItems: 'flex-start',
      children: [
        { width: 10, height: 4 },
        { width: 10, height: 4, alignSelf: 'flex-end' },
      ],
    },
  },

  // ── M6: absolute positioning ─────────────────────────────────────────
  {
    name: 'absolute: top-left anchored, fixed size',
    spec: {
      flexDirection: 'row',
      width: 40,
      height: 20,
      children: [
        { flex: 1 },
        {
          positionType: 'absolute',
          positionTop: 2,
          positionLeft: 3,
          width: 10,
          height: 5,
        },
      ],
    },
  },
  {
    name: 'absolute: bottom-right anchored',
    spec: {
      flexDirection: 'row',
      width: 40,
      height: 20,
      children: [
        {
          positionType: 'absolute',
          positionBottom: 0,
          positionRight: 0,
          width: 5,
          height: 5,
        },
      ],
    },
  },
  {
    name: 'absolute: sized from left+right',
    spec: {
      flexDirection: 'row',
      width: 40,
      height: 20,
      children: [
        {
          positionType: 'absolute',
          positionTop: 0,
          positionLeft: 5,
          positionRight: 5,
          height: 10,
        },
      ],
    },
  },
  {
    name: 'absolute: sized from top+bottom',
    spec: {
      flexDirection: 'row',
      width: 40,
      height: 20,
      children: [
        {
          positionType: 'absolute',
          positionTop: 1,
          positionBottom: 2,
          positionLeft: 0,
          width: 10,
        },
      ],
    },
  },
  {
    // Pins Yoga 3.x semantics: absolute children's edge offsets are relative to
    // the parent's OUTER box, not the post-padding inner box. The previous name
    // claimed "inner" and was misleading.
    name: 'absolute: parent has padding, edges relative to outer',
    spec: {
      flexDirection: 'row',
      width: 40,
      height: 20,
      paddingAll: 2,
      children: [
        {
          positionType: 'absolute',
          positionTop: 0,
          positionLeft: 0,
          width: 10,
          height: 5,
        },
      ],
    },
  },
  {
    name: 'absolute: nested flex subtree inside an absolute',
    spec: {
      flexDirection: 'row',
      width: 80,
      height: 24,
      children: [
        {
          positionType: 'absolute',
          positionTop: 5,
          positionLeft: 10,
          width: 40,
          height: 10,
          flexDirection: 'row',
          children: [{ flex: 1 }, { flex: 1 }],
        },
      ],
    },
  },
];

describe('yoga oracle — layouts match yoga-layout cell-for-cell', () => {
  // Configure Yoga to round to whole-cell increments, like we do.
  const cfg = Yoga.Config.create();
  cfg.setPointScaleFactor(1);

  for (const fixture of FIXTURES) {
    it(fixture.name, () => {
      // Ours
      const ours = buildOurs(fixture.spec);
      ours.calculateLayout(fixture.availableWidth, fixture.availableHeight);
      const oursTree = ourBoxes(ours);

      // Theirs
      const theirsRoot = buildYoga(fixture.spec);
      theirsRoot.calculateLayout(fixture.availableWidth, fixture.availableHeight);
      const theirsTree = yogaBoxes(theirsRoot);
      theirsRoot.freeRecursive();

      expect(oursTree).toEqual(theirsTree);
    });
  }

  // Yoga config cleanup is handled by the harness on process exit.
});
