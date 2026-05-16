/**
 * Hot-structural scenario: a ~1k-node table (100 rows × 10 cells)
 * built once, with a whole row appended then removed on alternating
 * iterations. Mirrors the realistic TUI workload where a list grows
 * and shrinks — rows streamed into a log, a table paginated.
 *
 * Four engines, each on its own persistent tree:
 * - **Pilates imperative** (`@pilates/core (layout)`): mutate the
 *   tree, then a full `calculateLayout()`.
 * - **Pilates Spineless** (`@pilates/core (spineless)`): the
 *   phase-5c incremental structural path — `buildAppendFragment` /
 *   `buildRemoveFragment` produce the patch, `graft` / `detach`
 *   splice the dependency graph, `recompute()` settles it. No fresh
 *   runtime, no `init()`.
 * - **Pilates Spineless rebuild** (`@pilates/core (spineless
 *   rebuild)`): the naive Spineless path — mutate the tree, then a
 *   full `buildFlexGrammar()` + new `SpinelessRuntime` + `init()`
 *   every iteration. The baseline phase 5c's incremental ops beat.
 * - **Yoga** (`yoga-layout (WASM)`): mutate, full `calculateLayout()`.
 *
 * The column is in the "simple" regime (fixed-size rows, default
 * justify, no wrap), so appending / removing the last row is a pure
 * graft / detach — `rebinds` is empty.
 */

import { Node } from '@pilates/core';
import Yoga from 'yoga-layout';
import {
  buildAppendFragment,
  buildFlexGrammar,
  buildRemoveFragment,
} from '../../packages/core/dist/algorithm/spineless/flex-grammar.js';
import type { Field } from '../../packages/core/dist/algorithm/spineless/grammar.js';
import { SpinelessRuntime } from '../../packages/core/dist/algorithm/spineless/runtime.js';

const ROW_COUNT = 100;
const CELLS_PER_ROW = 10;
const CELL_W = 8;
const CELL_H = 1;
const ROW_W = CELL_W * CELLS_PER_ROW; // 80
const COL_H = (ROW_COUNT + 1) * CELL_H; // room for the toggled row

// ─── shared tree builders (Pilates) ─────────────────────────────────────

function makeRow(): Node {
  const row = Node.create();
  row.setFlexDirection('row');
  row.setWidth(ROW_W);
  row.setHeight(CELL_H);
  for (let c = 0; c < CELLS_PER_ROW; c++) {
    const cell = Node.create();
    cell.setWidth(CELL_W);
    cell.setHeight(CELL_H);
    row.insertChild(cell, c);
  }
  return row;
}

function buildList(): Node {
  const root = Node.create();
  root.setFlexDirection('column');
  root.setWidth(ROW_W);
  root.setHeight(COL_H);
  for (let r = 0; r < ROW_COUNT; r++) root.insertChild(makeRow(), r);
  return root;
}

function rootFieldsOf(out: ReturnType<typeof buildFlexGrammar>): Field<unknown>[] {
  const fields: Field<unknown>[] = [];
  for (const f of out.allFields) fields.push(f.width, f.height, f.left, f.top);
  return fields;
}

// ─── Pilates imperative ─────────────────────────────────────────────────

const impRoot = buildList();
impRoot.calculateLayout(ROW_W, COL_H);
let impExtra: Node | null = null;

export function pilatesCoreLayout(): void {
  if (impExtra !== null) {
    impRoot.removeChild(impExtra);
    impExtra = null;
  } else {
    impExtra = makeRow();
    impRoot.insertChild(impExtra, impRoot.getChildCount());
  }
  impRoot.calculateLayout(ROW_W, COL_H);
}

export function pilatesFullRender(): void {
  // This scenario isn't about render-layer cost.
  pilatesCoreLayout();
}

// ─── Pilates Spineless (incremental graft / detach) ─────────────────────

const spRoot = buildList();
let spPrev = buildFlexGrammar(spRoot);
const spRuntime = new SpinelessRuntime(spPrev.grammar, rootFieldsOf(spPrev));
spRuntime.init();
let spExtra: Node | null = null;

export function pilatesSpinelessLayout(): void {
  if (spExtra !== null) {
    // Remove the last row: build the fragment while it is still
    // attached, rebind survivors (none, simple regime), detach.
    const frag = buildRemoveFragment(spPrev, spRoot, spRoot, spExtra)!;
    for (const [f, rule] of frag.rebinds) spRuntime.rebindRule(f, rule);
    spRuntime.detach(frag.removed);
    spRuntime.recompute();
    spRoot.removeChild(spExtra);
    spExtra = null;
    spPrev = frag.next;
  } else {
    // Append a row: insert, graft the new subtree, recompute.
    spExtra = makeRow();
    spRoot.insertChild(spExtra, spRoot.getChildCount());
    const frag = buildAppendFragment(spPrev, spRoot, spRoot, spExtra)!;
    spRuntime.graft(frag.additions, frag.newRoots);
    for (const [f, rule] of frag.rebinds) spRuntime.rebindRule(f, rule);
    spRuntime.recompute();
    spPrev = frag.next;
  }
}

// ─── Pilates Spineless (naive full rebuild) ─────────────────────────────

const sbRoot = buildList();
let sbExtra: Node | null = null;

export function pilatesSpinelessRebuild(): void {
  if (sbExtra !== null) {
    sbRoot.removeChild(sbExtra);
    sbExtra = null;
  } else {
    sbExtra = makeRow();
    sbRoot.insertChild(sbExtra, sbRoot.getChildCount());
  }
  const out = buildFlexGrammar(sbRoot);
  const rt = new SpinelessRuntime(out.grammar, rootFieldsOf(out));
  rt.init();
}

// ─── Yoga ───────────────────────────────────────────────────────────────

type YogaNode = import('yoga-layout').Node;

function makeYogaRow(): YogaNode {
  const row = Yoga.Node.create();
  row.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  row.setWidth(ROW_W);
  row.setHeight(CELL_H);
  for (let c = 0; c < CELLS_PER_ROW; c++) {
    const cell = Yoga.Node.create();
    cell.setWidth(CELL_W);
    cell.setHeight(CELL_H);
    row.insertChild(cell, c);
  }
  return row;
}

const yogaRoot = Yoga.Node.create();
yogaRoot.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
yogaRoot.setWidth(ROW_W);
yogaRoot.setHeight(COL_H);
for (let r = 0; r < ROW_COUNT; r++) yogaRoot.insertChild(makeYogaRow(), r);
yogaRoot.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
let yogaExtra: YogaNode | null = null;

export function yogaLayout(): void {
  if (yogaExtra !== null) {
    yogaRoot.removeChild(yogaExtra);
    yogaExtra.freeRecursive();
    yogaExtra = null;
  } else {
    yogaExtra = makeYogaRow();
    yogaRoot.insertChild(yogaExtra, yogaRoot.getChildCount());
  }
  yogaRoot.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
}
