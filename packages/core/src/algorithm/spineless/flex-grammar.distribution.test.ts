import { describe, expect, test } from 'vitest';
import { Node } from '../../node.js';
import { buildFlexGrammar } from './flex-grammar.js';

/**
 * Phase-12 unit tests: the per-parent `mainDistribution` intermediate
 * Field. Validates structure (presence / deps), not full layout
 * correctness — the yoga-oracle + differential fuzzer cover output.
 */

function row(setupCell: (cell: Node, i: number) => void, count = 4): Node {
  const root = Node.create();
  root.setFlexDirection('row');
  root.setWidth(200);
  root.setHeight(20);
  for (let i = 0; i < count; i++) {
    const cell = Node.create();
    setupCell(cell, i);
    root.insertChild(cell, i);
  }
  return root;
}

describe('phase 12 — mainDistribution Field', () => {
  test('emitted when the parent flex-distributes', () => {
    const root = row((c) => c.setFlex(1));
    const { grammar } = buildFlexGrammar(root);
    const parentMainDistFields = [...grammar.keys()].filter(
      (f) => f.node === root && f.name === 'mainDistribution',
    );
    expect(parentMainDistFields).toHaveLength(1);
  });

  test('NOT emitted when no child has flex weight (no flex distribution)', () => {
    const root = row((c) => {
      c.setWidth(50);
      c.setHeight(20);
    });
    const { grammar } = buildFlexGrammar(root);
    const parentMainDistFields = [...grammar.keys()].filter(
      (f) => f.node === root && f.name === 'mainDistribution',
    );
    expect(parentMainDistFields).toHaveLength(0);
  });
});

describe('phase 12 — cell mainSize collapses to mainDistribution read', () => {
  test('cell mainSize deps reference only mainDistribution (qualifying parent)', () => {
    const root = row((c) => c.setFlex(1), 4);
    const { grammar } = buildFlexGrammar(root);
    const mainDist = [...grammar.keys()].find(
      (f) => f.node === root && f.name === 'mainDistribution',
    );
    expect(mainDist).toBeDefined();

    for (let i = 0; i < 4; i++) {
      const cell = root.getChild(i)!;
      const cellMainSize = [...grammar.keys()].find((f) => f.node === cell && f.name === 'width');
      expect(cellMainSize).toBeDefined();
      const rule = grammar.get(cellMainSize!)!;
      expect(rule.deps).toEqual([mainDist]);
    }
  });

  test('cell mainSize keeps sibling deps when parent does NOT qualify (wrap)', () => {
    const root = row((c) => c.setFlex(1), 4);
    root.setFlexWrap('wrap');
    const { grammar } = buildFlexGrammar(root);
    const mainDist = [...grammar.keys()].find(
      (f) => f.node === root && f.name === 'mainDistribution',
    );
    expect(mainDist).toBeUndefined();
    const cell0Width = [...grammar.keys()].find(
      (f) => f.node === root.getChild(0) && f.name === 'width',
    )!;
    expect(grammar.get(cell0Width)!.deps.length).toBeGreaterThan(1);
  });
});

describe('phase 12 — cell mainPos collapses to mainDistribution read', () => {
  test('cell mainPos deps reference only mainDistribution (qualifying parent)', () => {
    const root = row((c) => c.setFlex(1), 4);
    const { grammar } = buildFlexGrammar(root);
    const mainDist = [...grammar.keys()].find(
      (f) => f.node === root && f.name === 'mainDistribution',
    )!;
    for (let i = 0; i < 4; i++) {
      const cell = root.getChild(i)!;
      const cellMainPos = [...grammar.keys()].find((f) => f.node === cell && f.name === 'left');
      expect(cellMainPos).toBeDefined();
      expect(grammar.get(cellMainPos!)!.deps).toEqual([mainDist]);
    }
  });

  test('cell mainPos keeps prior-siblings deps when justify is non-default', () => {
    const root = row((c) => c.setFlex(1), 4);
    root.setJustifyContent('center');
    const { grammar } = buildFlexGrammar(root);
    // Even if mainDistribution is emitted for sizes (phase-12 covers
    // sizes regardless of justify), mainPos in non-default justify
    // keeps its existing emitJustifiedMainPos rule shape.
    const cell1Left = [...grammar.keys()].find(
      (f) => f.node === root.getChild(1) && f.name === 'left',
    )!;
    expect(grammar.get(cell1Left)!.deps.length).toBeGreaterThan(1);
  });
});
