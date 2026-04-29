/**
 * Tiny scenario: 10 nodes, 1 level deep.
 *
 * Warm-path numbers — captures the per-call overhead of layout for a
 * trivial tree. This is where Pilates' "no WASM init" should help on
 * cold starts and where any per-call allocation should be visible.
 */

import { Edge, Node } from '@pilates/core';
import type { RenderNode } from '@pilates/render';
import { renderToFrame } from '@pilates/render';
import Yoga from 'yoga-layout';

const COLS = 80;
const ROWS = 24;
const CHILDREN = 9; // root + 9 = 10 nodes total

export function buildPilatesTree(): Node {
  const root = Node.create();
  root.setFlexDirection('row');
  root.setWidth(COLS);
  root.setHeight(ROWS);
  root.setPadding(Edge.All, 1);
  for (let i = 0; i < CHILDREN; i++) {
    const c = Node.create();
    c.setFlex(1);
    root.insertChild(c, i);
  }
  return root;
}

export function buildPilatesRenderTree(): RenderNode {
  const children = Array.from({ length: CHILDREN }, () => ({ flex: 1 }));
  return {
    width: COLS,
    height: ROWS,
    flexDirection: 'row' as const,
    padding: 1,
    children,
  };
}

export function buildYogaTree(): import('yoga-layout').Node {
  const root = Yoga.Node.create();
  root.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  root.setWidth(COLS);
  root.setHeight(ROWS);
  root.setPadding(Yoga.EDGE_ALL, 1);
  for (let i = 0; i < CHILDREN; i++) {
    const c = Yoga.Node.create();
    c.setFlex(1);
    root.insertChild(c, i);
  }
  return root;
}

export function pilatesCoreLayout(): void {
  const root = buildPilatesTree();
  root.calculateLayout();
  // Free immediately — we want to bench the layout cost, not GC.
  freePilates(root);
}

export function pilatesFullRender(): void {
  renderToFrame(buildPilatesRenderTree());
}

export function yogaLayout(): void {
  const root = buildYogaTree();
  root.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
  root.freeRecursive();
}

function freePilates(node: Node): void {
  for (let i = 0; i < node.getChildCount(); i++) {
    freePilates(node.getChild(i)!);
  }
  // @pilates/core doesn't require explicit free — GC handles it.
  // This is a noop for the pilates benchmark (kept for symmetry).
}
