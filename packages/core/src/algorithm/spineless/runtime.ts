/**
 * Spineless Traversal runtime — incremental driver for an attribute
 * grammar (Kirisame, Wang, Panchekha — PLDI 2025).
 *
 * Combines the three foundational primitives:
 *   - `BenderOrderMaintenance` (OM) — assigns a stable, totally-
 *     ordered timestamp to every field at first computation. Topo
 *     order at init time => OM order forever, even after relabel.
 *   - `OmPriorityQueue<Field>` — keyed on the field's OM node.
 *     Popping the minimum returns the next field to recompute in
 *     topological order, without any explicit DAG walks.
 *   - `Grammar` — declarative `field -> rule(deps, compute)` map.
 *     The runtime queries it on every recompute.
 *
 * ## Phases
 *
 * **Init** (`init()`): one full pass over the grammar from the
 * supplied root fields. DFS in topological order; for each field,
 * allocate an OM node (`om.insertAfter(prev)`), record the
 * reverse-deps edges so dependents can be scheduled later, then run
 * the field's compute and cache the value. After init, every
 * reachable field has a (timestamp, value, dependents-list) triple
 * in the runtime's storage.
 *
 * **Recompute** (`markDirty(field)` + `recompute()`): callers mark
 * the fields whose inputs changed. Each dirty field is enqueued
 * (`pq.push(field, omNode)`). `recompute()` loops: pop the
 * OM-minimum field, re-run its rule. If the new value differs from
 * the cached one, persist it and push every dependent (which by
 * construction has a later OM timestamp than this one). Process
 * stops when the queue is empty. Termination is guaranteed because
 * dependents always have strictly greater OM nodes (allocation
 * order during init is topological), so the queue can't pump
 * indefinitely.
 *
 * **Value preservation under no-op recompute:** if a field's rule
 * produces the same value as before, its dependents are NOT
 * scheduled. This is the key "skip work" property of Spineless.
 *
 * ## What this slice does NOT cover
 *
 * - Style-change → markDirty automation. Callers currently invoke
 *   `markDirty` themselves. Hooking style mutations into the
 *   runtime (and figuring out which fields a given style mutation
 *   invalidates) is the next slice.
 * - Grammar mutation. The grammar is fixed at init time; adding /
 *   removing nodes between layouts means a fresh runtime (so
 *   does mutating which fields a rule depends on).
 * - Differential mode against the imperative algorithm. The
 *   correctness oracle for the runtime is the `TopoInterpreter`
 *   running over the same grammar — once both agree, the grammar's
 *   existing differential coverage carries through.
 *
 * @internal
 */

import type { Field, FieldRule, Grammar, ReadFn } from './grammar.js';
import { BenderOrderMaintenance, type OMNode, type OrderMaintenance } from './order-maintenance.js';
import { OmPriorityQueue } from './priority-queue.js';

/**
 * @internal
 */
export class SpinelessRuntime {
  private readonly grammar: Grammar;
  private readonly rootFields: ReadonlyArray<Field<unknown>>;
  private readonly om: OrderMaintenance;
  private readonly pq: OmPriorityQueue<Field<unknown>>;

  /** field -> cached value */
  private readonly values: Map<Field<unknown>, unknown> = new Map();
  /** field -> its OM timestamp (allocated in topo order at init) */
  private readonly omNodes: Map<Field<unknown>, OMNode> = new Map();
  /** field -> fields that read this field (reverse of `rule.deps`) */
  private readonly dependents: Map<Field<unknown>, Field<unknown>[]> = new Map();

  private initDone = false;

  constructor(
    grammar: Grammar,
    rootFields: ReadonlyArray<Field<unknown>>,
    om: OrderMaintenance = new BenderOrderMaintenance(),
  ) {
    this.grammar = grammar;
    this.rootFields = rootFields;
    this.om = om;
    this.pq = new OmPriorityQueue<Field<unknown>>(om);
  }

  /**
   * Walk the grammar in topological order, allocate an OM node per
   * field, cache initial values, and record reverse-dependents. Must
   * be called once before any `evaluate` / `markDirty` / `recompute`.
   */
  init(): void {
    const visited = new Set<Field<unknown>>();
    const visiting = new Set<Field<unknown>>();
    let prevOm: OMNode | null = null;

    const visit = (f: Field<unknown>): void => {
      if (visited.has(f)) return;
      if (visiting.has(f)) {
        throw new Error(
          `[spineless-runtime] cycle detected: field "${f.name}" depends on itself transitively`,
        );
      }
      visiting.add(f);

      const rule = this.grammar.get(f);
      if (rule === undefined) {
        throw new Error(
          `[spineless-runtime] no rule for field "${f.name}". Register it in the grammar or remove the dep edge.`,
        );
      }

      for (const dep of rule.deps) {
        visit(dep);
        let revs = this.dependents.get(dep);
        if (revs === undefined) {
          revs = [];
          this.dependents.set(dep, revs);
        }
        revs.push(f);
      }

      // Allocate the OM node in topo order. The OM is empty before
      // the first call, then chains insertAfter for every subsequent.
      const omNode = prevOm === null ? this.om.init() : this.om.insertAfter(prevOm);
      prevOm = omNode;
      this.omNodes.set(f, omNode);

      // Compute and cache.
      this.values.set(f, this.runCompute(f, rule));

      visiting.delete(f);
      visited.add(f);
    };

    for (const root of this.rootFields) visit(root);
    this.initDone = true;
  }

  /**
   * Read the current cached value of a field. Throws if the field
   * wasn't reachable from any root during `init` (so no cache entry
   * exists).
   */
  evaluate<T>(field: Field<T>): T {
    if (!this.values.has(field as Field<unknown>)) {
      throw new Error(
        `[spineless-runtime] field "${field.name}" was not computed in init() — it isn't reachable from any root`,
      );
    }
    return this.values.get(field as Field<unknown>) as T;
  }

  /**
   * Mark a field as dirty. Its rule will be re-run on the next
   * `recompute()`. If the new value differs from the cached one,
   * dependents are scheduled in turn.
   *
   * Duplicate calls are a no-op (the priority queue dedupes via its
   * internal membership set).
   */
  markDirty(field: Field<unknown>): void {
    if (!this.initDone) {
      throw new Error('[spineless-runtime] markDirty called before init()');
    }
    const om = this.omNodes.get(field);
    if (om === undefined) {
      throw new Error(
        `[spineless-runtime] field "${field.name}" is not in this runtime — call markDirty only on fields reachable from a root at init`,
      );
    }
    this.pq.push(field, om);
  }

  /**
   * Process all dirty fields. Pops in OM (= topological) order; runs
   * each field's rule. If the result differs from the cached value,
   * persists it and pushes every dependent so it gets re-run later in
   * this same pass.
   */
  recompute(): void {
    if (!this.initDone) {
      throw new Error('[spineless-runtime] recompute called before init()');
    }
    while (!this.pq.isEmpty()) {
      const f = this.pq.popMin()!;
      const rule = this.grammar.get(f)!;
      const prev = this.values.get(f);
      const next = this.runCompute(f, rule);
      if (!Object.is(prev, next)) {
        this.values.set(f, next);
        const deps = this.dependents.get(f);
        if (deps !== undefined) {
          for (const d of deps) {
            const om = this.omNodes.get(d)!;
            this.pq.push(d, om);
          }
        }
      }
    }
  }

  private runCompute<T>(field: Field<T>, rule: FieldRule<T>): T {
    const declaredDeps = new Set<Field<unknown>>(rule.deps);
    const read: ReadFn = <U>(dep: Field<U>): U => {
      if (!declaredDeps.has(dep as Field<unknown>)) {
        throw new Error(
          `[spineless-runtime] rule for "${field.name}" reads "${dep.name}" but did not declare it as a dependency`,
        );
      }
      return this.values.get(dep as Field<unknown>) as U;
    };
    return rule.compute(read);
  }
}
