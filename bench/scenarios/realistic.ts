/**
 * Realistic scenario: ~100 nodes, 3-4 levels deep.
 *
 * A representative dashboard tree: header, main body split into sidebar
 * and content, content has a few cards each containing rows of stats.
 */

import { Edge, Node } from '@pilates/core';
import type { RenderNode } from '@pilates/render';
import { renderToFrame } from '@pilates/render';
import Yoga from 'yoga-layout';

const COLS = 120;
const ROWS = 40;
const CARDS = 6;
const ROWS_PER_CARD = 6; // → ~6*6 = 36 stat rows + chrome
const SIDEBAR_ITEMS = 12;

export function buildPilatesTree(): Node {
  const root = Node.create();
  root.setFlexDirection('column');
  root.setWidth(COLS);
  root.setHeight(ROWS);

  // Header (height 1)
  const header = Node.create();
  header.setHeight(1);
  root.insertChild(header, 0);

  // Body (row: sidebar + content)
  const body = Node.create();
  body.setFlex(1);
  body.setFlexDirection('row');
  root.insertChild(body, 1);

  const sidebar = Node.create();
  sidebar.setWidth(20);
  sidebar.setFlexDirection('column');
  body.insertChild(sidebar, 0);
  for (let i = 0; i < SIDEBAR_ITEMS; i++) {
    const item = Node.create();
    item.setHeight(1);
    sidebar.insertChild(item, i);
  }

  const content = Node.create();
  content.setFlex(1);
  content.setFlexDirection('column');
  content.setPadding(Edge.All, 1);
  body.insertChild(content, 1);

  for (let c = 0; c < CARDS; c++) {
    const card = Node.create();
    card.setFlex(1);
    card.setFlexDirection('column');
    card.setMargin(Edge.Bottom, 1);
    content.insertChild(card, c);

    for (let r = 0; r < ROWS_PER_CARD; r++) {
      const row = Node.create();
      row.setHeight(1);
      row.setFlexDirection('row');
      card.insertChild(row, r);
      for (let s = 0; s < 3; s++) {
        const span = Node.create();
        span.setFlex(1);
        row.insertChild(span, s);
      }
    }
  }

  return root;
}

export function buildPilatesRenderTree(): RenderNode {
  const sidebarItems = Array.from({ length: SIDEBAR_ITEMS }, () => ({ height: 1 }));
  const cards = Array.from({ length: CARDS }, () => ({
    flex: 1,
    flexDirection: 'column' as const,
    margin: { bottom: 1 },
    children: Array.from({ length: ROWS_PER_CARD }, () => ({
      height: 1,
      flexDirection: 'row' as const,
      children: [{ flex: 1 }, { flex: 1 }, { flex: 1 }],
    })),
  }));

  return {
    width: COLS,
    height: ROWS,
    flexDirection: 'column' as const,
    children: [
      { height: 1 },
      {
        flex: 1,
        flexDirection: 'row' as const,
        children: [
          { width: 20, flexDirection: 'column' as const, children: sidebarItems },
          { flex: 1, flexDirection: 'column' as const, padding: 1, children: cards },
        ],
      },
    ],
  };
}

export function buildYogaTree(): import('yoga-layout').Node {
  const root = Yoga.Node.create();
  root.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
  root.setWidth(COLS);
  root.setHeight(ROWS);

  const header = Yoga.Node.create();
  header.setHeight(1);
  root.insertChild(header, 0);

  const body = Yoga.Node.create();
  body.setFlex(1);
  body.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  root.insertChild(body, 1);

  const sidebar = Yoga.Node.create();
  sidebar.setWidth(20);
  sidebar.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
  body.insertChild(sidebar, 0);
  for (let i = 0; i < SIDEBAR_ITEMS; i++) {
    const item = Yoga.Node.create();
    item.setHeight(1);
    sidebar.insertChild(item, i);
  }

  const content = Yoga.Node.create();
  content.setFlex(1);
  content.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
  content.setPadding(Yoga.EDGE_ALL, 1);
  body.insertChild(content, 1);

  for (let c = 0; c < CARDS; c++) {
    const card = Yoga.Node.create();
    card.setFlex(1);
    card.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
    card.setMargin(Yoga.EDGE_BOTTOM, 1);
    content.insertChild(card, c);
    for (let r = 0; r < ROWS_PER_CARD; r++) {
      const row = Yoga.Node.create();
      row.setHeight(1);
      row.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
      card.insertChild(row, r);
      for (let s = 0; s < 3; s++) {
        const span = Yoga.Node.create();
        span.setFlex(1);
        row.insertChild(span, s);
      }
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
