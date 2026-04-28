/**
 * Translate the declarative `RenderNode` tree into a tree of imperative
 * `@tercli/core` `Node`s, ready for `calculateLayout()`.
 *
 * The translation also handles:
 *   - Border-as-padding: a node with a border consumes 1 cell on each edge,
 *     so we add 1 to the user's padding on each border-bearing edge.
 *   - Text leaves: attach a measure function that sums word-wrapped lines
 *     using the parent-supplied width hint.
 *
 * The returned bridge keeps a side map from core Node back to its source
 * RenderNode so the painter can look up styling without re-walking.
 */

import { Edge, type MeasureFunc, MeasureMode, Node, stringWidth } from '@tercli/core';
import { hasBorder } from './borders.js';
import type { ContainerNode, EdgeValue, RenderNode, TextNode } from './types.js';
import { isTextNode } from './types.js';
import { truncateLine, wrapText } from './wrap.js';

export interface Bridge {
  root: Node;
  /** Map from core `Node` to the source `RenderNode` for paint-time lookups. */
  source: Map<Node, RenderNode>;
}

export function build(tree: RenderNode): Bridge {
  const source = new Map<Node, RenderNode>();
  const root = buildNode(tree, source);
  return { root, source };
}

function buildNode(spec: RenderNode, source: Map<Node, RenderNode>): Node {
  const node = Node.create();
  source.set(node, spec);

  if (isTextNode(spec)) {
    applyLayoutProps(node, spec);
    attachTextMeasure(node, spec);
    return node;
  }

  applyLayoutProps(node, spec);
  applyBorderAsPadding(node, spec);

  const children = spec.children ?? [];
  for (let i = 0; i < children.length; i++) {
    node.insertChild(buildNode(children[i]!, source), i);
  }
  return node;
}

function applyLayoutProps(node: Node, spec: RenderNode): void {
  if (spec.flexDirection) node.setFlexDirection(spec.flexDirection);
  if (spec.flexWrap) node.setFlexWrap(spec.flexWrap);
  if (spec.flex !== undefined) node.setFlex(spec.flex);
  if (spec.flexGrow !== undefined) node.setFlexGrow(spec.flexGrow);
  if (spec.flexShrink !== undefined) node.setFlexShrink(spec.flexShrink);
  if (spec.flexBasis !== undefined) node.setFlexBasis(spec.flexBasis);
  if (spec.width !== undefined) node.setWidth(spec.width);
  if (spec.height !== undefined) node.setHeight(spec.height);
  if (spec.minWidth !== undefined) node.setMinWidth(spec.minWidth);
  if (spec.minHeight !== undefined) node.setMinHeight(spec.minHeight);
  if (spec.maxWidth !== undefined) node.setMaxWidth(spec.maxWidth);
  if (spec.maxHeight !== undefined) node.setMaxHeight(spec.maxHeight);
  applyEdgeValue(spec.padding, (e, v) => node.setPadding(e, v));
  applyEdgeValue(spec.margin, (e, v) => node.setMargin(e, v));
  if (typeof spec.gap === 'number') {
    node.setGap('row', spec.gap);
    node.setGap('column', spec.gap);
  } else if (spec.gap) {
    if (spec.gap.row !== undefined) node.setGap('row', spec.gap.row);
    if (spec.gap.column !== undefined) node.setGap('column', spec.gap.column);
  }
  if (spec.justifyContent) node.setJustifyContent(spec.justifyContent);
  if (spec.alignItems) node.setAlignItems(spec.alignItems);
  if (spec.alignSelf) node.setAlignSelf(spec.alignSelf);
  if (spec.alignContent) node.setAlignContent(spec.alignContent);
  if (spec.positionType) node.setPositionType(spec.positionType);
  if (spec.position) {
    if (spec.position.top !== undefined) node.setPosition(Edge.Top, spec.position.top);
    if (spec.position.right !== undefined) node.setPosition(Edge.Right, spec.position.right);
    if (spec.position.bottom !== undefined) node.setPosition(Edge.Bottom, spec.position.bottom);
    if (spec.position.left !== undefined) node.setPosition(Edge.Left, spec.position.left);
  }
  if (spec.display) node.setDisplay(spec.display);
}

function applyEdgeValue(value: EdgeValue | undefined, set: (edge: Edge, n: number) => void): void {
  if (value === undefined) return;
  if (typeof value === 'number') {
    set(Edge.All, value);
    return;
  }
  if (value.top !== undefined) set(Edge.Top, value.top);
  if (value.right !== undefined) set(Edge.Right, value.right);
  if (value.bottom !== undefined) set(Edge.Bottom, value.bottom);
  if (value.left !== undefined) set(Edge.Left, value.left);
}

function applyBorderAsPadding(node: Node, spec: ContainerNode): void {
  if (!hasBorder(spec.border)) return;
  // Border eats 1 cell on every edge. Add to whatever padding the user set.
  // Read current per-edge padding via the style snapshot.
  const pad = node.style.padding;
  node.setPadding(Edge.Top, (pad[0] ?? 0) + 1);
  node.setPadding(Edge.Right, (pad[1] ?? 0) + 1);
  node.setPadding(Edge.Bottom, (pad[2] ?? 0) + 1);
  node.setPadding(Edge.Left, (pad[3] ?? 0) + 1);
}

function attachTextMeasure(node: Node, spec: TextNode): void {
  // Text leaves default to flexShrink: 1 in the render layer so they fit
  // their container under wrap (the core engine's default is 0 — Yoga
  // semantics — but for declarative text rendering shrink-to-fit is what
  // users expect). If the user explicitly set flexShrink, applyLayoutProps
  // already wrote it before this runs.
  if (spec.flexShrink === undefined) {
    node.setFlexShrink(1);
  }

  const wrap = spec.wrap ?? 'wrap';
  const measure: MeasureFunc = (width, widthMode) => {
    if (wrap === 'none') {
      const w = stringWidth(spec.text);
      return { width: w, height: 1 };
    }
    if (wrap === 'truncate') {
      const w =
        widthMode === MeasureMode.Undefined
          ? stringWidth(spec.text)
          : Math.min(width, stringWidth(spec.text));
      const truncW = stringWidth(truncateLine(spec.text, w));
      return { width: truncW, height: 1 };
    }
    // Wrap.
    const constraint = widthMode === MeasureMode.Undefined ? Number.MAX_SAFE_INTEGER : width;
    const lines = wrapText(spec.text, Math.max(0, constraint));
    let maxW = 0;
    for (const line of lines) {
      const w = stringWidth(line);
      if (w > maxW) maxW = w;
    }
    return { width: maxW, height: Math.max(1, lines.length) };
  };
  node.setMeasureFunc(measure);
}
