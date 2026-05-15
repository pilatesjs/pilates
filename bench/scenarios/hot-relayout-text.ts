/**
 * Hot-relayout-text scenario: build a 1k-node fixed-size table once,
 * mutate a single leaf's width per iteration. Mirrors the realistic
 * TUI workload where one cell's text changes length and the rest of
 * the row needs to reflow.
 *
 * Three engines:
 * - **Pilates imperative** (`@pilates/core (layout)`): full
 *   `calculateLayout()` per iteration.
 * - **Pilates Spineless** (`@pilates/core (spineless)`):
 *   `SpinelessRuntime` with the grammar built once. Each iteration
 *   mutates `style.width`, marks the leaf's width field dirty, and
 *   calls `recompute()`. The runtime ripples through the dependents
 *   (downstream cells' `left` positions in the same row) and stops.
 * - **Yoga** (`yoga-layout (WASM)`): same mutation pattern, full
 *   `calculateLayout()` per iteration.
 *
 * No flex on any node — every cell has an explicit fixed width. This
 * keeps the test inside the slice of style-mutation wiring the
 * grammar currently supports (the v1 size-only live-read landed in
 * the previous PR). Flex-grow / flex-shrink mutation would need the
 * next slice to flow incrementally.
 */

// The three `../../packages/core/dist/algorithm/spineless/*` imports reach
// into the built core package. Spineless is internal phase-5b infrastructure
// — not yet on `@pilates/core`'s public exports surface. `pnpm bench` runs
// `pnpm build` first so these files are always populated.
import { Node } from '@pilates/core';
import Yoga from 'yoga-layout';
import { buildFlexGrammar } from '../../packages/core/dist/algorithm/spineless/flex-grammar.js';
import type { Field } from '../../packages/core/dist/algorithm/spineless/grammar.js';
import { SpinelessRuntime } from '../../packages/core/dist/algorithm/spineless/runtime.js';

const COLS = 200;
const ROWS = 100;
const ROW_COUNT = 50;
const CELLS_PER_ROW = 20;
const CELL_WIDTH = COLS / CELLS_PER_ROW; // 10
const CELL_HEIGHT = ROWS / ROW_COUNT; // 2

// ─── Pilates imperative ────────────────────────────────────────────────

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
    row.setFlexDirection('row');
    row.setWidth(COLS);
    row.setHeight(CELL_HEIGHT);
    root.insertChild(row, r);
    for (let c = 0; c < CELLS_PER_ROW; c++) {
      const cell = Node.create();
      cell.setWidth(CELL_WIDTH);
      cell.setHeight(CELL_HEIGHT);
      row.insertChild(cell, c);
      if (firstLeaf === undefined) firstLeaf = cell;
    }
  }
  pilatesRoot = root;
  pilatesTargetLeaf = firstLeaf!;
  root.calculateLayout(COLS, ROWS);
}

buildPilatesPersistent();

export function pilatesCoreLayout(): void {
  pilatesToggle = !pilatesToggle;
  pilatesTargetLeaf.setWidth(pilatesToggle ? CELL_WIDTH + 2 : CELL_WIDTH);
  pilatesRoot.calculateLayout(COLS, ROWS);
}

export function pilatesFullRender(): void {
  // Same as core layout — this scenario isn't about render-layer cost.
  pilatesCoreLayout();
}

// ─── Pilates Spineless ─────────────────────────────────────────────────

let spinelessRuntime!: SpinelessRuntime;
let spinelessTargetWidthField!: Field<number>;
let spinelessToggle = false;
let spinelessRoot!: Node;
let spinelessTargetLeaf!: Node;

function buildPilatesSpineless(): void {
  // A separate persistent tree so the imperative and Spineless paths
  // don't share mutable state (the imperative path also mutates its
  // own tree on every call).
  const root = Node.create();
  root.setFlexDirection('column');
  root.setWidth(COLS);
  root.setHeight(ROWS);
  let firstLeaf: Node | undefined;
  for (let r = 0; r < ROW_COUNT; r++) {
    const row = Node.create();
    row.setFlexDirection('row');
    row.setWidth(COLS);
    row.setHeight(CELL_HEIGHT);
    root.insertChild(row, r);
    for (let c = 0; c < CELLS_PER_ROW; c++) {
      const cell = Node.create();
      cell.setWidth(CELL_WIDTH);
      cell.setHeight(CELL_HEIGHT);
      row.insertChild(cell, c);
      if (firstLeaf === undefined) firstLeaf = cell;
    }
  }

  const { grammar, allFields } = buildFlexGrammar(root);
  const rootFields: Field<unknown>[] = [];
  for (const f of allFields) {
    rootFields.push(f.width, f.height, f.left, f.top);
  }
  spinelessRuntime = new SpinelessRuntime(grammar, rootFields);
  spinelessRuntime.init();

  spinelessRoot = root;
  spinelessTargetLeaf = firstLeaf!;
  spinelessTargetWidthField = allFields.find((f) => f.node === firstLeaf)!.width;
}

buildPilatesSpineless();

export function pilatesSpinelessLayout(): void {
  spinelessToggle = !spinelessToggle;
  spinelessTargetLeaf.setWidth(spinelessToggle ? CELL_WIDTH + 2 : CELL_WIDTH);
  spinelessRuntime.markDirty(spinelessTargetWidthField);
  spinelessRuntime.recompute();
}

// `spinelessRoot` is intentionally unused at the call site — the
// reference keeps it alive for inspection / debugging if needed.
void spinelessRoot;

// ─── Yoga ──────────────────────────────────────────────────────────────

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
    row.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    row.setWidth(COLS);
    row.setHeight(CELL_HEIGHT);
    root.insertChild(row, r);
    for (let c = 0; c < CELLS_PER_ROW; c++) {
      const cell = Yoga.Node.create();
      cell.setWidth(CELL_WIDTH);
      cell.setHeight(CELL_HEIGHT);
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
  yogaTarget!.setWidth(yogaToggle ? CELL_WIDTH + 2 : CELL_WIDTH);
  yogaRoot!.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
}
