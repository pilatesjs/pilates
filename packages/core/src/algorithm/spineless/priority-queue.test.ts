import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BenderOrderMaintenance,
  NaiveOrderMaintenance,
  type OMNode,
  type OrderMaintenance,
} from './order-maintenance.js';
import { OmPriorityQueue } from './priority-queue.js';

// Run correctness suite against both OM impls — the priority queue must
// produce identical extraction order regardless of which OM is used.
const OM_IMPLS: Array<{ name: string; make: () => OrderMaintenance }> = [
  { name: 'with NaiveOrderMaintenance', make: () => new NaiveOrderMaintenance() },
  { name: 'with BenderOrderMaintenance', make: () => new BenderOrderMaintenance() },
];

for (const { name, make } of OM_IMPLS) {
  describe(`OmPriorityQueue ${name}`, () => {
    describe('basics', () => {
      it('empty queue has size 0 and isEmpty=true', () => {
        const om = make();
        const pq = new OmPriorityQueue<string>(om);
        expect(pq.size).toBe(0);
        expect(pq.isEmpty()).toBe(true);
        expect(pq.peek()).toBeUndefined();
        expect(pq.popMin()).toBeUndefined();
      });

      it('push + popMin returns the only item', () => {
        const om = make();
        const node = om.init();
        const pq = new OmPriorityQueue<string>(om);
        expect(pq.push('hello', node)).toBe(true);
        expect(pq.size).toBe(1);
        expect(pq.peek()).toBe('hello');
        expect(pq.popMin()).toBe('hello');
        expect(pq.isEmpty()).toBe(true);
      });

      it('rejects duplicate pushes; size unchanged', () => {
        const om = make();
        const a = om.init();
        const b = om.insertAfter(a);
        const pq = new OmPriorityQueue<string>(om);
        expect(pq.push('x', a)).toBe(true);
        expect(pq.push('x', b)).toBe(false); // already present
        expect(pq.size).toBe(1);
        expect(pq.has('x')).toBe(true);
      });

      it('has(value) reflects membership', () => {
        const om = make();
        const a = om.init();
        const pq = new OmPriorityQueue<string>(om);
        expect(pq.has('x')).toBe(false);
        pq.push('x', a);
        expect(pq.has('x')).toBe(true);
        pq.popMin();
        expect(pq.has('x')).toBe(false);
      });
    });

    describe('OM-ordered extraction', () => {
      it('two items extracted in OM order regardless of push order', () => {
        const om = make();
        const a = om.init();
        const b = om.insertAfter(a); // b > a in OM order
        const pq = new OmPriorityQueue<string>(om);
        pq.push('B', b);
        pq.push('A', a);
        expect(pq.popMin()).toBe('A'); // a comes first
        expect(pq.popMin()).toBe('B');
      });

      it('chain of 10 items: push in reverse, extract in OM order', () => {
        const om = make();
        const nodes: OMNode[] = [om.init()];
        for (let i = 1; i < 10; i++) nodes.push(om.insertAfter(nodes[i - 1]!));
        const pq = new OmPriorityQueue<number>(om);
        // Push in reverse order
        for (let i = 9; i >= 0; i--) pq.push(i, nodes[i]!);
        // Extract — must produce 0, 1, 2, ... 9 (OM order = ascending)
        for (let i = 0; i < 10; i++) {
          expect(pq.popMin()).toBe(i);
        }
        expect(pq.isEmpty()).toBe(true);
      });

      it('extract sequence preserves OM order after interleaved pushes', () => {
        const om = make();
        const a = om.init();
        const c = om.insertAfter(a); // c
        const b = om.insertAfter(a); // a < b < c
        const pq = new OmPriorityQueue<string>(om);
        pq.push('C', c);
        pq.push('A', a);
        pq.push('B', b);
        expect(pq.popMin()).toBe('A');
        expect(pq.popMin()).toBe('B');
        expect(pq.popMin()).toBe('C');
      });
    });

    describe('large-N invariants', () => {
      it('100 items pushed in random order extract in OM order', () => {
        const om = make();
        const nodes: OMNode[] = [om.init()];
        for (let i = 1; i < 100; i++) nodes.push(om.insertAfter(nodes[i - 1]!));
        const pq = new OmPriorityQueue<number>(om);
        // Random push order via seeded PRNG
        let seed = 42;
        const order: number[] = [];
        for (let i = 0; i < 100; i++) order.push(i);
        for (let i = order.length - 1; i > 0; i--) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          const j = seed % (i + 1);
          [order[i], order[j]] = [order[j]!, order[i]!];
        }
        for (const idx of order) pq.push(idx, nodes[idx]!);
        // Extract in OM order
        for (let i = 0; i < 100; i++) {
          expect(pq.popMin()).toBe(i);
        }
      });
    });
  });
}

// Differential property fuzzer: push/pop sequences match a sorted-array
// reference oracle. Tests heap invariant under random workloads.
//
// Each push uses a FRESH OM node (mirroring the Spineless runtime's
// invariant: one OM node per (Node, field) pair, allocated once). With
// distinct OM nodes, the priority order is total — no tie-breaking
// ambiguity to confuse the oracle.
describe('OmPriorityQueue — differential fuzzer', () => {
  const opArb = fc.oneof(
    fc.record({
      type: fc.constant('push' as const),
      // Where in the existing OM order to insert the new node (0 = start, 1 = end).
      insertPos: fc.float({ min: 0, max: 1, noNaN: true }),
      value: fc.integer({ min: 0, max: 1_000_000 }),
    }),
    fc.record({ type: fc.constant('popMin' as const) }),
  );

  it('500 random op sequences: heap extraction matches sorted-array oracle', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 200 }), (ops) => {
        const om = new BenderOrderMaintenance();
        const omAnchors: OMNode[] = [om.init()];

        const pq = new OmPriorityQueue<number>(om);
        const oracle: Array<{ value: number; omNode: OMNode }> = [];
        const inQueue = new Set<number>();

        for (const op of ops) {
          if (op.type === 'push') {
            // Insert a fresh OM node at the chosen relative position.
            const afterIdx = Math.min(
              omAnchors.length - 1,
              Math.floor(op.insertPos * omAnchors.length),
            );
            const newOm = om.insertAfter(omAnchors[afterIdx]!);
            omAnchors.push(newOm);

            const accepted = pq.push(op.value, newOm);
            if (accepted) {
              expect(inQueue.has(op.value)).toBe(false);
              oracle.push({ value: op.value, omNode: newOm });
              inQueue.add(op.value);
            } else {
              expect(inQueue.has(op.value)).toBe(true);
            }
          } else {
            // popMin
            if (oracle.length === 0) {
              expect(pq.popMin()).toBeUndefined();
            } else {
              // Find oracle's min by OM order.
              let bestIdx = 0;
              for (let i = 1; i < oracle.length; i++) {
                if (om.compare(oracle[i]!.omNode, oracle[bestIdx]!.omNode) < 0) {
                  bestIdx = i;
                }
              }
              const expected = oracle[bestIdx]!.value;
              oracle.splice(bestIdx, 1);
              inQueue.delete(expected);
              const got = pq.popMin();
              expect(got).toBe(expected);
            }
          }
          expect(pq.size).toBe(oracle.length);
        }
      }),
      { numRuns: 500 },
    );
  });
});
