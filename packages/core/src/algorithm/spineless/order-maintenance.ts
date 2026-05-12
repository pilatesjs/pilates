/**
 * Order Maintenance (OM) data structure.
 *
 * Maintains a totally-ordered set of items under insertions, deletions,
 * and `compare(a, b)` queries that return the relative order in O(1) (or
 * O(1) amortized). Foundational primitive for Spineless Traversal
 * (Kirisame, Wang, Panchekha — PLDI 2025): the priority queue that
 * drives incremental layout invalidation is keyed on OM timestamps,
 * so a fast OM comparator dominates per-operation cost.
 *
 * Reference: Bender, Cole, Demaine, Farach-Colton, Zito. "Two
 * simplified algorithms for maintaining order in a list." ESA 2002.
 *
 * ## What this file ships
 *
 * **The interface** — `OMNode`, `OrderMaintenance` — is the surface the
 * Spineless runtime will consume. We design it so the implementation
 * can be swapped (naive ↔ Bender amortized O(1)) without ripple.
 *
 * **The naive implementation** — `NaiveOrderMaintenance` — uses a single
 * doubly-linked list with sequential integer tags assigned on insert.
 * Inserts trigger O(N) renumbering of trailing nodes. Compare is O(1).
 *
 * This is the **scaffolding implementation**: correct, simple, lets us
 * write all the consumer code (priority queue, runtime, attribute grammar
 * interpreter) without waiting for the optimized impl. The Bender et al.
 * amortized-O(1) implementation lands as a drop-in replacement once the
 * Spineless runtime is wired and we can benchmark end-to-end. The naive
 * impl stays in tree forever as a reference oracle: every Bender op is
 * differentially compared against naive in the property-based test.
 *
 * ## Why JS and not WASM
 *
 * The paper's reference (Megatron) emits C++ and uses inline `cmov` for
 * branchless compare. We can't use inline assembly in JS, but we don't
 * have to: V8 already lowers `a < b` on 32-bit-integer hidden classes
 * to a branchless `cmp` + `setb` sequence on x86-64. The TS-side cost is
 * predominantly in the `lookup` (Map.get) and the unboxed compare itself.
 *
 * @internal
 */

/**
 * A node in the order. The user holds these directly; comparisons happen
 * via {@link OrderMaintenance.compare}. Implementations are free to use
 * different node-internal representations; the interface only commits to
 * identity (`===`) being the way to look a node up.
 *
 * @internal
 */
export interface OMNode {
  /**
   * Implementation-defined opaque tag. Consumers must NOT read this
   * directly. Treated as an internal invariant that survives compares
   * but may shift after inserts/deletes (renumbering, rebalance).
   *
   * @internal
   */
  readonly _omTag: number;
}

/**
 * @internal
 */
export interface OrderMaintenance {
  /**
   * The current count of live nodes in the order. Exposed for tests
   * and microbenchmarks; consumers should not depend on the value.
   */
  readonly size: number;

  /**
   * Create the very first node in an empty order, or assert that an
   * order is non-empty by looking up an existing first/last anchor.
   * Returns a node identity that can be used as the `after` argument
   * to subsequent `insertAfter` calls.
   *
   * Calling `init` on an already-initialised order replaces all
   * existing nodes; this is provided for `reset()` semantics.
   */
  init(): OMNode;

  /**
   * Insert a fresh node immediately after `after` in the order.
   * Returns the new node identity. The returned node compares >
   * `after` and < whatever was at `after.next` previously.
   *
   * Amortized O(1) in the Bender impl; O(N) worst case here in the
   * naive impl due to trailing-node renumbering.
   */
  insertAfter(after: OMNode): OMNode;

  /**
   * Remove `node` from the order. Subsequent compares involving
   * `node` are undefined behaviour. Other nodes' relative order is
   * preserved.
   */
  delete(node: OMNode): void;

  /**
   * Compare the relative order of `a` and `b`. Returns:
   * - a negative integer if `a` precedes `b` (was inserted earlier
   *   or recipient-of-`insertAfter` chain),
   * - zero if `a === b`,
   * - a positive integer if `a` follows `b`.
   *
   * O(1) amortized in both naive and Bender impls. This is the
   * hot path — the Spineless priority queue calls compare per
   * insert/extract.
   */
  compare(a: OMNode, b: OMNode): number;
}

// --- Naive implementation ---

/**
 * Internal node type for the naive impl. Stored as a doubly-linked
 * list; `_omTag` is the sequential integer position.
 *
 * @internal
 */
interface NaiveNode {
  // Implements OMNode. The `_omTag` field is the public read-only
  // surface; we mutate it internally on renumber.
  _omTag: number;
  prev: NaiveNode | null;
  next: NaiveNode | null;
}

/**
 * Naive O(N)-per-insert Order Maintenance. Correctness-only impl
 * for scaffolding and as a fuzzer oracle for the future Bender impl.
 *
 * Invariants:
 * - `_omTag` is strictly increasing along the `next` chain.
 * - `_omTag` values are arbitrary integers but always orderable.
 * - Insert renumbers all trailing nodes to maintain monotonicity.
 *
 * @internal
 */
export class NaiveOrderMaintenance implements OrderMaintenance {
  private firstNode: NaiveNode | null = null;
  private nodeCount = 0;

  get size(): number {
    return this.nodeCount;
  }

  /**
   * Returns the first node in the order, or `null` if empty. Exposed
   * for tests and for the priority queue's extract-min operation.
   *
   * @internal
   */
  first(): OMNode | null {
    return this.firstNode;
  }

  init(): OMNode {
    const first: NaiveNode = { _omTag: 0, prev: null, next: null };
    this.firstNode = first;
    this.nodeCount = 1;
    return first;
  }

  insertAfter(after: OMNode): OMNode {
    const afterNode = after as NaiveNode;
    const newNode: NaiveNode = {
      _omTag: afterNode._omTag + 1,
      prev: afterNode,
      next: afterNode.next,
    };
    if (afterNode.next !== null) {
      afterNode.next.prev = newNode;
    }
    afterNode.next = newNode;
    // Renumber trailing nodes to maintain strict monotonicity.
    // O(N) worst case; this is the scaffolding-only cost the Bender
    // impl removes.
    let cursor = newNode.next;
    let nextTag = newNode._omTag + 1;
    while (cursor !== null) {
      cursor._omTag = nextTag;
      nextTag++;
      cursor = cursor.next;
    }
    this.nodeCount++;
    return newNode;
  }

  delete(node: OMNode): void {
    const n = node as NaiveNode;
    if (n.prev !== null) {
      n.prev.next = n.next;
    } else {
      this.firstNode = n.next;
    }
    if (n.next !== null) {
      n.next.prev = n.prev;
    }
    // Renumbering is not strictly required after delete (gaps in tags
    // are harmless), but consistency with insertAfter's invariant
    // (consecutive tags) simplifies reasoning. Skipped for now to
    // avoid an extra O(N) walk; tests should not rely on consecutive
    // tags after deletes.
    this.nodeCount--;
  }

  compare(a: OMNode, b: OMNode): number {
    const ta = (a as NaiveNode)._omTag;
    const tb = (b as NaiveNode)._omTag;
    return ta - tb;
  }
}
