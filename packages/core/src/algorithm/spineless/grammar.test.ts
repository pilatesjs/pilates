import { describe, expect, it } from 'vitest';
import { Node } from '../../node.js';
import { type FieldRule, type Grammar, TopoInterpreter, field } from './grammar.js';

describe('field()', () => {
  it('returns stable identity for the same (node, name) pair', () => {
    const node = Node.create();
    const a = field(node, 'width');
    const b = field(node, 'width');
    expect(a).toBe(b);
  });

  it('returns distinct identities for different names on the same node', () => {
    const node = Node.create();
    const w = field(node, 'width');
    const h = field(node, 'height');
    expect(w).not.toBe(h);
    expect(w.name).toBe('width');
    expect(h.name).toBe('height');
  });

  it('returns distinct identities for the same name on different nodes', () => {
    const n1 = Node.create();
    const n2 = Node.create();
    const a = field(n1, 'width');
    const b = field(n2, 'width');
    expect(a).not.toBe(b);
  });

  it('field can be used as a Map key (identity-keyed storage)', () => {
    const node = Node.create();
    const f = field<number>(node, 'width');
    const map = new Map<typeof f, number>();
    map.set(f, 42);
    expect(map.get(field(node, 'width'))).toBe(42);
  });
});

describe('TopoInterpreter — basics', () => {
  it('evaluates a field with no dependencies', () => {
    const node = Node.create();
    const w = field<number>(node, 'width');
    const grammar: Grammar = new Map([
      [
        w as ReturnType<typeof field>,
        {
          deps: [],
          compute: () => 100,
        } satisfies FieldRule<number>,
      ],
    ]);
    const interp = new TopoInterpreter(grammar);
    expect(interp.evaluate(w)).toBe(100);
    expect(interp.read(w)).toBe(100);
  });

  it('evaluates a field that depends on another field', () => {
    const node = Node.create();
    const a = field<number>(node, 'a');
    const b = field<number>(node, 'b');
    const grammar: Grammar = new Map([
      [a as ReturnType<typeof field>, { deps: [], compute: () => 10 }],
      [
        b as ReturnType<typeof field>,
        {
          deps: [a],
          compute: (read) => read(a) * 3,
        } satisfies FieldRule<number>,
      ],
    ]);
    const interp = new TopoInterpreter(grammar);
    expect(interp.evaluate(b)).toBe(30);
  });

  it('caches values — evaluating the same field twice runs compute once', () => {
    const node = Node.create();
    const w = field<number>(node, 'width');
    let computeCount = 0;
    const grammar: Grammar = new Map([
      [
        w as ReturnType<typeof field>,
        {
          deps: [],
          compute: () => {
            computeCount++;
            return 42;
          },
        } satisfies FieldRule<number>,
      ],
    ]);
    const interp = new TopoInterpreter(grammar);
    expect(interp.evaluate(w)).toBe(42);
    expect(interp.evaluate(w)).toBe(42);
    expect(computeCount).toBe(1);
  });

  it('reset() clears cache; next evaluate re-runs compute', () => {
    const node = Node.create();
    const w = field<number>(node, 'width');
    let computeCount = 0;
    const grammar: Grammar = new Map([
      [
        w as ReturnType<typeof field>,
        {
          deps: [],
          compute: () => {
            computeCount++;
            return 42;
          },
        } satisfies FieldRule<number>,
      ],
    ]);
    const interp = new TopoInterpreter(grammar);
    interp.evaluate(w);
    interp.reset();
    interp.evaluate(w);
    expect(computeCount).toBe(2);
  });
});

describe('TopoInterpreter — error handling', () => {
  it('throws on a field with no rule', () => {
    const node = Node.create();
    const w = field<number>(node, 'width');
    const interp = new TopoInterpreter(new Map());
    expect(() => interp.evaluate(w)).toThrow(/no rule for field "width"/);
  });

  it('throws when compute reads an undeclared dependency', () => {
    const node = Node.create();
    const a = field<number>(node, 'a');
    const b = field<number>(node, 'b');
    const grammar: Grammar = new Map([
      [a as ReturnType<typeof field>, { deps: [], compute: () => 10 }],
      [
        b as ReturnType<typeof field>,
        // declares no deps but tries to read `a`
        {
          deps: [],
          compute: (read) => read(a),
        } satisfies FieldRule<number>,
      ],
    ]);
    const interp = new TopoInterpreter(grammar);
    expect(() => interp.evaluate(b)).toThrow(/did not declare it as a dependency/);
  });

  it('detects cycles in the dependency graph', () => {
    const node = Node.create();
    const a = field<number>(node, 'a');
    const b = field<number>(node, 'b');
    const grammar: Grammar = new Map([
      [a as ReturnType<typeof field>, { deps: [b], compute: (read) => read(b) + 1 }],
      [b as ReturnType<typeof field>, { deps: [a], compute: (read) => read(a) + 1 }],
    ]);
    const interp = new TopoInterpreter(grammar);
    expect(() => interp.evaluate(a)).toThrow(/cycle detected/);
  });
});

describe('Demo grammar: 2-element fixed-width row', () => {
  // A toy grammar expressing a flex row with 2 fixed-width children.
  // This is the simplest non-trivial layout that exercises:
  //   - Multiple nodes
  //   - Cross-node dependencies (child.left depends on root.padding + previous siblings)
  //   - Container constraints flowing down (root.width drives layout)
  //
  // The full flex grammar (next sub-phase) will scale this to ~50
  // fields per container, handling flex grow/shrink, wrap, alignment,
  // measure funcs, and rounding.

  it('computes the correct layout for a 100-wide row with [30, 70] children', () => {
    const root = Node.create();
    const c1 = Node.create();
    const c2 = Node.create();
    root.insertChild(c1, 0);
    root.insertChild(c2, 1);

    // Fields
    const rootWidth = field<number>(root, 'width');
    const c1Width = field<number>(c1, 'width');
    const c2Width = field<number>(c2, 'width');
    const c1Left = field<number>(c1, 'left');
    const c2Left = field<number>(c2, 'left');

    // Grammar: root.width = 100, c1.width = 30, c2.width = 70 (input)
    //          c1.left = 0
    //          c2.left = c1.left + c1.width
    const grammar: Grammar = new Map([
      [rootWidth as ReturnType<typeof field>, { deps: [], compute: () => 100 }],
      [c1Width as ReturnType<typeof field>, { deps: [], compute: () => 30 }],
      [c2Width as ReturnType<typeof field>, { deps: [], compute: () => 70 }],
      [c1Left as ReturnType<typeof field>, { deps: [], compute: () => 0 }],
      [
        c2Left as ReturnType<typeof field>,
        {
          deps: [c1Left, c1Width],
          compute: (read) => read(c1Left) + read(c1Width),
        } satisfies FieldRule<number>,
      ],
    ]);

    const interp = new TopoInterpreter(grammar);

    expect(interp.evaluate(rootWidth)).toBe(100);
    expect(interp.evaluate(c1Width)).toBe(30);
    expect(interp.evaluate(c2Width)).toBe(70);
    expect(interp.evaluate(c1Left)).toBe(0);
    expect(interp.evaluate(c2Left)).toBe(30);

    // Sum invariant: children's widths fit in root
    expect(interp.read(c1Width)! + interp.read(c2Width)!).toBe(interp.read(rootWidth));
  });

  it('butting invariant: c2.left === c1.left + c1.width', () => {
    const root = Node.create();
    const c1 = Node.create();
    const c2 = Node.create();
    root.insertChild(c1, 0);
    root.insertChild(c2, 1);

    const c1Width = field<number>(c1, 'width');
    const c2Width = field<number>(c2, 'width');
    const c1Left = field<number>(c1, 'left');
    const c2Left = field<number>(c2, 'left');

    // Property test: for many random (c1.width, c2.width) pairs, the
    // butt invariant must hold.
    for (const [w1, w2] of [
      [10, 20],
      [50, 50],
      [1, 1],
      [99, 1],
    ]) {
      const grammar: Grammar = new Map([
        [c1Width as ReturnType<typeof field>, { deps: [], compute: () => w1! }],
        [c2Width as ReturnType<typeof field>, { deps: [], compute: () => w2! }],
        [c1Left as ReturnType<typeof field>, { deps: [], compute: () => 0 }],
        [
          c2Left as ReturnType<typeof field>,
          {
            deps: [c1Left, c1Width],
            compute: (read) => read(c1Left) + read(c1Width),
          } satisfies FieldRule<number>,
        ],
      ]);
      const interp = new TopoInterpreter(grammar);
      expect(interp.evaluate(c2Left)).toBe(interp.evaluate(c1Left) + interp.evaluate(c1Width));
    }
  });
});
