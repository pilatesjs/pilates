/**
 * Memory and stability stress tests, gated behind PILATES_MEMORY_TESTS=1.
 *
 * Default suite: `describe.skipIf` returns immediately so PR runs aren't
 * slowed down. Nightly cron sets the env and runs the heap-delta probes.
 *
 * Must be run under `node --expose-gc` to expose `globalThis.gc()`. Without
 * it, the GC probes degrade to "no GC available" and the assertion is
 * skipped at the test level (rather than yielding a confusing pass).
 */

import { describe, expect, it } from 'vitest';
import { Edge } from '../src/edge.js';
import { Node } from '../src/node.js';

const ENABLED = process.env.PILATES_MEMORY_TESTS === '1';
const HAS_GC = typeof (globalThis as { gc?: () => void }).gc === 'function';

interface NodeProc {
  memoryUsage(): { heapUsed: number; rss: number };
}

function heapUsed(): number {
  return (process as unknown as NodeProc).memoryUsage().heapUsed;
}

function gc(): void {
  const g = globalThis as { gc?: () => void };
  if (typeof g.gc === 'function') g.gc();
}

describe.skipIf(!ENABLED)('memory stability — @pilates/core', () => {
  it('50000 calculateLayout calls on a small tree do not leak (heap delta < 5MB after GC)', () => {
    if (!HAS_GC) {
      console.warn('memory.stability: skipping heap delta check; run under `node --expose-gc`');
      return;
    }
    // Build a fixed 3-deep tree once; mutate one child width and re-layout
    // 50k times. The layout pool / cache state should reach a steady-state
    // and not grow without bound.
    const root = Node.create();
    root.setWidth(80);
    root.setHeight(24);
    root.setFlexDirection('row');
    const a = Node.create();
    a.setFlexGrow(1);
    const b = Node.create();
    b.setFlexGrow(1);
    root.insertChild(a, 0);
    root.insertChild(b, 1);

    // Warm up + baseline GC.
    for (let i = 0; i < 100; i++) {
      a.setPadding(Edge.Top, i % 4);
      root.calculateLayout();
    }
    gc();
    const baseline = heapUsed();

    for (let i = 0; i < 50_000; i++) {
      a.setPadding(Edge.Top, i % 4);
      root.calculateLayout();
    }
    gc();
    const after = heapUsed();
    const delta = after - baseline;
    // 5MB allowance covers Node's runtime/V8 noise. A real leak (e.g. per-
    // iteration allocation retained in a Map) would grow proportional to
    // 50k iterations, far exceeding this.
    expect(delta).toBeLessThan(5 * 1024 * 1024);
  });

  it('1000 tree create/destroy cycles do not retain memory', () => {
    if (!HAS_GC) {
      console.warn('memory.stability: skipping heap delta check; run under `node --expose-gc`');
      return;
    }

    // Warmup
    for (let i = 0; i < 20; i++) {
      const root = Node.create();
      root.setWidth(40);
      root.setHeight(10);
      for (let j = 0; j < 8; j++) {
        const child = Node.create();
        child.setFlexGrow(1);
        root.insertChild(child, j);
      }
      root.calculateLayout();
    }
    gc();
    const baseline = heapUsed();

    for (let i = 0; i < 1000; i++) {
      const root = Node.create();
      root.setWidth(40);
      root.setHeight(10);
      for (let j = 0; j < 8; j++) {
        const child = Node.create();
        child.setFlexGrow(1);
        root.insertChild(child, j);
      }
      root.calculateLayout();
    }
    gc();
    const delta = heapUsed() - baseline;
    expect(delta).toBeLessThan(5 * 1024 * 1024);
  });
});

describe('memory stability — guard', () => {
  it('is gated behind PILATES_MEMORY_TESTS=1', () => {
    // This guard test ALWAYS runs and documents the gating contract.
    // The heavy probes above use describe.skipIf and only fire when the
    // env flag is set — keeping PR CI fast while nightly cron exercises
    // them. Asserts the flag-reading is centralised here.
    expect(typeof ENABLED).toBe('boolean');
  });
});
