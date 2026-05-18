import { describe, expect, it } from 'vitest';
import { Node } from '../../node.js';
import { buildFlexGrammar } from './flex-grammar.js';
import { type Field, type FieldRule, type Grammar, TopoInterpreter, field } from './grammar.js';
import { SpinelessRuntime } from './runtime.js';

/**
 * Build a tiny hand-rolled grammar for runtime tests.
 *
 *   A: returns 1 (no deps, but uses an external counter so we can
 *      force-change its output by mutating the closure variable)
 *   B: returns A + 10
 *   C: returns B * 2
 *   D: returns A + C
 *
 * The toggleA() helper changes A's return value; the test then calls
 * markDirty(A) and recompute() and expects B, C, D to update too.
 */
function buildToyGrammar(): {
  grammar: Grammar;
  fields: { A: Field<number>; B: Field<number>; C: Field<number>; D: Field<number> };
  toggleA: (value: number) => void;
} {
  // Hold three nodes so `field()` can key the four fields off something
  // real (we need any Node instance to give to `field()`).
  const node = Node.create();
  node.setWidth(1);
  node.setHeight(1);
  const A = field<number>(node, 'A');
  const B = field<number>(node, 'B');
  const C = field<number>(node, 'C');
  const D = field<number>(node, 'D');

  let aValue = 1;
  const grammar: Grammar = new Map();
  grammar.set(A as Field<unknown>, {
    deps: [],
    compute: () => aValue,
  } satisfies FieldRule<number>);
  grammar.set(B as Field<unknown>, {
    deps: [A as Field<unknown>],
    compute: (read) => read(A) + 10,
  } satisfies FieldRule<number>);
  grammar.set(C as Field<unknown>, {
    deps: [B as Field<unknown>],
    compute: (read) => read(B) * 2,
  } satisfies FieldRule<number>);
  grammar.set(D as Field<unknown>, {
    deps: [A as Field<unknown>, C as Field<unknown>],
    compute: (read) => read(A) + read(C),
  } satisfies FieldRule<number>);

  return {
    grammar,
    fields: { A, B, C, D },
    toggleA: (v) => {
      aValue = v;
    },
  };
}

describe('SpinelessRuntime', () => {
  describe('init', () => {
    it('computes every reachable field in topo order', () => {
      const { grammar, fields } = buildToyGrammar();
      const rt = new SpinelessRuntime(grammar, [fields.D]);
      rt.init();
      expect(rt.evaluate(fields.A)).toBe(1);
      expect(rt.evaluate(fields.B)).toBe(11);
      expect(rt.evaluate(fields.C)).toBe(22);
      expect(rt.evaluate(fields.D)).toBe(23);
    });

    it('throws when evaluating a field that was never reached from roots', () => {
      const { grammar, fields } = buildToyGrammar();
      const rt = new SpinelessRuntime(grammar, [fields.B]);
      rt.init();
      // C is not reachable from B (the dep chain only walks B → A).
      expect(() => rt.evaluate(fields.C)).toThrow(/not computed/);
    });

    it('throws on a cycle in the grammar', () => {
      const node = Node.create();
      node.setWidth(1);
      node.setHeight(1);
      const X = field<number>(node, 'X');
      const Y = field<number>(node, 'Y');
      const grammar: Grammar = new Map();
      grammar.set(X as Field<unknown>, {
        deps: [Y as Field<unknown>],
        compute: (read) => read(Y) + 1,
      } satisfies FieldRule<number>);
      grammar.set(Y as Field<unknown>, {
        deps: [X as Field<unknown>],
        compute: (read) => read(X) + 1,
      } satisfies FieldRule<number>);
      const rt = new SpinelessRuntime(grammar, [X]);
      expect(() => rt.init()).toThrow(/cycle/);
    });

    it('throws when a field has no rule registered', () => {
      const node = Node.create();
      node.setWidth(1);
      node.setHeight(1);
      const X = field<number>(node, 'X');
      const Y = field<number>(node, 'Y');
      const grammar: Grammar = new Map();
      // X depends on Y, but Y has no rule.
      grammar.set(X as Field<unknown>, {
        deps: [Y as Field<unknown>],
        compute: (read) => read(Y),
      } satisfies FieldRule<number>);
      const rt = new SpinelessRuntime(grammar, [X]);
      expect(() => rt.init()).toThrow(/no rule/);
    });
  });

  describe('markDirty + recompute', () => {
    it('propagates a leaf change to all transitive dependents', () => {
      const { grammar, fields, toggleA } = buildToyGrammar();
      const rt = new SpinelessRuntime(grammar, [fields.D]);
      rt.init();

      toggleA(5);
      rt.markDirty(fields.A);
      rt.recompute();

      expect(rt.evaluate(fields.A)).toBe(5);
      expect(rt.evaluate(fields.B)).toBe(15);
      expect(rt.evaluate(fields.C)).toBe(30);
      expect(rt.evaluate(fields.D)).toBe(35);
    });

    it('stops propagating when a recompute yields the same value', () => {
      // Track the number of times each compute fires. If A's value
      // returns unchanged, B/C/D should NOT be recomputed despite
      // markDirty(A).
      const node = Node.create();
      node.setWidth(1);
      node.setHeight(1);
      const A = field<number>(node, 'A');
      const B = field<number>(node, 'B');
      let aRuns = 0;
      let bRuns = 0;
      const grammar: Grammar = new Map();
      grammar.set(A as Field<unknown>, {
        deps: [],
        compute: () => {
          aRuns += 1;
          return 42;
        },
      } satisfies FieldRule<number>);
      grammar.set(B as Field<unknown>, {
        deps: [A as Field<unknown>],
        compute: (read) => {
          bRuns += 1;
          return read(A) + 1;
        },
      } satisfies FieldRule<number>);
      const rt = new SpinelessRuntime(grammar, [B]);
      rt.init();
      expect(aRuns).toBe(1);
      expect(bRuns).toBe(1);

      rt.markDirty(A);
      rt.recompute();
      // A re-ran and returned 42 (same as before). B should NOT have re-run.
      expect(aRuns).toBe(2);
      expect(bRuns).toBe(1);
    });

    it('processes multiple dirty roots in topological (OM) order', () => {
      // A → B → C → D dependency chain. Mark all four dirty. Their
      // computes must run in order A, B, C, D (so the read of a dep
      // sees the freshly recomputed value).
      const { grammar, fields, toggleA } = buildToyGrammar();
      const rt = new SpinelessRuntime(grammar, [fields.D]);
      rt.init();

      toggleA(7);
      rt.markDirty(fields.A);
      rt.markDirty(fields.B);
      rt.markDirty(fields.C);
      rt.markDirty(fields.D);
      rt.recompute();

      expect(rt.evaluate(fields.A)).toBe(7);
      expect(rt.evaluate(fields.B)).toBe(17);
      expect(rt.evaluate(fields.C)).toBe(34);
      expect(rt.evaluate(fields.D)).toBe(41);
    });

    it('markDirty on the same field twice deduplicates', () => {
      const { grammar, fields, toggleA } = buildToyGrammar();
      const rt = new SpinelessRuntime(grammar, [fields.D]);
      rt.init();
      toggleA(3);
      rt.markDirty(fields.A);
      rt.markDirty(fields.A); // no-op
      rt.recompute();
      expect(rt.evaluate(fields.D)).toBe(3 + (3 + 10) * 2);
    });

    it('recompute on an empty queue is a no-op', () => {
      const { grammar, fields } = buildToyGrammar();
      const rt = new SpinelessRuntime(grammar, [fields.D]);
      rt.init();
      expect(() => rt.recompute()).not.toThrow();
      expect(rt.evaluate(fields.D)).toBe(23);
    });
  });

  describe('defensive errors', () => {
    it('markDirty throws when called before init', () => {
      const { grammar, fields } = buildToyGrammar();
      const rt = new SpinelessRuntime(grammar, [fields.D]);
      expect(() => rt.markDirty(fields.A)).toThrow(/before init/);
    });

    it('recompute throws when called before init', () => {
      const { grammar, fields } = buildToyGrammar();
      const rt = new SpinelessRuntime(grammar, [fields.D]);
      expect(() => rt.recompute()).toThrow(/before init/);
    });

    it('markDirty throws on a field that was not reachable at init', () => {
      const { grammar, fields } = buildToyGrammar();
      // B's chain reaches A but not C or D.
      const rt = new SpinelessRuntime(grammar, [fields.B]);
      rt.init();
      expect(() => rt.markDirty(fields.D)).toThrow(/not in this runtime/);
    });

    it('compute throws when a rule reads an undeclared dep', () => {
      const node = Node.create();
      node.setWidth(1);
      node.setHeight(1);
      const X = field<number>(node, 'X');
      const Y = field<number>(node, 'Y');
      const grammar: Grammar = new Map();
      grammar.set(Y as Field<unknown>, {
        deps: [],
        compute: () => 7,
      } satisfies FieldRule<number>);
      // X's deps list is empty, but its compute illegally reads Y.
      grammar.set(X as Field<unknown>, {
        deps: [],
        compute: (read) => read(Y) + 1,
      } satisfies FieldRule<number>);
      const rt = new SpinelessRuntime(grammar, [X]);
      expect(() => rt.init()).toThrow(/did not declare it as a dependency/);
    });
  });

  describe('stats counters (phase 9)', () => {
    it('initFields equals the grammar size after init; recompute counters start at 0', () => {
      const { grammar, fields } = buildToyGrammar();
      const rt = new SpinelessRuntime(grammar, [fields.D]);
      rt.init();
      expect(rt.stats.initFields).toBe(4); // A, B, C, D
      expect(rt.stats.recomputeVisited).toBe(0);
      expect(rt.stats.recomputeChanged).toBe(0);
      expect(rt.stats.totalVisited).toBe(0);
    });

    it('a propagating recompute visits and changes every transitive dependent', () => {
      const { grammar, fields, toggleA } = buildToyGrammar();
      const rt = new SpinelessRuntime(grammar, [fields.D]);
      rt.init();

      toggleA(5);
      rt.markDirty(fields.A);
      rt.recompute();

      // A changed → B, C, D each re-run once and each change value.
      expect(rt.stats.recomputeVisited).toBe(4);
      expect(rt.stats.recomputeChanged).toBe(4);
      expect(rt.stats.recomputeVisited).toBeGreaterThanOrEqual(rt.stats.recomputeChanged);
    });

    it('a no-op recompute visits the dirty field but changes nothing', () => {
      const { grammar, fields } = buildToyGrammar();
      const rt = new SpinelessRuntime(grammar, [fields.D]);
      rt.init();

      // A re-computes to its current value (toggleA never called) — so
      // it visits 1 field and propagates to none.
      rt.markDirty(fields.A);
      rt.recompute();
      expect(rt.stats.recomputeVisited).toBe(1);
      expect(rt.stats.recomputeChanged).toBe(0);
    });

    it('recompute counters reflect only the most recent recompute()', () => {
      const { grammar, fields, toggleA } = buildToyGrammar();
      const rt = new SpinelessRuntime(grammar, [fields.D]);
      rt.init();

      toggleA(5);
      rt.markDirty(fields.A);
      rt.recompute();
      expect(rt.stats.recomputeVisited).toBe(4);

      // A second recompute that changes nothing resets the per-call
      // counters — they are not cumulative.
      rt.markDirty(fields.A);
      rt.recompute();
      expect(rt.stats.recomputeVisited).toBe(1);
      expect(rt.stats.recomputeChanged).toBe(0);
    });

    it('totalVisited accumulates across recompute() calls', () => {
      const { grammar, fields, toggleA } = buildToyGrammar();
      const rt = new SpinelessRuntime(grammar, [fields.D]);
      rt.init();

      toggleA(5);
      rt.markDirty(fields.A);
      rt.recompute(); // visits 4
      rt.markDirty(fields.A);
      rt.recompute(); // visits 1 (no-op)
      expect(rt.stats.totalVisited).toBe(5);
    });

    it('graft raises initFields by the number of new fields', () => {
      const { grammar, fields } = buildToyGrammar();
      const rt = new SpinelessRuntime(grammar, [fields.D]);
      rt.init();
      expect(rt.stats.initFields).toBe(4);

      // Graft a pure tail field E = A + 100 (A is an existing boundary).
      const node = Node.create();
      node.setWidth(1);
      node.setHeight(1);
      const E = field<number>(node, 'E');
      const additions: Grammar = new Map();
      additions.set(E as Field<unknown>, {
        deps: [fields.A as Field<unknown>],
        compute: (read) => read(fields.A) + 100,
      } satisfies FieldRule<number>);
      rt.graft(additions, [E]);

      expect(rt.stats.initFields).toBe(5);
      expect(rt.evaluate(E)).toBe(101);
    });
  });

  describe('flex-grammar end-to-end', () => {
    it('runtime initial layout matches TopoInterpreter on a fixed-width row tree', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(30);
        root.insertChild(c, i);
      }
      const { grammar, allFields } = buildFlexGrammar(root);
      const roots = allFields.flatMap((f) => [f.width, f.height, f.left, f.top]);
      const rt = new SpinelessRuntime(grammar, roots);
      rt.init();
      const interp = new TopoInterpreter(grammar);
      for (const f of allFields) {
        expect(rt.evaluate(f.width)).toBe(interp.evaluate(f.width));
        expect(rt.evaluate(f.height)).toBe(interp.evaluate(f.height));
        expect(rt.evaluate(f.left)).toBe(interp.evaluate(f.left));
        expect(rt.evaluate(f.top)).toBe(interp.evaluate(f.top));
      }
    });

    it('runtime initial layout matches TopoInterpreter on a flex-grow tree', () => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(30);
      root.setFlexDirection('row');
      const fixed = Node.create();
      fixed.setWidth(30);
      fixed.setHeight(30);
      root.insertChild(fixed, 0);
      const grow = Node.create();
      grow.setWidth(0);
      grow.setHeight(30);
      grow.setFlexGrow(1);
      root.insertChild(grow, 1);
      const { grammar, allFields } = buildFlexGrammar(root);
      const roots = allFields.flatMap((f) => [f.width, f.height, f.left, f.top]);
      const rt = new SpinelessRuntime(grammar, roots);
      rt.init();
      const interp = new TopoInterpreter(grammar);
      for (const f of allFields) {
        expect(rt.evaluate(f.width)).toBe(interp.evaluate(f.width));
        expect(rt.evaluate(f.left)).toBe(interp.evaluate(f.left));
      }
    });
  });
});
