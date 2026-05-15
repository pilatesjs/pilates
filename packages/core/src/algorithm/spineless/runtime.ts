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
 * **Graft** (`graft(additions, newRoots)`): incremental structural
 * growth (phase 5c). New fields whose topological position is at the
 * tail — they may read existing fields, but no existing field reads
 * them and no existing rule changes — are spliced in without a
 * rebuild: each gets an OM node appended after the current tail, its
 * reverse-dependency edges recorded, and its value computed once.
 * This is exactly the shape of appending a child to a parent in the
 * "simple" regime.
 *
 * ## What this runtime does NOT cover
 *
 * - Regime-changing structural mutation. `graft` only adds pure
 *   topological-tail fields; appending into a flex-distributing /
 *   justified / wrapping parent also rewrites existing siblings'
 *   rules, and removal / direction flips re-key subtrees — later
 *   phase-5c slices.
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

  /** The OM node at the topological tail — where `graft` appends. */
  private lastOm: OMNode | null = null;

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
    this.integrate(this.rootFields);
    this.initDone = true;
  }

  /**
   * Integrate new fields into an already-`init`ed runtime without a
   * rebuild (phase 5c). `additions` holds the rules for the new
   * fields only — it throws if any field is already present, since
   * redefining an existing field is a rule *change*, not a graft.
   * `newRoots` are the new fields to start the topological DFS from
   * (their existing-field dependencies are reached as boundaries).
   *
   * Correct **iff** the new fields are pure topological-tail
   * additions: no existing field reads a new field, and no existing
   * rule needed to change. The caller guarantees this — it holds by
   * construction when appending a last child to a parent in the
   * simple regime (no flex distribution, default `justify`, no
   * wrap). The new fields are computed with correct inputs during
   * the graft, so no `markDirty` / `recompute` is needed afterward.
   */
  graft(additions: Grammar, newRoots: ReadonlyArray<Field<unknown>>): void {
    if (!this.initDone) {
      throw new Error('[spineless-runtime] graft called before init()');
    }
    for (const [f, rule] of additions) {
      if (this.omNodes.has(f)) {
        throw new Error(
          `[spineless-runtime] graft: field "${f.name}" already exists — graft integrates NEW fields only`,
        );
      }
      this.grammar.set(f, rule);
    }
    this.integrate(newRoots);
  }

  /**
   * Topological DFS shared by `init` and `graft`. For every
   * not-yet-integrated field reachable from `roots`: recurse into
   * deps, record reverse-dependency edges, allocate an OM node after
   * the current tail, run the rule, and cache the value. Fields that
   * already have an OM node are boundaries — visited, edge recorded,
   * not re-walked.
   */
  private integrate(roots: ReadonlyArray<Field<unknown>>): void {
    const visiting = new Set<Field<unknown>>();

    const visit = (f: Field<unknown>): void => {
      // A field has an OM node exactly once it is integrated, so
      // `omNodes` doubles as the "already done" marker — which makes
      // existing fields natural boundaries during a graft.
      if (this.omNodes.has(f)) return;
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

      // Allocate the OM node at the topological tail. The OM is empty
      // before the very first field, then chains insertAfter.
      const omNode = this.lastOm === null ? this.om.init() : this.om.insertAfter(this.lastOm);
      this.lastOm = omNode;
      this.omNodes.set(f, omNode);

      // Compute and cache.
      this.values.set(f, this.runCompute(f, rule));

      visiting.delete(f);
    };

    for (const root of roots) visit(root);
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
   * Mark every field tracked by this runtime as dirty. Useful as an
   * escape hatch when callers don't have fine-grained style-mutation
   * wiring yet: mutate styles, call `markAllDirty()`, then
   * `recompute()`. Each field re-runs its rule once, but the "skip
   * dependents when value unchanged" property still applies — so
   * cost is one compute per field plus propagation only along
   * actually-changed values, rather than a full re-init.
   */
  markAllDirty(): void {
    if (!this.initDone) {
      throw new Error('[spineless-runtime] markAllDirty called before init()');
    }
    for (const [field, omNode] of this.omNodes) {
      this.pq.push(field, omNode);
    }
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
