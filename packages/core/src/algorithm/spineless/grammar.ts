/**
 * Attribute grammar for layout — type system + topological interpreter.
 *
 * Foundation for Spineless Traversal: re-expresses the imperative
 * flex algorithm as a set of field-level dependencies. Each layout
 * field (a `(Node, attribute-name)` pair) has a rule that computes
 * its value from other fields it depends on. The runtime evaluates
 * fields in topological order; mutations only propagate to fields
 * that actually change.
 *
 * ## What this file ships (Phase 5a foundation)
 *
 * - **Types** — `Field`, `FieldRule`, `Grammar`. The clean abstractions
 *   the Spineless runtime will consume.
 * - **`TopoInterpreter`** — naive topological evaluator. Given a
 *   grammar + a root field, walks the dependency DAG and evaluates
 *   every reachable field in order. Used both as a correctness oracle
 *   (Spineless runtime asserts byte-identical outputs) and as a
 *   reference for understanding the grammar.
 *
 * **The interpreter is NOT incremental.** It always evaluates every
 * reachable field from scratch. The Spineless runtime (next sub-phase)
 * makes it incremental by only recomputing fields whose dependencies
 * changed.
 *
 * ## What this file does NOT ship
 *
 * - The actual flexbox grammar — that's `grammar/flex.ts` in the next
 *   sub-phase, ~2-3 weeks of work expressing ~50 layout fields with
 *   their dependencies (mirroring the paper's Megatron implementation).
 * - The Spineless runtime — that's `runtime.ts`, ~3-4 weeks of work
 *   wiring OM + priority queue + grammar interpreter into an
 *   incremental driver.
 *
 * ## Type-level note: generics are erased
 *
 * The type system is structurally typed: `Field<T>` carries the
 * value type only as a phantom for documentation. At runtime we
 * store/read via the type-erased `Field` union; consumers cast at the
 * read site. This keeps the runtime free of type-tag overhead.
 *
 * @internal
 */

import type { Node } from '../../node.js';

/**
 * Identifies a single attribute on a single Node. The unit of
 * dependency tracking in Spineless Traversal.
 *
 * Identity: two `Field` values refer to the same conceptual attribute
 * iff `node === node` AND `name === name`. We use object identity
 * (single allocation per logical field) so `Set<Field>` works without
 * a custom equality function.
 *
 * @internal
 */
export interface Field<T = unknown> {
  readonly node: Node;
  readonly name: string;
  /**
   * Phantom marker for the value type. Never read at runtime.
   * @internal
   */
  readonly _valueType?: T;
}

/**
 * A rule that computes the value of one field from its dependencies.
 *
 * `compute` is a pure function over the values of `deps`. It must not
 * read any field outside `deps` and must not have side effects.
 *
 * The interpreter / Spineless runtime enforces this by passing a
 * `GraphRead` to `compute` that exposes only fields in `deps`.
 *
 * @internal
 */
export interface FieldRule<T = unknown> {
  /**
   * The fields this rule reads. The interpreter walks these
   * transitively to discover the full dependency DAG.
   */
  readonly deps: ReadonlyArray<Field<unknown>>;

  /**
   * Compute the field's value from its dependencies' current values.
   * `read(dep)` returns the cached value of `dep` (or throws if `dep`
   * is not in `deps`).
   */
  compute(read: <U>(dep: Field<U>) => U): T;
}

/**
 * The grammar — map from each field to its computation rule. The
 * Spineless runtime queries this map on every recompute.
 *
 * Identity-keyed: `Field` instances are used as keys directly. The
 * caller is responsible for allocating each logical field exactly
 * once and reusing the same `Field` object.
 *
 * @internal
 */
export type Grammar = Map<Field<unknown>, FieldRule<unknown>>;

/**
 * Read-side interface used internally by `compute` callbacks. Returns
 * the current value of a dependency field.
 *
 * @internal
 */
export type ReadFn = <U>(dep: Field<U>) => U;

/**
 * Naive topological interpreter. Evaluates every reachable field in
 * the grammar from scratch on each `evaluate()` call. No incrementality.
 *
 * Two roles:
 * 1. **Correctness oracle.** Once the full flex grammar lands, the
 *    Spineless runtime's incremental output must match the interpreter's
 *    output byte-for-byte. Differential mode runs both in parallel and
 *    asserts equality.
 * 2. **Bootstrap path.** Lets us validate grammar correctness
 *    independently of the Spineless runtime, so the two big pieces
 *    (grammar + runtime) can be developed and tested separately.
 *
 * @internal
 */
export class TopoInterpreter {
  private readonly values: Map<Field<unknown>, unknown> = new Map();
  private readonly grammar: Grammar;

  constructor(grammar: Grammar) {
    this.grammar = grammar;
  }

  /**
   * Read the current value of a field. Returns `undefined` if the
   * field has never been computed (call `evaluate(field)` first).
   */
  read<T>(field: Field<T>): T | undefined {
    return this.values.get(field) as T | undefined;
  }

  /**
   * Evaluate `field` and all its transitive dependencies. Returns the
   * computed value.
   *
   * Topological evaluation via DFS: for each field, recursively
   * evaluate its dependencies first, then run the field's rule.
   *
   * Detects cycles via a "visiting" set; throws on cycle. The flex
   * grammar must be acyclic by construction.
   */
  evaluate<T>(field: Field<T>): T {
    return this.evalInternal(field, new Set()) as T;
  }

  /**
   * Reset all cached values. Forces re-evaluation on the next
   * `evaluate()` call. Used by tests and the differential harness.
   */
  reset(): void {
    this.values.clear();
  }

  private evalInternal(field: Field<unknown>, visiting: Set<Field<unknown>>): unknown {
    if (this.values.has(field)) return this.values.get(field);

    if (visiting.has(field)) {
      throw new Error(
        `[pilates grammar] cycle detected: field "${field.name}" on node depends on itself transitively`,
      );
    }
    visiting.add(field);

    const rule = this.grammar.get(field);
    if (rule === undefined) {
      throw new Error(
        `[pilates grammar] no rule for field "${field.name}". Did you forget to register it?`,
      );
    }

    // Recursively evaluate every dependency first.
    for (const dep of rule.deps) {
      this.evalInternal(dep, visiting);
    }

    // All deps are now in `this.values`. Build the read fn restricted
    // to declared deps (catches grammar bugs where compute reads a
    // field not in its deps list).
    const declaredDeps = new Set(rule.deps);
    const read: ReadFn = <U>(dep: Field<U>): U => {
      if (!declaredDeps.has(dep)) {
        throw new Error(
          `[pilates grammar] rule for "${field.name}" reads "${dep.name}" but did not declare it as a dependency`,
        );
      }
      return this.values.get(dep) as U;
    };

    const value = rule.compute(read);
    this.values.set(field, value);
    visiting.delete(field);
    return value;
  }
}

/**
 * Create a `Field` with stable identity. The same `(node, name)` pair
 * passed to `field(...)` returns the SAME object on subsequent calls,
 * which is what makes `Map<Field, ...>` work as identity-keyed storage.
 *
 * @internal
 */
const FIELD_REGISTRY: WeakMap<Node, Map<string, Field<unknown>>> = new WeakMap();

export function field<T>(node: Node, name: string): Field<T> {
  let perNode = FIELD_REGISTRY.get(node);
  if (perNode === undefined) {
    perNode = new Map();
    FIELD_REGISTRY.set(node, perNode);
  }
  let f = perNode.get(name);
  if (f === undefined) {
    f = { node, name } as Field<unknown>;
    perNode.set(name, f);
  }
  return f as Field<T>;
}
