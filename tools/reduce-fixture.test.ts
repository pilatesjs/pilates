import { describe, expect, it } from 'vitest';
import {
  allNodesHaveIds,
  assignIds,
  emitConsensus,
  emitDivergent,
  mapsEqual,
  parseArgs,
} from './reduce-fixture.js';

describe('reduce-fixture helpers', () => {
  describe('allNodesHaveIds', () => {
    it('true when every node has a string id', () => {
      expect(
        allNodesHaveIds({
          id: 'a',
          children: [{ id: 'b' }, { id: 'c', children: [{ id: 'd' }] }],
        }),
      ).toBe(true);
    });
    it('false when a leaf lacks an id', () => {
      expect(allNodesHaveIds({ id: 'a', children: [{}] })).toBe(false);
    });
    it('false when root lacks an id', () => {
      expect(allNodesHaveIds({ children: [{ id: 'a' }] })).toBe(false);
    });
  });

  describe('assignIds', () => {
    it('assigns n0/n1/n2/... in DFS pre-order', () => {
      const out = assignIds({
        children: [{}, { children: [{}, {}] }, {}],
      });
      const collect: string[] = [];
      function walk(n: { id: string; children?: { id: string; children?: unknown }[] }): void {
        collect.push(n.id);
        for (const c of n.children ?? []) walk(c as { id: string; children?: never });
      }
      walk(out as { id: string; children?: never });
      expect(collect).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
    });
    it('preserves the style field', () => {
      const out = assignIds({ style: { width: 10 } });
      expect(out.style).toEqual({ width: 10 });
    });
  });

  describe('mapsEqual', () => {
    const a = { x: { left: 0, top: 0, width: 1, height: 1 } };
    const b = { x: { left: 0, top: 0, width: 1, height: 1 } };
    const c = { x: { left: 1, top: 0, width: 1, height: 1 } };
    it('true for deep-equal maps', () => expect(mapsEqual(a, b)).toBe(true));
    it('false for box mismatch', () => expect(mapsEqual(a, c)).toBe(false));
    it('false for key-set mismatch', () =>
      expect(mapsEqual(a, { ...a, y: { left: 0, top: 0, width: 1, height: 1 } })).toBe(false));
  });

  describe('emit shapes', () => {
    const tree = { id: 'r', style: { width: 1, height: 1 } };
    const box = { r: { left: 0, top: 0, width: 1, height: 1 } };
    it('consensus emits the caller-supplied tags', () => {
      const out = emitConsensus('x', undefined, ['gap'], tree, box) as Record<string, unknown>;
      expect(out.expected).toEqual(box);
      expect(out.expectedPilates).toBeUndefined();
      expect(out.expectedYoga).toBeUndefined();
      expect(out.divergenceReason).toBeUndefined();
      expect(out.tags).toEqual(['gap']);
    });
    it('consensus rejects empty tags', () => {
      expect(() => emitConsensus('x', undefined, [], tree, box)).toThrow(/at least one --tag/);
    });
    it('divergent auto-appends the divergent tag if absent', () => {
      const out = emitDivergent('x', undefined, ['overflow'], tree, box, box) as Record<
        string,
        unknown
      >;
      expect(out.expected).toBeUndefined();
      expect(out.expectedPilates).toEqual(box);
      expect(out.expectedYoga).toEqual(box);
      expect(out.divergenceReason).toBe('<TODO: fill in>');
      expect(out.tags).toEqual(['overflow', 'divergent']);
    });
    it('divergent keeps tags as-is if divergent already present', () => {
      const out = emitDivergent(
        'x',
        undefined,
        ['divergent', 'gap'],
        tree,
        box,
        box,
      ) as Record<string, unknown>;
      expect(out.tags).toEqual(['divergent', 'gap']);
    });
  });

  describe('parseArgs --tag', () => {
    it('collects multiple tags', () => {
      const opts = parseArgs(['input.json', '--tag', 'gap', '--tag', 'overflow']);
      expect(opts.tags).toEqual(['gap', 'overflow']);
    });
    it('rejects unknown tags', () => {
      expect(() => parseArgs(['input.json', '--tag', 'bogus'])).toThrow(/not in:/);
    });
    it('dedupes repeated tags', () => {
      const opts = parseArgs(['input.json', '--tag', 'gap', '--tag', 'gap']);
      expect(opts.tags).toEqual(['gap']);
    });
    it('requires a value after --tag', () => {
      expect(() => parseArgs(['input.json', '--tag'])).toThrow(/--tag requires a value/);
    });
  });
});
