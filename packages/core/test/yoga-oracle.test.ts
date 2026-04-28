/**
 * Yoga oracle: build the same tree in @tercli/core and yoga-layout (Meta's
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
import Yoga, { Edge as YEdge, FlexDirection as YFlexDir, Gutter as YGutter } from 'yoga-layout';
import { Edge } from '../src/edge.js';
import { Node } from '../src/node.js';
import type { FlexDirection } from '../src/style.js';

interface SpecNode {
  flexDirection?: FlexDirection;
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
  marginAll?: number;
  gapRow?: number;
  gapColumn?: number;
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

function buildOurs(spec: SpecNode): Node {
  const n = Node.create();
  if (spec.flexDirection) n.setFlexDirection(spec.flexDirection);
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
  if (spec.marginAll !== undefined) n.setMargin(Edge.All, spec.marginAll);
  if (spec.gapRow !== undefined) n.setGap('row', spec.gapRow);
  if (spec.gapColumn !== undefined) n.setGap('column', spec.gapColumn);
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
  if (spec.marginAll !== undefined) n.setMargin(YEdge.All, spec.marginAll);
  if (spec.gapRow !== undefined) n.setGap(YGutter.Row, spec.gapRow);
  if (spec.gapColumn !== undefined) n.setGap(YGutter.Column, spec.gapColumn);
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
