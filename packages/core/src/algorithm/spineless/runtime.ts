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
 * the cached one, persist it and push every dependent. Process
 * stops when the queue is empty.
 *
 * **Termination** rests on the dependency graph being acyclic: each
 * field's value is a function of finitely many others, so the
 * worklist reaches the DAG's unique fixpoint in finitely many
 * steps. When the OM order is a true topological order — as it is
 * after `init` and pure-additive `graft` — every field recomputes
 * exactly once (a dependent always pops after its deps), giving the
 * O(affected) Spineless bound. After a `rebindRule` an existing
 * field may gain a dependency on a later-OM field; recompute stays
 * correct and terminating, but such a field may recompute a bounded
 * number of extra times. OM order is thus a performance property,
 * not a correctness one.
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
 * **Detach** (`detach(fields)`): the inverse of `graft` — drops a
 * removed subtree's fields, freeing their OM nodes and pruning the
 * reverse-dependency edges into surviving fields. Valid when the
 * removed set is closed under "is read by" (nothing outside reads
 * in), which holds for removing a last child in the simple regime.
 * Surviving leaf-input fields the removed set was the sole reader of
 * are dropped too — the caller passes only the subtree's own fields.
 *
 * **Rebind** (`rebindRule(field, newRule)`): replace an existing
 * field's rule — used when a structural change rewrites a surviving
 * field (e.g. appending into a flex-distributing parent grows every
 * sibling's flex-distribution dependency set). The reverse-
 * dependency edges are updated to the new dep set and the field is
 * marked dirty. New deps may have a later OM than the field — see
 * the termination note above.
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

import { fieldIdCount } from './field-id-pool.js';
import type { Field, FieldRule, Grammar, ReadFn } from './grammar.js';
import { BenderOrderMaintenance, type OMNode, type OrderMaintenance } from './order-maintenance.js';
import { OmPriorityQueue } from './priority-queue.js';

/**
 * A `ReadFn` for zero-dependency rules — they declare no deps, so their
 * `compute` must never call `read`. If one does, this throws (a grammar
 * bug), mirroring the undeclared-dependency error in the normal path.
 */
const NEVER_READ: ReadFn = (dep) => {
  throw new Error(
    `[spineless-runtime] a zero-dependency rule called read("${dep.name}") — it did not declare it as a dependency`,
  );
};

/**
 * @internal
 */
export class SpinelessRuntime {
  private readonly rootFields: ReadonlyArray<Field<unknown>>;
  private readonly om: OrderMaintenance;
  private readonly pq: OmPriorityQueue<Field<unknown>>;

  /**
   * External Grammar map reference — kept so that callers holding the
   * same map reference (e.g. layout.ts's `output.grammar`) see mutations
   * made by `graft` / `rebindRule` / `detach`. All internal HOT-PATH
   * reads use `rulesArr` (O(1) array index) instead.
   */
  private readonly grammar: Grammar;

  /**
   * Field rules indexed by field.id — the fast-path mirror of `grammar`.
   * Updated in lockstep with every `grammar.set` / `grammar.delete`.
   * Plain array; auto-grows on out-of-range assignment (JS semantics).
   */
  private rulesArr: (FieldRule<unknown> | undefined)[] = [];

  /**
   * Fast path: numeric field values indexed by field.id.
   * valuePresent[id] === 1 means the value is stored here as a number.
   */
  private valuesArr: Float64Array;
  /**
   * Presence / storage-kind bitset, indexed by field.id:
   *   0 = absent (not yet computed or detached)
   *   1 = computed, value is a number stored in valuesArr[id]
   *   2 = computed, value is a non-number object stored in valuesMap
   */
  private valuePresent: Uint8Array;
  /**
   * Fallback for non-number field values (e.g. Field<MainAxisDistribution>).
   * Only populated when valuePresent[id] === 2.
   */
  private readonly valuesMap: Map<Field<unknown>, unknown> = new Map();
  /** field -> its OM timestamp (allocated in topo order at init) */
  private readonly omNodes: Map<Field<unknown>, OMNode> = new Map();
  /** field -> fields that read this field (reverse of `rule.deps`) */
  private readonly dependents: Map<Field<unknown>, Field<unknown>[]> = new Map();

  /** The OM node at the topological tail — where `graft` appends. */
  private lastOm: OMNode | null = null;

  private initDone = false;

  /**
   * Recompute counters — for observability (phase 9). Plain integer
   * fields, bumped on the existing `integrate` / `recompute` loops,
   * so they cost nothing measurable and need no enable flag.
   */
  readonly stats = {
    /** Fields integrated so far — the `init` pass plus every `graft`. */
    initFields: 0,
    /** Fields popped from the PQ by the most recent `recompute()`. */
    recomputeVisited: 0,
    /** Of those, Fields whose value actually changed. */
    recomputeChanged: 0,
    /** Cumulative Fields visited across every `recompute()` since init. */
    totalVisited: 0,
  };

  constructor(
    grammar: Grammar,
    rootFields: ReadonlyArray<Field<unknown>>,
    om: OrderMaintenance = new BenderOrderMaintenance(),
  ) {
    this.grammar = grammar;
    this.rootFields = rootFields;
    this.om = om;
    this.pq = new OmPriorityQueue<Field<unknown>>(om);
    // Mirror the public Grammar map into rulesArr (indexed by field.id)
    // so the hot path can do O(1) array reads instead of Map lookups.
    for (const [f, rule] of grammar) {
      this.rulesArr[f.id] = rule;
    }
    // Initialise value arrays to cover all IDs allocated so far.
    // ensureFieldCapacity() grows them on demand as new fields arrive.
    const initialCap = Math.max(fieldIdCount(), 1024);
    this.valuesArr = new Float64Array(initialCap);
    this.valuePresent = new Uint8Array(initialCap);
  }

  /**
   * Grow `valuesArr` and `valuePresent` so that `id` is a valid index.
   * Doubles capacity until sufficient, copying forward (LayoutPool pattern).
   */
  private ensureFieldCapacity(id: number): void {
    if (id < this.valuesArr.length) return;
    let cap = this.valuesArr.length;
    while (id >= cap) cap *= 2;
    const newArr = new Float64Array(cap);
    const newPresent = new Uint8Array(cap);
    newArr.set(this.valuesArr);
    newPresent.set(this.valuePresent);
    this.valuesArr = newArr;
    this.valuePresent = newPresent;
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
      this.rulesArr[f.id] = rule;
      this.grammar.set(f, rule);
    }
    this.integrate(newRoots);
  }

  /**
   * Remove fields from an already-`init`ed runtime without a rebuild
   * (phase 5c) — the inverse of `graft`. `fields` is the exact set
   * to drop (a removed subtree's fields). For each: its OM node is
   * freed, its cached value and reverse-dependency list dropped, its
   * rule deleted from the grammar, and it is pruned from the
   * reverse-dependency list of every field it read.
   *
   * Throws if any removed field still has a dependent *outside* the
   * removed set — detaching it would dangle that edge. The caller
   * guarantees a clean cut: it holds by construction when removing a
   * last child from a parent in the simple regime (nothing outside
   * that subtree reads into it). No `recompute` is needed afterward —
   * removing a topological-tail subtree changes no surviving field.
   *
   * After the cut, any surviving leaf-input field the removed set was
   * the sole reader of is **orphaned** — nothing reads it and the
   * grammar cannot re-read it without a fresh build. Such orphans are
   * dropped too (a leaf has no dependencies, so this cannot cascade).
   * That makes the caller's removed set just the subtree's own
   * fields — orphan input fields, e.g. the previous last child's
   * now-unread main-end margin, need not be enumerated.
   *
   * @returns The set of every field actually removed — both the
   * explicit `fields` argument AND any orphan-cleaned surviving deps.
   * Callers can use this to maintain a `Set<Field>` index in O(|dropped|)
   * rather than scanning all tracked fields.
   */
  detach(fields: Iterable<Field<unknown>>): Set<Field<unknown>> {
    if (!this.initDone) {
      throw new Error('[spineless-runtime] detach called before init()');
    }
    const removing = new Set(fields);

    // Precondition: the removed set must be closed under "is read by"
    // — no surviving field may depend on a removed one.
    for (const f of removing) {
      const revs = this.dependents.get(f);
      if (revs === undefined) continue;
      for (const d of revs) {
        if (!removing.has(d)) {
          throw new Error(
            `[spineless-runtime] detach: field "${f.name}" still has dependent "${d.name}" outside the removed set`,
          );
        }
      }
    }

    // Surviving fields the removed set read — candidates for orphan
    // cleanup once their reverse-dependency lists are pruned.
    const survivingDeps = new Set<Field<unknown>>();

    const dropped = new Set<Field<unknown>>();
    const removedOmNodes = new Set<OMNode>();
    const drop = (f: Field<unknown>): void => {
      dropped.add(f);
      const omNode = this.omNodes.get(f);
      if (omNode !== undefined) {
        this.om.delete(omNode);
        removedOmNodes.add(omNode);
      }
      this.omNodes.delete(f);
      if (f.id < this.valuePresent.length && this.valuePresent[f.id] === 2) {
        this.valuesMap.delete(f);
      }
      this.valuePresent[f.id] = 0;
      this.dependents.delete(f);
      this.rulesArr[f.id] = undefined;
      this.grammar.delete(f);
    };

    for (const f of removing) {
      // Prune `f` from the reverse-dependency list of each field it
      // read (a surviving dep must forget this removed dependent).
      const rule = this.rulesArr[f.id];
      if (rule !== undefined) {
        for (const dep of rule.deps) {
          const revs = this.dependents.get(dep);
          if (revs !== undefined) {
            const i = revs.indexOf(f);
            if (i !== -1) revs.splice(i, 1);
          }
          if (!removing.has(dep)) survivingDeps.add(dep);
        }
      }
      drop(f);
    }

    // Orphan cleanup: a surviving dep with no dependents left, whose
    // own rule is a leaf (no dependencies), is now dead weight.
    for (const dep of survivingDeps) {
      const revs = this.dependents.get(dep);
      if (revs !== undefined && revs.length > 0) continue;
      const rule = this.rulesArr[dep.id];
      if (rule === undefined || rule.deps.length > 0) continue;
      drop(dep);
    }

    // The OM tail may have been among the removed fields. If so, walk
    // back through predecessors (skipping just-removed nodes) to find
    // the new tail — O(removed) instead of O(total live nodes).
    if (this.lastOm !== null && removedOmNodes.has(this.lastOm)) {
      let candidate: OMNode | null = this.lastOm;
      while (candidate !== null && removedOmNodes.has(candidate)) {
        candidate = this.om.predecessor(candidate);
      }
      this.lastOm = candidate;
    }

    return dropped;
  }

  /**
   * Replace the rule of an already-integrated field (phase 5c) — for
   * a structural change that rewrites a *surviving* field rather than
   * adding or removing one. Appending a child into a flex-distributing
   * parent, for instance, grows every existing sibling's
   * flex-distribution dependency set.
   *
   * The reverse-dependency edges are repaired to match the new dep
   * set (the field is dropped from the lists of deps it no longer
   * reads and added to the lists of deps it now reads), the new rule
   * is installed, and the field is marked dirty so the next
   * `recompute()` re-runs it. Every new dependency must already be
   * integrated. The field keeps its OM node; if a new dependency has
   * a later OM, recompute stays correct (see the termination note on
   * the class) at the cost of a bounded number of extra recomputes.
   */
  rebindRule(field: Field<unknown>, newRule: FieldRule<unknown>): void {
    if (!this.initDone) {
      throw new Error('[spineless-runtime] rebindRule called before init()');
    }
    if (!this.omNodes.has(field)) {
      throw new Error(
        `[spineless-runtime] rebindRule: field "${field.name}" is not in this runtime`,
      );
    }
    const oldRule = this.rulesArr[field.id];
    const oldDeps = new Set<Field<unknown>>(oldRule?.deps ?? []);
    const newDeps = new Set<Field<unknown>>(newRule.deps);

    // Deps no longer read: drop `field` from their dependents list.
    for (const d of oldDeps) {
      if (newDeps.has(d)) continue;
      const revs = this.dependents.get(d);
      if (revs !== undefined) {
        const i = revs.indexOf(field);
        if (i !== -1) revs.splice(i, 1);
      }
    }
    // Newly read deps: register the reverse edge.
    for (const d of newDeps) {
      if (oldDeps.has(d)) continue;
      if (!this.omNodes.has(d)) {
        throw new Error(
          `[spineless-runtime] rebindRule: new dependency "${d.name}" of "${field.name}" is not integrated`,
        );
      }
      let revs = this.dependents.get(d);
      if (revs === undefined) {
        revs = [];
        this.dependents.set(d, revs);
      }
      revs.push(field);
    }

    this.rulesArr[field.id] = newRule;
    this.grammar.set(field, newRule);
    this.markDirty(field);
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

      const rule = this.rulesArr[f.id];
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
      this.stats.initFields++;

      // Compute and cache.
      this.ensureFieldCapacity(f.id);
      const initVal = this.runCompute(f, rule);
      if (typeof initVal === 'number') {
        this.valuesArr[f.id] = initVal;
        this.valuePresent[f.id] = 1;
      } else {
        this.valuesMap.set(f, initVal);
        this.valuePresent[f.id] = 2;
      }

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
    const id = (field as Field<unknown>).id;
    const kind = id < this.valuePresent.length ? this.valuePresent[id] : 0;
    if (kind === 0) {
      throw new Error(
        `[spineless-runtime] field "${field.name}" was not computed in init() — it isn't reachable from any root`,
      );
    }
    if (kind === 1) return this.valuesArr[id] as unknown as T;
    return this.valuesMap.get(field as Field<unknown>) as T;
  }

  /**
   * Whether `field` is currently tracked by the runtime — integrated
   * and not since detached. A caller holding a possibly-stale field
   * reference (e.g. an input field orphaned by a `detach`) can check
   * this before `markDirty`.
   */
  isTracked(field: Field<unknown>): boolean {
    return this.omNodes.has(field);
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
   *
   * Returns every field whose value actually changed — the caller
   * uses it to scope an incremental write-back to the moved nodes.
   */
  recompute(): Array<Field<unknown>> {
    if (!this.initDone) {
      throw new Error('[spineless-runtime] recompute called before init()');
    }
    const changed: Array<Field<unknown>> = [];
    this.stats.recomputeVisited = 0;
    this.stats.recomputeChanged = 0;
    while (!this.pq.isEmpty()) {
      const f = this.pq.popMin()!;
      this.stats.recomputeVisited++;
      this.stats.totalVisited++;
      const rule = this.rulesArr[f.id]!;
      const id = f.id;
      const kind = this.valuePresent[id]!;
      const prev: unknown = kind === 1 ? this.valuesArr[id] : this.valuesMap.get(f);
      const next = this.runCompute(f, rule);
      if (!Object.is(prev, next)) {
        if (typeof next === 'number') {
          this.valuesArr[id] = next;
          this.valuePresent[id] = 1;
          if (kind === 2) this.valuesMap.delete(f);
        } else {
          this.valuesMap.set(f, next);
          this.valuePresent[id] = 2;
        }
        this.stats.recomputeChanged++;
        changed.push(f);
        const deps = this.dependents.get(f);
        if (deps !== undefined) {
          for (const d of deps) {
            const om = this.omNodes.get(d)!;
            this.pq.push(d, om);
          }
        }
      }
    }
    return changed;
  }

  private runCompute<T>(field: Field<T>, rule: FieldRule<T>): T {
    // Zero-dep fields (leaf inputs, constants) can't read anything —
    // skip the per-compute Set allocation + validating closure.
    if (rule.deps.length === 0) {
      return rule.compute(NEVER_READ);
    }
    const declaredDeps = new Set<Field<unknown>>(rule.deps);
    const read: ReadFn = <U>(dep: Field<U>): U => {
      if (!declaredDeps.has(dep as Field<unknown>)) {
        throw new Error(
          `[spineless-runtime] rule for "${field.name}" reads "${dep.name}" but did not declare it as a dependency`,
        );
      }
      const depId = (dep as Field<unknown>).id;
      const depKind = this.valuePresent[depId]!;
      if (depKind === 1) return this.valuesArr[depId] as unknown as U;
      return this.valuesMap.get(dep as Field<unknown>) as U;
    };
    return rule.compute(read);
  }
}
