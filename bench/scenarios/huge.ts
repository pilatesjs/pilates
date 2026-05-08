/**
 * Huge scenario: ~10k nodes.
 *
 * Tree-build-then-layout at the upper end of the "5k-10k" target range.
 * 100 rows × 100 cells = 10101 nodes including the root.
 */

import { Node } from '@pilates/core';
import type { RenderNode } from '@pilates/render';
import { renderToFrame } from '@pilates/render';
import Yoga from 'yoga-layout';

const COLS = 400;
const ROWS = 400;
const ROW_COUNT = 100;
const CELLS_PER_ROW = 100;

export function buildPilatesTree(): Node {
  const root = Node.create();
  root.setFlexDirection('column');
  root.setWidth(COLS);
  root.setHeight(ROWS);

  for (let r = 0; r < ROW_COUNT; r++) {
    const row = Node.create();
    row.setFlex(1);
    row.setFlexDirection('row');
    root.insertChild(row, r);
    for (let c = 0; c < CELLS_PER_ROW; c++) {
      const cell = Node.create();
      cell.setFlex(1);
      row.insertChild(cell, c);
    }
  }

  return root;
}

export function buildPilatesRenderTree(): RenderNode {
  const rows = Array.from({ length: ROW_COUNT }, () => ({
    flex: 1,
    flexDirection: 'row' as const,
    children: Array.from({ length: CELLS_PER_ROW }, () => ({ flex: 1 })),
  }));
  return {
    width: COLS,
    height: ROWS,
    flexDirection: 'column' as const,
    children: rows,
  };
}

export function buildYogaTree(): import('yoga-layout').Node {
  const root = Yoga.Node.create();
  root.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
  root.setWidth(COLS);
  root.setHeight(ROWS);

  for (let r = 0; r < ROW_COUNT; r++) {
    const row = Yoga.Node.create();
    row.setFlex(1);
    row.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    root.insertChild(row, r);
    for (let c = 0; c < CELLS_PER_ROW; c++) {
      const cell = Yoga.Node.create();
      cell.setFlex(1);
      row.insertChild(cell, c);
    }
  }

  return root;
}

export function pilatesCoreLayout(): void {
  const root = buildPilatesTree();
  root.calculateLayout();
}

export function pilatesFullRender(): void {
  renderToFrame(buildPilatesRenderTree());
}

export function yogaLayout(): void {
  const root = buildYogaTree();
  root.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
  root.freeRecursive();
}
