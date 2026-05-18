import { describe, expect, it } from 'vitest';
import { inspectLayout } from './inspect.js';
import { Node } from './node.js';

/**
 * The engine-path prefix comes from `calculateLayout` recording the
 * path per root — differential mode takes a separate code path and
 * records nothing, so the path-prefix test skips there.
 */
const DIFFERENTIAL = process.env.PILATES_DIFFERENTIAL_LAYOUT === '1';

describe('inspectLayout (phase 9)', () => {
  it('dumps one indented line per node with computed boxes', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(40);
    root.setFlexDirection('row');
    for (let i = 0; i < 2; i++) {
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(40);
      root.insertChild(c, i);
    }
    root.calculateLayout(100, 40);

    const lines = inspectLayout(root).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('0,0 100x40');
    expect(lines[1]).toBe('  0,0 30x40');
    expect(lines[2]).toBe('  30,0 30x40');
  });

  it('flags a scrolling subtree with its content extent', () => {
    const root = Node.create();
    root.setWidth(20);
    root.setHeight(30);
    root.setOverflow('scroll');
    const wide = Node.create();
    wide.setWidth(50);
    wide.setHeight(10);
    root.insertChild(wide, 0);
    root.calculateLayout(20, 30);

    // Content runs to x=50 — past the 20-wide box.
    expect(inspectLayout(root).split('\n')[0]).toContain('scroll=50x30');
  });

  it('flags a node mutated but not yet relaid as dirty', () => {
    const root = Node.create();
    root.setWidth(100);
    root.setHeight(40);
    root.setFlexDirection('row');
    const a = Node.create();
    a.setWidth(30);
    a.setHeight(40);
    root.insertChild(a, 0);
    root.calculateLayout(100, 40);

    // A layout leaves the tree clean.
    expect(inspectLayout(root)).not.toContain('dirty');
    a.setWidth(50); // mutate, do not relay
    expect(inspectLayout(root)).toContain('dirty');
  });

  it('an un-laid-out tree dumps zero boxes with no path prefix', () => {
    const root = Node.create();
    root.insertChild(Node.create(), 0);

    const lines = inspectLayout(root).split('\n');
    expect(lines).toHaveLength(2);
    // No engine-path prefix — the box starts the line directly.
    expect(lines[0]!.startsWith('0,0 0x0')).toBe(true);
  });

  it.skipIf(DIFFERENTIAL)('prefixes the root line with the engine path', () => {
    const root = Node.create();
    root.setWidth(60);
    root.setHeight(20);

    root.calculateLayout(60, 20); // cold first layout — imperative
    expect(inspectLayout(root).split('\n')[0]).toMatch(/^imperative {2}/);

    root.calculateLayout(60, 20); // 2nd layout — Spineless adopts, builds
    expect(inspectLayout(root).split('\n')[0]).toMatch(/^build {2}/);
  });
});
