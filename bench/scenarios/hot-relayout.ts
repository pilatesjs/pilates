/**
 * Hot-relayout scenario: build a 1k-node tree once, mutate a single
 * leaf's flex value per iteration, calculateLayout. The pattern WASM
 * Yoga traditionally wins on (long-lived tree, hot relayouts).
 *
 * Phase 2 LayoutCache does NOT benefit this pattern: every mutation
 * dirties the root via markDirty propagation, root cache misses, cold
 * path runs. The MeasureCache (Phase 1) does help on each pass. Phase
 * 3+ work (relayout boundaries, etc.) targets this workload.
 *
 * Tree built outside the benchmark function (once per process). The
 * iteration is just: mutate, calculateLayout.
 */

import { Node } from '@pilates/core';
import Yoga from 'yoga-layout';

const COLS = 200;
const ROWS = 100;
const ROW_COUNT = 50;
const CELLS_PER_ROW = 20;

// Persistent Pilates tree.
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
    row.setFlex(1);
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
  // Prime the layout once so subsequent iterations measure relayout
  // cost only.
  root.calculateLayout(COLS, ROWS);
}

buildPilatesPersistent();

export function pilatesCoreLayout(): void {
  pilatesToggle = !pilatesToggle;
  pilatesTargetLeaf.setFlex(pilatesToggle ? 1 : 2);
  pilatesRoot.calculateLayout(COLS, ROWS);
}

export function pilatesFullRender(): void {
  // Hot-relayout uses the persistent-tree pattern; the renderer
  // baseline rebuilds tree each frame and is covered by other
  // scenarios. Treat full render as the same call here.
  pilatesCoreLayout();
}

// Yoga: persistent tree, same pattern. Yoga's calculateLayout uses its
// own internal dirty-bit tracking, so it can also avoid full re-flex
// when only one leaf changed.
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
    row.setFlex(1);
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
