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
