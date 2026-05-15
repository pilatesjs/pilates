/**
 * Tests for `createStyleDirtier` — the `markStyleDirty(node, prop)`
 * convenience over `buildFlexGrammar(...).styleInputs`.
 *
 * Each case mutates a style prop, calls the bound dirtier, then
 * `recompute()`, and asserts the layout matches a fresh build.
 */

import { describe, expect, it } from 'vitest';
import { Edge } from '../../edge.js';
import { Node } from '../../node.js';
import { buildFlexGrammar } from './flex-grammar.js';
import type { Field } from './grammar.js';
import { SpinelessRuntime } from './runtime.js';
import { createStyleDirtier } from './style-dirty.js';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function readLayout(
  rt: SpinelessRuntime,
  allFields: ReadonlyArray<{
    node: Node;
    width: Field<number>;
    height: Field<number>;
    left: Field<number>;
    top: Field<number>;
  }>,
): Box[] {
  const floatByNode = new Map<Node, Box>();
  for (const f of allFields) {
    floatByNode.set(f.node, {
      left: rt.evaluate(f.left),
      top: rt.evaluate(f.top),
      width: rt.evaluate(f.width),
      height: rt.evaluate(f.height),
    });
  }
  const out: Box[] = [];
  const root = allFields[0]!.node;
  function visit(
    n: Node,
    parentAbsX: number,
    parentAbsY: number,
    parentRoundedX: number,
    parentRoundedY: number,
  ): void {
    const f = floatByNode.get(n)!;
    const absX = parentAbsX + f.left;
    const absY = parentAbsY + f.top;
    const roundedX = Math.round(absX);
    const roundedY = Math.round(absY);
    const roundedR = Math.round(absX + f.width);
    const roundedB = Math.round(absY + f.height);
    out.push({
      left: roundedX - parentRoundedX,
      top: roundedY - parentRoundedY,
      width: Math.max(0, roundedR - roundedX),
      height: Math.max(0, roundedB - roundedY),
    });
    for (let i = 0; i < n.getChildCount(); i++) {
      visit(n.getChild(i)!, absX, absY, roundedX, roundedY);
    }
  }
  visit(root, 0, 0, 0, 0);
  return out;
}

function freshLayout(root: Node): Box[] {
  const { grammar, allFields } = buildFlexGrammar(root);
  const rootFields: Field<unknown>[] = [];
  for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
  const rt = new SpinelessRuntime(grammar, rootFields);
  rt.init();
  return readLayout(rt, allFields);
}

function rowOfChildren(count: number): { root: Node; children: Node[] } {
  const root = Node.create();
  root.setWidth(200);
  root.setHeight(40);
  root.setFlexDirection('row');
  const children: Node[] = [];
  for (let i = 0; i < count; i++) {
    const c = Node.create();
    c.setWidth(20);
    c.setHeight(20);
    root.insertChild(c, i);
    children.push(c);
  }
  return { root, children };
}

function buildRuntime(root: Node): {
  rt: SpinelessRuntime;
  allFields: ReturnType<typeof buildFlexGrammar>['allFields'];
  styleInputs: ReturnType<typeof buildFlexGrammar>['styleInputs'];
} {
  const { grammar, allFields, styleInputs } = buildFlexGrammar(root);
  const rootFields: Field<unknown>[] = [];
  for (const f of allFields) rootFields.push(f.width, f.height, f.left, f.top);
  const rt = new SpinelessRuntime(grammar, rootFields);
  rt.init();
  return { rt, allFields, styleInputs };
}

describe('createStyleDirtier — scalar props', () => {
  it('drives a width mutation', () => {
    const { root, children } = rowOfChildren(3);
    const { rt, allFields, styleInputs } = buildRuntime(root);
    const markStyleDirty = createStyleDirtier(rt, styleInputs);

    children[1]!.setWidth(55);
    markStyleDirty(children[1]!, 'width');
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('drives a flex-grow mutation', () => {
    const { root, children } = rowOfChildren(3);
    for (const c of children) c.setFlexGrow(1);
    const { rt, allFields, styleInputs } = buildRuntime(root);
    const markStyleDirty = createStyleDirtier(rt, styleInputs);

    children[0]!.setFlexGrow(3);
    markStyleDirty(children[0]!, 'flexGrow');
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('drives a gap mutation', () => {
    const { root } = rowOfChildren(3);
    const { rt, allFields, styleInputs } = buildRuntime(root);
    const markStyleDirty = createStyleDirtier(rt, styleInputs);

    root.setGap('column', 12);
    markStyleDirty(root, 'gapColumn');
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });
});

describe('createStyleDirtier — edge props', () => {
  it('drives a padding-edge mutation', () => {
    const { root } = rowOfChildren(3);
    const { rt, allFields, styleInputs } = buildRuntime(root);
    const markStyleDirty = createStyleDirtier(rt, styleInputs);

    root.setPadding(Edge.Left, 13);
    markStyleDirty(root, 'padding', Edge.Left);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });

  it('drives a margin-edge mutation', () => {
    const { root, children } = rowOfChildren(3);
    const { rt, allFields, styleInputs } = buildRuntime(root);
    const markStyleDirty = createStyleDirtier(rt, styleInputs);

    children[1]!.setMargin(Edge.Left, 9);
    markStyleDirty(children[1]!, 'margin', Edge.Left);
    rt.recompute();

    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });
});

describe('createStyleDirtier — defensive', () => {
  it('throws for a node not in the grammar', () => {
    const { root } = rowOfChildren(2);
    const { rt, styleInputs } = buildRuntime(root);
    const markStyleDirty = createStyleDirtier(rt, styleInputs);

    const stranger = Node.create();
    stranger.setWidth(10);
    stranger.setHeight(10);
    expect(() => markStyleDirty(stranger, 'width')).toThrow(/no style inputs/);
  });

  it('throws when an edge prop is called without an edge', () => {
    const { root } = rowOfChildren(2);
    const { rt, styleInputs } = buildRuntime(root);
    const markStyleDirty = createStyleDirtier(rt, styleInputs);

    // @ts-expect-error — edge is required for 'padding'
    expect(() => markStyleDirty(root, 'padding')).toThrow(/requires an edge/);
  });

  it('is a no-op when the grammar emits no Field for the prop', () => {
    // A childless leaf never has its padding read, so the grammar
    // emits no padding input for it. markStyleDirty must not throw.
    const { root, children } = rowOfChildren(1);
    const { rt, allFields, styleInputs } = buildRuntime(root);
    const markStyleDirty = createStyleDirtier(rt, styleInputs);

    const leaf = children[0]!;
    leaf.setPadding(Edge.Top, 4);
    expect(() => markStyleDirty(leaf, 'padding', Edge.Top)).not.toThrow();
    rt.recompute();

    // Padding on a childless leaf changes nothing.
    expect(readLayout(rt, allFields)).toEqual(freshLayout(root));
  });
});
