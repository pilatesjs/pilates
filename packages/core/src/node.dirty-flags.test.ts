import { describe, expect, test } from 'vitest';
import {
  DIRTY_CHILDREN,
  DIRTY_FLEX_DISTRIBUTION,
  DIRTY_MEASURE,
  DIRTY_STYLE_SIG,
  DIRTY_STYLE_VALUE,
} from './dirty-flags.js';
import { Edge } from './edge.js';
import { Node } from './node.js';

function freshNode(): Node {
  const n = Node.create();
  // Newly-created Nodes are dirty by default; clear flags for a known starting state.
  // The test exercise: from a "clean" state, mutate one property, observe the flag.
  // Some setters early-exit if the value is unchanged; choose mutation values that differ from defaults.
  (n as unknown as { _dirtyFlags: number })._dirtyFlags = 0;
  return n;
}

function flags(n: Node): number {
  return (n as unknown as { _dirtyFlags: number })._dirtyFlags;
}

describe('Node setters mark specific dirty flags (phase 15B)', () => {
  test('setFlexDirection marks DIRTY_STYLE_SIG', () => {
    const n = freshNode();
    n.setFlexDirection('row'); // default is 'column'
    expect(flags(n) & DIRTY_STYLE_SIG).toBe(DIRTY_STYLE_SIG);
    // Pure SIG mutation should NOT mark STYLE_VALUE etc.
    expect(flags(n) & DIRTY_STYLE_VALUE).toBe(0);
    expect(flags(n) & DIRTY_FLEX_DISTRIBUTION).toBe(0);
  });

  test('setWidth marks DIRTY_STYLE_VALUE', () => {
    const n = freshNode();
    n.setWidth(50);
    expect(flags(n) & DIRTY_STYLE_VALUE).toBe(DIRTY_STYLE_VALUE);
    expect(flags(n) & DIRTY_STYLE_SIG).toBe(0);
  });

  test('setHeight marks DIRTY_STYLE_VALUE', () => {
    const n = freshNode();
    n.setHeight(50);
    expect(flags(n) & DIRTY_STYLE_VALUE).toBe(DIRTY_STYLE_VALUE);
  });

  test('setFlex marks DIRTY_FLEX_DISTRIBUTION', () => {
    const n = freshNode();
    n.setFlex(1);
    expect(flags(n) & DIRTY_FLEX_DISTRIBUTION).toBe(DIRTY_FLEX_DISTRIBUTION);
    expect(flags(n) & DIRTY_STYLE_SIG).toBe(0);
    expect(flags(n) & DIRTY_STYLE_VALUE).toBe(0);
  });

  test('setFlexGrow marks DIRTY_FLEX_DISTRIBUTION', () => {
    const n = freshNode();
    n.setFlexGrow(2);
    expect(flags(n) & DIRTY_FLEX_DISTRIBUTION).toBe(DIRTY_FLEX_DISTRIBUTION);
  });

  test('setJustifyContent marks DIRTY_STYLE_SIG', () => {
    const n = freshNode();
    n.setJustifyContent('center');
    expect(flags(n) & DIRTY_STYLE_SIG).toBe(DIRTY_STYLE_SIG);
  });

  test('setAlignItems marks DIRTY_STYLE_SIG', () => {
    const n = freshNode();
    n.setAlignItems('center');
    expect(flags(n) & DIRTY_STYLE_SIG).toBe(DIRTY_STYLE_SIG);
  });

  test('setMargin marks DIRTY_STYLE_VALUE', () => {
    const n = freshNode();
    n.setMargin(Edge.All, 5);
    expect(flags(n) & DIRTY_STYLE_VALUE).toBe(DIRTY_STYLE_VALUE);
  });

  test('setPadding marks DIRTY_STYLE_VALUE', () => {
    const n = freshNode();
    n.setPadding(Edge.All, 5);
    expect(flags(n) & DIRTY_STYLE_VALUE).toBe(DIRTY_STYLE_VALUE);
  });

  test('setMeasureFunc marks DIRTY_MEASURE', () => {
    const n = freshNode();
    n.setMeasureFunc(() => ({ width: 10, height: 1 }));
    expect(flags(n) & DIRTY_MEASURE).toBe(DIRTY_MEASURE);
  });

  test('insertChild marks DIRTY_CHILDREN on parent', () => {
    const parent = freshNode();
    const child = Node.create();
    parent.insertChild(child, 0);
    expect(flags(parent) & DIRTY_CHILDREN).toBe(DIRTY_CHILDREN);
  });

  test('removeChild marks DIRTY_CHILDREN on parent', () => {
    const parent = freshNode();
    const child = Node.create();
    parent.insertChild(child, 0);
    // Reset after insertChild
    (parent as unknown as { _dirtyFlags: number })._dirtyFlags = 0;
    parent.removeChild(child);
    expect(flags(parent) & DIRTY_CHILDREN).toBe(DIRTY_CHILDREN);
  });

  test('multiple setters accumulate flags', () => {
    const n = freshNode();
    n.setWidth(50);
    n.setFlexDirection('row');
    n.setFlex(2);
    expect(flags(n) & DIRTY_STYLE_VALUE).toBe(DIRTY_STYLE_VALUE);
    expect(flags(n) & DIRTY_STYLE_SIG).toBe(DIRTY_STYLE_SIG);
    expect(flags(n) & DIRTY_FLEX_DISTRIBUTION).toBe(DIRTY_FLEX_DISTRIBUTION);
  });
});
