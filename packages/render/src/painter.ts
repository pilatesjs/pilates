/**
 * The painter walks the laid-out core tree, looks up each node's source
 * RenderNode for styling info, and writes characters into a `Frame`.
 *
 *   1. The root's bounding rect is the frame.
 *   2. For each node:
 *        - If it has a border: draw the box-drawing characters around its
 *          outer rect; render the optional title in the top edge.
 *        - If it's a text node: word-wrap (or truncate / no-wrap) into the
 *          inner rect.
 *   3. Recurse, passing each child's absolute layout box.
 *
 * Each node's absolute position is computed by accumulating ancestors'
 * relative `layout.left/top` as we descend.
 */

import { stringWidth } from '@pilates/core';
import type { Node } from '@pilates/core';
import { borderChars, hasBorder } from './borders.js';
import type { Bridge } from './build.js';
import { type CellStyle, type Frame, type Rect, styleToCellStyle } from './frame.js';
import {
  type Color,
  type ContainerNode,
  type RenderNode,
  type TextNode,
  isTextNode,
} from './types.js';
import { truncateLine, wrapText } from './wrap.js';

export function paint(frame: Frame, bridge: Bridge): void {
  const { root, source } = bridge;
  paintNode(frame, root, source, 0, 0);
}

function paintNode(
  frame: Frame,
  node: Node,
  source: Map<Node, RenderNode>,
  parentX: number,
  parentY: number,
): void {
  const layout = node.getComputedLayout();
  const x = parentX + layout.left;
  const y = parentY + layout.top;
  const rect: Rect = { x, y, width: layout.width, height: layout.height };
  const spec = source.get(node);

  if (spec === undefined) return;

  if (isTextNode(spec)) {
    paintText(frame, spec, rect);
  } else {
    paintContainer(frame, spec, rect);
  }

  for (let i = 0; i < node.getChildCount(); i++) {
    paintNode(frame, node.getChild(i)!, source, x, y);
  }
}

function paintContainer(frame: Frame, spec: ContainerNode, rect: Rect): void {
  if (rect.width === 0 || rect.height === 0) return;
  if (!hasBorder(spec.border)) return;

  const chars = borderChars(spec.border ?? 'none');
  const borderStyle: CellStyle = {
    fg: spec.borderColor,
    bg: undefined,
    attrs: 0,
  };

  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.width - 1;
  const y1 = rect.y + rect.height - 1;

  // Corners.
  frame.setGrapheme(x0, y0, chars.tl, borderStyle);
  frame.setGrapheme(x1, y0, chars.tr, borderStyle);
  frame.setGrapheme(x0, y1, chars.bl, borderStyle);
  frame.setGrapheme(x1, y1, chars.br, borderStyle);

  // Horizontal edges.
  for (let cx = x0 + 1; cx < x1; cx++) {
    frame.setGrapheme(cx, y0, chars.h, borderStyle);
    frame.setGrapheme(cx, y1, chars.h, borderStyle);
  }
  // Vertical edges.
  for (let cy = y0 + 1; cy < y1; cy++) {
    frame.setGrapheme(x0, cy, chars.v, borderStyle);
    frame.setGrapheme(x1, cy, chars.v, borderStyle);
  }

  // Title slot: render inline on the top border with the layout
  // `┌─ title ─...─┐`. We need at least 6 cells: 2 corners + 1 leading ─ +
  // 2 padding spaces + at least 1 char of title.
  if (spec.title && rect.width >= 6) {
    const innerWidth = rect.width - 5; // 2 corners + 1 leading ─ + 2 spaces
    const title = truncateLine(spec.title, innerWidth);
    if (title.length > 0) {
      const tStyle: CellStyle = {
        fg: spec.titleColor ?? spec.borderColor,
        bg: undefined,
        attrs: 0,
      };
      // Leave the leading ─ from the border draw at x0+1, then " title ".
      frame.setGrapheme(x0 + 2, y0, ' ', borderStyle);
      const written = frame.writeText(x0 + 3, y0, title, tStyle);
      frame.setGrapheme(x0 + 3 + written, y0, ' ', borderStyle);
    }
  }
}

function paintText(frame: Frame, spec: TextNode, rect: Rect): void {
  if (rect.width === 0 || rect.height === 0) return;

  const style = styleToCellStyle(spec);

  const wrap = spec.wrap ?? 'wrap';
  let lines: string[];
  if (wrap === 'none') {
    lines = spec.text.split('\n');
  } else if (wrap === 'truncate') {
    lines = spec.text.split('\n').map((l) => truncateLine(l, rect.width));
  } else {
    lines = wrapText(spec.text, rect.width);
  }

  for (let i = 0; i < lines.length && i < rect.height; i++) {
    const line = lines[i]!;
    // Background fill across the entire line for inverse / bgColor effect.
    if (style.bg !== undefined || style.attrs !== 0) {
      paintBackgroundRow(frame, rect.x, rect.y + i, rect.width, style);
    }
    frame.writeText(rect.x, rect.y + i, line, style);
  }
}

/**
 * Pre-paint a row with the text style so background / attrs apply across
 * the full text-node rectangle, not just where characters land.
 */
function paintBackgroundRow(
  frame: Frame,
  x: number,
  y: number,
  width: number,
  style: CellStyle,
): void {
  const bgStyle: CellStyle = { fg: style.fg, bg: style.bg, attrs: style.attrs };
  for (let cx = x; cx < x + width; cx++) {
    frame.setGrapheme(cx, y, ' ', bgStyle);
  }
}

// Re-export Color for index.ts convenience.
export type { Color };
// stringWidth is referenced in the painter doc only; suppress unused.
void stringWidth;
