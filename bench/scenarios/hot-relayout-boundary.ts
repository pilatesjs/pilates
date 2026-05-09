/**
 * Hot-relayout with explicit-sized row containers (Phase 3 boundaries).
 *
 * Same workload shape as `hot-relayout.ts` (1k-node persistent tree,
 * mutate one leaf per pass), but each row container has explicit
 * `width` AND `height` AND default flex (grow=0, shrink=0) — making
 * it a relayout boundary. Leaf mutations dirty the row but don't
 * propagate to root, so root's layout cache hits on every pass and
 * only the row's subtree re-runs flex.
 *
 * Demonstrates the Phase 3 win directly. Compared to `hotrelayout`,
 * Pilates should be substantially faster.
 */

import { Node } from '@pilates/core';
import Yoga from 'yoga-layout';

const COLS = 200;
const ROWS = 100;
const ROW_COUNT = 50;
const CELLS_PER_ROW = 20;
const ROW_HEIGHT = ROWS / ROW_COUNT; // 2

let pilatesRoot: Node;
let pilatesTargetLeaf: Node;
let pilatesToggle = false;

function buildPilatesPersistent(): void {
  const root = Node.create();
  root.setFlexDirection('column');
  root.setWidth(COLS);
  root.setHeight(ROWS);
  let firstLeaf: Node | undefined;
  for (let r = 0; r < ROW_COUNT; r++) {
    const row = Node.create();
    // Explicit width AND height with default (zero) flex grow/shrink —
    // makes this row a relayout boundary. Critically, do NOT call
    // setFlex/setFlexGrow/setFlexShrink — defaults are 0 which is what
    // the boundary check requires.
    row.setWidth(COLS);
    row.setHeight(ROW_HEIGHT);
    row.setFlexDirection('row');
    root.insertChild(row, r);
    for (let c = 0; c < CELLS_PER_ROW; c++) {
      const cell = Node.create();
      cell.setFlex(1);
      row.insertChild(cell, c);
      if (firstLeaf === undefined) firstLeaf = cell;
    }
  }
  pilatesRoot = root;
  pilatesTargetLeaf = firstLeaf!;
  // Prime the layout once.
  root.calculateLayout(COLS, ROWS);
}

buildPilatesPersistent();

export function pilatesCoreLayout(): void {
  pilatesToggle = !pilatesToggle;
  pilatesTargetLeaf.setFlex(pilatesToggle ? 1 : 2);
  pilatesRoot.calculateLayout(COLS, ROWS);
}

export function pilatesFullRender(): void {
  pilatesCoreLayout();
}

// Yoga: same persistent-tree pattern. Yoga's algorithm has its own
// dirty-bit tracking but doesn't have a "layout boundary" concept
// equivalent to Phase 3.
let yogaRoot: import('yoga-layout').Node | undefined;
let yogaTarget: import('yoga-layout').Node | undefined;
let yogaToggle = false;

function buildYogaPersistent(): void {
  if (yogaRoot !== undefined) return;
  const root = Yoga.Node.create();
  root.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
  root.setWidth(COLS);
  root.setHeight(ROWS);
  let first: import('yoga-layout').Node | undefined;
  for (let r = 0; r < ROW_COUNT; r++) {
    const row = Yoga.Node.create();
    row.setWidth(COLS);
    row.setHeight(ROW_HEIGHT);
    row.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    root.insertChild(row, r);
    for (let c = 0; c < CELLS_PER_ROW; c++) {
      const cell = Yoga.Node.create();
      cell.setFlex(1);
      row.insertChild(cell, c);
      if (first === undefined) first = cell;
    }
  }
  yogaRoot = root;
  yogaTarget = first;
  root.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
}

buildYogaPersistent();

export function yogaLayout(): void {
  yogaToggle = !yogaToggle;
  yogaTarget!.setFlex(yogaToggle ? 1 : 2);
  yogaRoot!.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
}
