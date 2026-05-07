import { describe, expect, it } from 'vitest';
import type { ContainerNode } from '@pilates/render';
import { collectHits, mouseRegistry, setMouseHandlers } from './mouse-registry.js';

const noop = (): void => {};

function makeNode(
  layout: { left: number; top: number; width: number; height: number },
  children: ContainerNode[] = [],
): ContainerNode {
  const node = { children } as ContainerNode & {
    _layout?: { left: number; top: number; width: number; height: number };
  };
  node._layout = layout;
  return node;
}

describe('setMouseHandlers', () => {
  it('stores onClick', () => {
    const node = makeNode({ left: 0, top: 0, width: 10, height: 5 });
    setMouseHandlers(node, { onClick: noop });
    expect(mouseRegistry.get(node)?.onClick).toBe(noop);
  });

  it('stores onWheel', () => {
    const node = makeNode({ left: 0, top: 0, width: 10, height: 5 });
    setMouseHandlers(node, { onWheel: noop });
    expect(mouseRegistry.get(node)?.onWheel).toBe(noop);
  });

  it('clears the entry when both handlers are absent', () => {
    const node = makeNode({ left: 0, top: 0, width: 10, height: 5 });
    setMouseHandlers(node, { onClick: noop });
    setMouseHandlers(node, {});
    expect(mouseRegistry.has(node)).toBe(false);
  });

  it('updates handlers in place when called again', () => {
    const fn1 = (): void => {};
    const fn2 = (): void => {};
    const node = makeNode({ left: 0, top: 0, width: 10, height: 5 });
    setMouseHandlers(node, { onClick: fn1 });
    setMouseHandlers(node, { onClick: fn2 });
    expect(mouseRegistry.get(node)?.onClick).toBe(fn2);
  });
});

describe('collectHits', () => {
  it('hits a node whose _layout contains the point', () => {
    const node = makeNode({ left: 0, top: 0, width: 20, height: 10 });
    const hits = collectHits(node, 5, 3);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.node).toBe(node);
    expect(hits[0]!.depth).toBe(0);
  });

  it('misses when point is outside the layout rect', () => {
    const node = makeNode({ left: 0, top: 0, width: 5, height: 5 });
    expect(collectHits(node, 10, 10)).toHaveLength(0);
  });

  it('hits on the inclusive left/top edge', () => {
    const node = makeNode({ left: 2, top: 3, width: 5, height: 4 });
    expect(collectHits(node, 2, 3)).toHaveLength(1);
  });

  it('misses on the exclusive right/bottom edge', () => {
    // left=2, width=5 → right edge is col 7 (exclusive)
    const node = makeNode({ left: 2, top: 3, width: 5, height: 4 });
    expect(collectHits(node, 7, 3)).toHaveLength(0);
    expect(collectHits(node, 2, 7)).toHaveLength(0);
  });

  it('collects parent and child when both contain the point', () => {
    const child = makeNode({ left: 2, top: 2, width: 5, height: 5 });
    const parent = makeNode({ left: 0, top: 0, width: 20, height: 10 }, [child]);
    const hits = collectHits(parent, 3, 3);
    expect(hits).toHaveLength(2);
    const nodes = hits.map((h) => h.node);
    expect(nodes).toContain(parent);
    expect(nodes).toContain(child);
  });

  it('assigns depth=0 to root and depth=1 to direct child', () => {
    const child = makeNode({ left: 0, top: 0, width: 5, height: 5 });
    const parent = makeNode({ left: 0, top: 0, width: 10, height: 10 }, [child]);
    const hits = collectHits(parent, 1, 1);
    const parentHit = hits.find((h) => h.node === parent);
    const childHit = hits.find((h) => h.node === child);
    expect(parentHit?.depth).toBe(0);
    expect(childHit?.depth).toBe(1);
  });

  it('skips nodes without _layout', () => {
    const node = { children: [] } as ContainerNode;
    expect(collectHits(node, 5, 5)).toHaveLength(0);
  });

  it('only hits parent when child does not contain the point', () => {
    const child = makeNode({ left: 10, top: 5, width: 5, height: 3 });
    const parent = makeNode({ left: 0, top: 0, width: 20, height: 10 }, [child]);
    const hits = collectHits(parent, 1, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.node).toBe(parent);
  });

  it('skips text nodes (nodes with a text property)', () => {
    const textNode = { text: 'hello' } as unknown as ContainerNode;
    const parent = makeNode({ left: 0, top: 0, width: 20, height: 10 }, [textNode]);
    const hits = collectHits(parent, 5, 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.node).toBe(parent);
  });
});
