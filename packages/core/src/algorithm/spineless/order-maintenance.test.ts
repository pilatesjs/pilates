import { describe, expect, it } from 'vitest';
import { NaiveOrderMaintenance, type OMNode } from './order-maintenance.js';

describe('NaiveOrderMaintenance', () => {
  describe('init', () => {
    it('returns a first node and reports size=1', () => {
      const om = new NaiveOrderMaintenance();
      expect(om.size).toBe(0);
      const first = om.init();
      expect(om.size).toBe(1);
      expect(first).toBeDefined();
      // compare(x, x) must equal 0
      expect(om.compare(first, first)).toBe(0);
    });
  });

  describe('insertAfter', () => {
    it('inserts a node after the first; new node compares > first', () => {
      const om = new NaiveOrderMaintenance();
      const a = om.init();
      const b = om.insertAfter(a);
      expect(om.size).toBe(2);
      expect(om.compare(a, b)).toBeLessThan(0);
      expect(om.compare(b, a)).toBeGreaterThan(0);
    });

    it('inserting between two nodes places the new one in the middle', () => {
      const om = new NaiveOrderMaintenance();
      const a = om.init();
      const c = om.insertAfter(a);
      const b = om.insertAfter(a); // between a and c
      // Order: a < b < c
      expect(om.compare(a, b)).toBeLessThan(0);
      expect(om.compare(b, c)).toBeLessThan(0);
      expect(om.compare(a, c)).toBeLessThan(0);
    });

    it('chain of 100 inserts is correctly ordered', () => {
      const om = new NaiveOrderMaintenance();
      const nodes: OMNode[] = [om.init()];
      for (let i = 1; i < 100; i++) {
        nodes.push(om.insertAfter(nodes[i - 1]!));
      }
      // Every consecutive pair must be ordered
      for (let i = 0; i < 99; i++) {
        expect(om.compare(nodes[i]!, nodes[i + 1]!)).toBeLessThan(0);
      }
      // Random non-adjacent pairs
      expect(om.compare(nodes[0]!, nodes[99]!)).toBeLessThan(0);
      expect(om.compare(nodes[42]!, nodes[7]!)).toBeGreaterThan(0);
    });

    it('insertAfter in the middle preserves invariants across the whole list', () => {
      const om = new NaiveOrderMaintenance();
      const nodes: OMNode[] = [om.init()];
      for (let i = 1; i < 20; i++) {
        nodes.push(om.insertAfter(nodes[i - 1]!));
      }
      // Insert 10 new nodes between [5] and [6]
      let prev = nodes[5]!;
      const inserted: OMNode[] = [];
      for (let i = 0; i < 10; i++) {
        const n = om.insertAfter(prev);
        inserted.push(n);
        prev = n;
      }
      // All original nodes before position 5 must still be < node[5]
      for (let i = 0; i < 5; i++) {
        expect(om.compare(nodes[i]!, nodes[5]!)).toBeLessThan(0);
      }
      // node[5] is before all inserted; inserted are before node[6]
      for (const ins of inserted) {
        expect(om.compare(nodes[5]!, ins)).toBeLessThan(0);
        expect(om.compare(ins, nodes[6]!)).toBeLessThan(0);
      }
      // Original nodes after position 6 must still be > node[6]
      for (let i = 7; i < 20; i++) {
        expect(om.compare(nodes[6]!, nodes[i]!)).toBeLessThan(0);
      }
    });
  });

  describe('delete', () => {
    it('removing a node preserves order of remaining', () => {
      const om = new NaiveOrderMaintenance();
      const a = om.init();
      const b = om.insertAfter(a);
      const c = om.insertAfter(b);
      expect(om.size).toBe(3);
      om.delete(b);
      expect(om.size).toBe(2);
      expect(om.compare(a, c)).toBeLessThan(0);
    });

    it('deleting head then inserting again', () => {
      const om = new NaiveOrderMaintenance();
      const a = om.init();
      const b = om.insertAfter(a);
      const c = om.insertAfter(b);
      om.delete(a);
      const d = om.insertAfter(b);
      // Order: b < d < c
      expect(om.compare(b, d)).toBeLessThan(0);
      expect(om.compare(d, c)).toBeLessThan(0);
    });

    it('deleting the only node leaves size=0', () => {
      const om = new NaiveOrderMaintenance();
      const a = om.init();
      om.delete(a);
      expect(om.size).toBe(0);
    });
  });

  describe('compare', () => {
    it('compare(x, x) is 0', () => {
      const om = new NaiveOrderMaintenance();
      const a = om.init();
      expect(om.compare(a, a)).toBe(0);
    });

    it('compare is antisymmetric: sign(compare(a,b)) == -sign(compare(b,a))', () => {
      const om = new NaiveOrderMaintenance();
      const a = om.init();
      const b = om.insertAfter(a);
      const c = om.insertAfter(b);
      const cmp = (x: OMNode, y: OMNode): number => Math.sign(om.compare(x, y));
      for (const x of [a, b, c]) {
        for (const y of [a, b, c]) {
          if (x === y) continue;
          expect(cmp(x, y)).toBe(-cmp(y, x));
        }
      }
    });

    it('compare is transitive: a<b and b<c implies a<c', () => {
      const om = new NaiveOrderMaintenance();
      const nodes: OMNode[] = [om.init()];
      for (let i = 1; i < 10; i++) {
        nodes.push(om.insertAfter(nodes[i - 1]!));
      }
      for (let i = 0; i < 10; i++) {
        for (let j = i + 1; j < 10; j++) {
          for (let k = j + 1; k < 10; k++) {
            expect(om.compare(nodes[i]!, nodes[j]!)).toBeLessThan(0);
            expect(om.compare(nodes[j]!, nodes[k]!)).toBeLessThan(0);
            expect(om.compare(nodes[i]!, nodes[k]!)).toBeLessThan(0);
          }
        }
      }
    });
  });

  describe('large-N invariants', () => {
    it('1000 sequential inserts: every pair correctly ordered', () => {
      const om = new NaiveOrderMaintenance();
      const N = 1000;
      const nodes: OMNode[] = [om.init()];
      for (let i = 1; i < N; i++) {
        nodes.push(om.insertAfter(nodes[i - 1]!));
      }
      expect(om.size).toBe(N);
      // Spot-check 100 random pairs
      let seed = 12345;
      const rand = (): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let k = 0; k < 100; k++) {
        const i = Math.floor(rand() * N);
        const j = Math.floor(rand() * N);
        if (i === j) continue;
        const cmp = om.compare(nodes[i]!, nodes[j]!);
        if (i < j) expect(cmp).toBeLessThan(0);
        else expect(cmp).toBeGreaterThan(0);
      }
    });

    it('mixed insert/delete sequence preserves order semantics', () => {
      const om = new NaiveOrderMaintenance();
      const nodes: OMNode[] = [om.init()];
      // Build up
      for (let i = 1; i < 50; i++) nodes.push(om.insertAfter(nodes[i - 1]!));
      // Delete every other node
      const deleted = new Set<number>();
      for (let i = 1; i < 50; i += 2) {
        om.delete(nodes[i]!);
        deleted.add(i);
      }
      // Compare every surviving pair
      const survivors: number[] = [];
      for (let i = 0; i < 50; i++) if (!deleted.has(i)) survivors.push(i);
      for (let a = 0; a < survivors.length; a++) {
        for (let b = a + 1; b < survivors.length; b++) {
          expect(om.compare(nodes[survivors[a]!]!, nodes[survivors[b]!]!)).toBeLessThan(0);
        }
      }
    });
  });
});
