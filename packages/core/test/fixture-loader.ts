// packages/core/test/fixture-loader.ts
/**
 * Declarative-fixture loader for Phase 3.1. See
 * docs/superpowers/specs/2026-05-25-phase31-yoga-fixture-corpus-design.md.
 *
 * Schema types are JSON-shaped; tree builders for Pilates and yoga-layout
 * are added in later tasks and share the dispatch table style of
 * yoga-oracle.test.ts (which we intentionally duplicate rather than
 * import — that test file's helpers stay inline next to its TS fixtures).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Yoga, {
  Align as YAlign,
  Edge as YEdge,
  FlexDirection as YFlexDir,
  Gutter as YGutter,
  Justify as YJustify,
  Overflow as YOverflow,
  PositionType as YPositionType,
  Wrap as YWrap,
} from 'yoga-layout';
import { Edge } from '../src/edge.js';
import { inspectLayout } from '../src/inspect.js';
import { Node } from '../src/node.js';
import type {
  Align,
  FlexDirection,
  FlexWrap,
  Justify,
  Overflow,
  PositionType,
} from '../src/style.js';

export type FixtureTag =
  | 'flex-direction'
  | 'justify-content'
  | 'align-items'
  | 'align-self'
  | 'flex-wrap'
  | 'absolute-position'
  | 'aspect-ratio'
  | 'gap'
  | 'overflow'
  | 'position-edges'
  | 'divergent';

const TAG_VALUES: readonly FixtureTag[] = [
  'flex-direction',
  'justify-content',
  'align-items',
  'align-self',
  'flex-wrap',
  'absolute-position',
  'aspect-ratio',
  'gap',
  'overflow',
  'position-edges',
  'divergent',
];

export interface SpecStyle {
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
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
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
  aspectRatio?: number;
  overflow?: Overflow;
  overflowX?: Overflow;
  overflowY?: Overflow;
}

export interface SpecNode {
  id: string;
  style?: SpecStyle;
  children?: SpecNode[];
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Fixture {
  /** "<tag>/<short-slug>"; used as the test display name. */
  name: string;
  tags: FixtureTag[];
  available?: { width?: number; height?: number };
  root: SpecNode;
  expected: Record<string, Box>;
  /** Absolute path on disk — included for failure messages. */
  sourcePath: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES_DIR = join(__dirname, 'fixtures');

/** Recursively collect all `*.spec.json` files under `dir`, sorted for determinism. */
function listSpecFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSpecFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.spec.json')) out.push(full);
  }
  return out.sort();
}

function validateTags(tags: unknown, sourcePath: string): FixtureTag[] {
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error(`${sourcePath}: "tags" must be a non-empty array`);
  }
  for (const t of tags) {
    if (typeof t !== 'string' || !(TAG_VALUES as readonly string[]).includes(t)) {
      throw new Error(
        `${sourcePath}: unknown tag ${JSON.stringify(t)}; allowed: ${TAG_VALUES.join(', ')}`,
      );
    }
  }
  return tags as FixtureTag[];
}

function collectIds(node: SpecNode, into: Set<string>, sourcePath: string): void {
  if (typeof node.id !== 'string' || node.id.length === 0) {
    throw new Error(`${sourcePath}: every node needs a non-empty string "id"`);
  }
  if (into.has(node.id)) {
    throw new Error(`${sourcePath}: duplicate id ${JSON.stringify(node.id)}`);
  }
  into.add(node.id);
  for (const child of node.children ?? []) collectIds(child, into, sourcePath);
}

export function loadFixtures(dir: string = DEFAULT_FIXTURES_DIR): Fixture[] {
  const out: Fixture[] = [];
  for (const file of listSpecFiles(dir)) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${file}: top-level value must be a JSON object`);
    }
    const raw = parsed as Record<string, unknown>;

    if (typeof raw.name !== 'string') throw new Error(`${file}: missing "name"`);
    if (typeof raw.root !== 'object' || raw.root === null || Array.isArray(raw.root)) {
      throw new Error(`${file}: "root" must be an object`);
    }
    if (typeof raw.expected !== 'object' || raw.expected === null || Array.isArray(raw.expected)) {
      throw new Error(`${file}: "expected" must be an object`);
    }
    const tags = validateTags(raw.tags, file);

    const root = raw.root as SpecNode;
    const expected = raw.expected as Record<string, Box>;
    const available =
      typeof raw.available === 'object' && raw.available !== null && !Array.isArray(raw.available)
        ? (raw.available as Fixture['available'])
        : undefined;

    const ids = new Set<string>();
    collectIds(root, ids, file);
    for (const id of ids) {
      if (!(id in expected)) {
        throw new Error(`${file}: id ${JSON.stringify(id)} in tree has no expected box`);
      }
    }
    for (const id of Object.keys(expected)) {
      if (!ids.has(id)) {
        throw new Error(`${file}: expected id ${JSON.stringify(id)} not in tree`);
      }
    }

    out.push({
      name: raw.name,
      tags,
      ...(available !== undefined ? { available } : {}),
      root,
      expected,
      sourcePath: file,
    });
  }
  return out;
}

// ─── tree builders ─────────────────────────────────────────────────────

const FLEX_DIR_MAP: Record<NonNullable<SpecStyle['flexDirection']>, YFlexDir> = {
  row: YFlexDir.Row,
  column: YFlexDir.Column,
  'row-reverse': YFlexDir.RowReverse,
  'column-reverse': YFlexDir.ColumnReverse,
};
const WRAP_MAP: Record<NonNullable<SpecStyle['flexWrap']>, YWrap> = {
  nowrap: YWrap.NoWrap,
  wrap: YWrap.Wrap,
  'wrap-reverse': YWrap.WrapReverse,
};
const JUSTIFY_MAP: Record<NonNullable<SpecStyle['justifyContent']>, YJustify> = {
  'flex-start': YJustify.FlexStart,
  'flex-end': YJustify.FlexEnd,
  center: YJustify.Center,
  'space-between': YJustify.SpaceBetween,
  'space-around': YJustify.SpaceAround,
  'space-evenly': YJustify.SpaceEvenly,
};
const ALIGN_MAP: Record<NonNullable<SpecStyle['alignItems']>, YAlign> = {
  auto: YAlign.Auto,
  'flex-start': YAlign.FlexStart,
  'flex-end': YAlign.FlexEnd,
  center: YAlign.Center,
  stretch: YAlign.Stretch,
  'space-between': YAlign.SpaceBetween,
  'space-around': YAlign.SpaceAround,
};
const POSITION_TYPE_MAP: Record<NonNullable<SpecStyle['positionType']>, YPositionType> = {
  relative: YPositionType.Relative,
  absolute: YPositionType.Absolute,
};
const OVERFLOW_MAP: Record<NonNullable<SpecStyle['overflow']>, YOverflow> = {
  visible: YOverflow.Visible,
  hidden: YOverflow.Hidden,
  scroll: YOverflow.Scroll,
  auto: YOverflow.Hidden, // yoga has no 'auto'; pilates treats it like hidden in practice
};

export interface BuiltTree<T> {
  root: T;
  byId: Map<string, T>;
}

export function buildPilates(spec: SpecNode): BuiltTree<Node> {
  const byId = new Map<string, Node>();
  function go(n: SpecNode): Node {
    const node = Node.create();
    const s = n.style ?? {};
    if (s.flexDirection) node.setFlexDirection(s.flexDirection);
    if (s.flexWrap) node.setFlexWrap(s.flexWrap);
    if (s.width !== undefined) node.setWidth(s.width);
    if (s.height !== undefined) node.setHeight(s.height);
    if (s.minWidth !== undefined) node.setMinWidth(s.minWidth);
    if (s.maxWidth !== undefined) node.setMaxWidth(s.maxWidth);
    if (s.minHeight !== undefined) node.setMinHeight(s.minHeight);
    if (s.maxHeight !== undefined) node.setMaxHeight(s.maxHeight);
    if (s.flexGrow !== undefined) node.setFlexGrow(s.flexGrow);
    if (s.flexShrink !== undefined) node.setFlexShrink(s.flexShrink);
    if (s.flexBasis !== undefined) node.setFlexBasis(s.flexBasis);
    if (s.flex !== undefined) node.setFlex(s.flex);
    if (s.paddingAll !== undefined) node.setPadding(Edge.All, s.paddingAll);
    if (s.paddingTop !== undefined) node.setPadding(Edge.Top, s.paddingTop);
    if (s.paddingRight !== undefined) node.setPadding(Edge.Right, s.paddingRight);
    if (s.paddingBottom !== undefined) node.setPadding(Edge.Bottom, s.paddingBottom);
    if (s.paddingLeft !== undefined) node.setPadding(Edge.Left, s.paddingLeft);
    if (s.marginAll !== undefined) node.setMargin(Edge.All, s.marginAll);
    if (s.marginTop !== undefined) node.setMargin(Edge.Top, s.marginTop);
    if (s.marginRight !== undefined) node.setMargin(Edge.Right, s.marginRight);
    if (s.marginBottom !== undefined) node.setMargin(Edge.Bottom, s.marginBottom);
    if (s.marginLeft !== undefined) node.setMargin(Edge.Left, s.marginLeft);
    if (s.gapRow !== undefined) node.setGap('row', s.gapRow);
    if (s.gapColumn !== undefined) node.setGap('column', s.gapColumn);
    if (s.justifyContent) node.setJustifyContent(s.justifyContent);
    if (s.alignItems) node.setAlignItems(s.alignItems);
    if (s.alignSelf) node.setAlignSelf(s.alignSelf);
    if (s.alignContent) node.setAlignContent(s.alignContent);
    if (s.positionType) node.setPositionType(s.positionType);
    if (s.positionTop !== undefined) node.setPosition(Edge.Top, s.positionTop);
    if (s.positionRight !== undefined) node.setPosition(Edge.Right, s.positionRight);
    if (s.positionBottom !== undefined) node.setPosition(Edge.Bottom, s.positionBottom);
    if (s.positionLeft !== undefined) node.setPosition(Edge.Left, s.positionLeft);
    if (s.aspectRatio !== undefined) node.setAspectRatio(s.aspectRatio);
    if (s.overflow) node.setOverflow(s.overflow);
    if (s.overflowX) node.setOverflowX(s.overflowX);
    if (s.overflowY) node.setOverflowY(s.overflowY);
    byId.set(n.id, node);
    for (let i = 0; i < (n.children?.length ?? 0); i++) {
      node.insertChild(go(n.children![i]!), i);
    }
    return node;
  }
  return { root: go(spec), byId };
}

type YogaNode = import('yoga-layout').Node;

export function buildYoga(spec: SpecNode): BuiltTree<YogaNode> {
  const byId = new Map<string, YogaNode>();
  function go(n: SpecNode): YogaNode {
    const node = Yoga.Node.create();
    const s = n.style ?? {};
    if (s.flexDirection) node.setFlexDirection(FLEX_DIR_MAP[s.flexDirection]);
    if (s.flexWrap) node.setFlexWrap(WRAP_MAP[s.flexWrap]);
    if (s.width !== undefined) node.setWidth(s.width);
    if (s.height !== undefined) node.setHeight(s.height);
    if (s.minWidth !== undefined) node.setMinWidth(s.minWidth);
    if (s.maxWidth !== undefined) node.setMaxWidth(s.maxWidth);
    if (s.minHeight !== undefined) node.setMinHeight(s.minHeight);
    if (s.maxHeight !== undefined) node.setMaxHeight(s.maxHeight);
    if (s.flexGrow !== undefined) node.setFlexGrow(s.flexGrow);
    if (s.flexShrink !== undefined) node.setFlexShrink(s.flexShrink);
    if (s.flexBasis !== undefined) node.setFlexBasis(s.flexBasis);
    if (s.flex !== undefined) node.setFlex(s.flex);
    if (s.paddingAll !== undefined) node.setPadding(YEdge.All, s.paddingAll);
    if (s.paddingTop !== undefined) node.setPadding(YEdge.Top, s.paddingTop);
    if (s.paddingRight !== undefined) node.setPadding(YEdge.Right, s.paddingRight);
    if (s.paddingBottom !== undefined) node.setPadding(YEdge.Bottom, s.paddingBottom);
    if (s.paddingLeft !== undefined) node.setPadding(YEdge.Left, s.paddingLeft);
    if (s.marginAll !== undefined) node.setMargin(YEdge.All, s.marginAll);
    if (s.marginTop !== undefined) node.setMargin(YEdge.Top, s.marginTop);
    if (s.marginRight !== undefined) node.setMargin(YEdge.Right, s.marginRight);
    if (s.marginBottom !== undefined) node.setMargin(YEdge.Bottom, s.marginBottom);
    if (s.marginLeft !== undefined) node.setMargin(YEdge.Left, s.marginLeft);
    if (s.gapRow !== undefined) node.setGap(YGutter.Row, s.gapRow);
    if (s.gapColumn !== undefined) node.setGap(YGutter.Column, s.gapColumn);
    if (s.justifyContent) node.setJustifyContent(JUSTIFY_MAP[s.justifyContent]);
    if (s.alignItems) node.setAlignItems(ALIGN_MAP[s.alignItems]);
    if (s.alignSelf) node.setAlignSelf(ALIGN_MAP[s.alignSelf]);
    if (s.alignContent) node.setAlignContent(ALIGN_MAP[s.alignContent]);
    if (s.positionType) node.setPositionType(POSITION_TYPE_MAP[s.positionType]);
    if (s.positionTop !== undefined) node.setPosition(YEdge.Top, s.positionTop);
    if (s.positionRight !== undefined) node.setPosition(YEdge.Right, s.positionRight);
    if (s.positionBottom !== undefined) node.setPosition(YEdge.Bottom, s.positionBottom);
    if (s.positionLeft !== undefined) node.setPosition(YEdge.Left, s.positionLeft);
    if (s.aspectRatio !== undefined) node.setAspectRatio(s.aspectRatio);
    if (s.overflow) node.setOverflow(OVERFLOW_MAP[s.overflow]);
    // Yoga has no separate setOverflowX/Y; if asymmetric overflow is wanted,
    // the fixture should set `overflow` and the divergence — if any — will be
    // exposed by the runner. Leaving these intentionally unmapped per the
    // spec's "defer divergences" policy.
    byId.set(n.id, node);
    for (let i = 0; i < (n.children?.length ?? 0); i++) {
      node.insertChild(go(n.children![i]!), i);
    }
    return node;
  }
  return { root: go(spec), byId };
}

export function pilatesBox(n: Node): Box {
  const l = n.getComputedLayout();
  return { left: l.left, top: l.top, width: l.width, height: l.height };
}

export function yogaBox(n: YogaNode): Box {
  const l = n.getComputedLayout();
  return { left: l.left, top: l.top, width: l.width, height: l.height };
}

export function collectBoxes<T>(byId: Map<string, T>, getBox: (n: T) => Box): Record<string, Box> {
  const out: Record<string, Box> = {};
  for (const [id, node] of byId) out[id] = getBox(node);
  return out;
}

/**
 * Pretty-print a got/expected box map for failure messages. Boxes that
 * match show `ok`; boxes that diverge show `expected=… got=…` per id.
 */
export function formatBoxDiff(
  label: string,
  expected: Record<string, Box>,
  got: Record<string, Box>,
): string {
  const lines: string[] = [`── ${label} ──`];
  const ids = [...new Set([...Object.keys(expected), ...Object.keys(got)])].sort();
  for (const id of ids) {
    const e = expected[id];
    const g = got[id];
    if (!e) {
      lines.push(`  ${id}: <no expected>  got=${fmtBox(g!)}`);
      continue;
    }
    if (!g) {
      lines.push(`  ${id}: expected=${fmtBox(e)}  <no got>`);
      continue;
    }
    if (e.left === g.left && e.top === g.top && e.width === g.width && e.height === g.height) {
      lines.push(`  ${id}: ok  ${fmtBox(e)}`);
    } else {
      lines.push(`  ${id}: expected=${fmtBox(e)}  got=${fmtBox(g)}`);
    }
  }
  return lines.join('\n');
}

function fmtBox(b: Box): string {
  return `${b.left},${b.top} ${b.width}x${b.height}`;
}

export { inspectLayout };
