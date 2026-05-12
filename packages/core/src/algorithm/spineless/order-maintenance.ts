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

// --- Bender et al. 2002 Algorithm 1 (list-labeling with windowed relabel) ---

/**
 * Label space. Labels live in `[0, LABEL_MAX)`. Using 2^30 keeps every
 * arithmetic op (midpoint, double, mask) in V8's 31-bit SMI range, so
 * the JIT lowers everything to native int instructions. At 2^30 we can
 * host ~50M items before any global rebalance is forced — far above
 * typical TUI scale.
 *
 * @internal
 */
const LABEL_MAX = 1 << 30;

/**
 * Internal node for Bender impl. Doubly-linked list with mutable label.
 *
 * @internal
 */
interface BenderNode {
  _omTag: number;
  prev: BenderNode | null;
  next: BenderNode | null;
}

/**
 * Bender, Cole, Demaine, Farach-Colton, Zito (2002): "Two simplified
 * algorithms for maintaining order in a list." Algorithm 1 — list-
 * labeling with exponentially-growing window relabel.
 *
 * Operations:
 * - `compare`: O(1) integer subtract.
 * - `insertAfter`: amortized O(log N) per operation (looser than the
 *   paper's O(1) amortized when using density bound (3/2)^d at depth d;
 *   we trade a log factor for simpler integer arithmetic and avoid
 *   BigInt).
 * - `delete`: O(1).
 *
 * Cross-validated against `NaiveOrderMaintenance` via property fuzzer.
 *
 * @internal
 */
export class BenderOrderMaintenance implements OrderMaintenance {
  private firstNode: BenderNode | null = null;
  private nodeCount = 0;

  get size(): number {
    return this.nodeCount;
  }

  first(): OMNode | null {
    return this.firstNode;
  }

  init(): OMNode {
    // Start label at the middle of the space so first inserts have room
    // both before (via the global rebalance path) and after.
    const first: BenderNode = { _omTag: LABEL_MAX >> 1, prev: null, next: null };
    this.firstNode = first;
    this.nodeCount = 1;
    return first;
  }

  insertAfter(after: OMNode): OMNode {
    const pred = after as BenderNode;
    const succ = pred.next;
    const succLabel = succ === null ? LABEL_MAX : succ._omTag;
    const predLabel = pred._omTag;

    // Midpoint between predecessor and successor labels. Integer-only.
    const newLabel = (predLabel + succLabel) >> 1;

    const newNode: BenderNode = { _omTag: newLabel, prev: pred, next: succ };
    pred.next = newNode;
    if (succ !== null) succ.prev = newNode;
    this.nodeCount++;

    if (newLabel === predLabel) {
      // No room between pred and succ — trigger a windowed relabel.
      // Relabel updates newNode._omTag (and others in the window) to
      // spread out across available label space.
      this.relabel(newNode);
    }

    return newNode;
  }

  delete(node: OMNode): void {
    const n = node as BenderNode;
    if (n.prev !== null) {
      n.prev.next = n.next;
    } else {
      this.firstNode = n.next;
    }
    if (n.next !== null) {
      n.next.prev = n.prev;
    }
    this.nodeCount--;
    // Delete only creates extra label room; no rebalance needed.
  }

  compare(a: OMNode, b: OMNode): number {
    return (a as BenderNode)._omTag - (b as BenderNode)._omTag;
  }

  /**
   * Walk exponentially-growing windows around `pivot` until a window
   * with low enough density to redistribute is found. Redistribute
   * labels uniformly across that window.
   *
   * Density bound: `count * 2 ≤ span`. This guarantees:
   *   - Every node gets a distinct integer label (count ≤ span).
   *   - Each interval between consecutive labels has at least 2 units
   *     of room, so subsequent midpoint inserts succeed without
   *     triggering relabel again at the same depth.
   *
   * Window definition at depth d:
   *   span    = 2^d
   *   tagLow  = pivot._omTag aligned down to multiple of span
   *   tagHigh = tagLow + span
   *
   * Amortized cost: O(log N) per insert. (Tighter than the paper's
   * O(1) amortized with density bound (3/2)^d, but the bound here uses
   * pure integer arithmetic for V8-friendly speed.)
   *
   * @internal
   */
  private relabel(pivot: BenderNode): void {
    let depth = 1;
    let span = 2;

    while (true) {
      // Find aligned window boundaries around the pivot's current label.
      const mask = (LABEL_MAX - 1) ^ (span - 1);
      const tagLow = pivot._omTag & mask;
      const tagHigh = tagLow + span;

      // Find leftmost node in the window by walking back from pivot.
      let firstInWindow = pivot;
      while (firstInWindow.prev !== null && firstInWindow.prev._omTag >= tagLow) {
        firstInWindow = firstInWindow.prev;
      }

      // Count nodes in the window and collect them in-order.
      const inWindow: BenderNode[] = [];
      let cursor: BenderNode | null = firstInWindow;
      while (cursor !== null && cursor._omTag < tagHigh) {
        inWindow.push(cursor);
        cursor = cursor.next;
      }

      const count = inWindow.length;

      // Density bound: redistribute only when there's at least 2x
      // headroom in the window. This guarantees distinct labels +
      // future-insert room without immediate re-relabel.
      if (count * 2 <= span) {
        const step = Math.max(1, (span / count) | 0);
        // Center the assigned range: leave equal padding at both ends.
        const used = (count - 1) * step + 1;
        const startPad = Math.max(0, (span - used) >> 1);
        let label = tagLow + startPad;
        for (const node of inWindow) {
          node._omTag = label;
          label += step;
        }
        return;
      }

      // Window overcrowded — expand. Doubling depth doubles span.
      // If span exceeds the label space, fall back to a global relabel.
      depth++;
      span <<= 1;
      if (span >= LABEL_MAX) {
        this.globalRelabel();
        return;
      }
    }
  }

  /**
   * Fallback when the windowed relabel walks all the way up to the
   * full label space without finding a sparse-enough window. Spreads
   * every node uniformly across [0, LABEL_MAX).
   *
   * @internal
   */
  private globalRelabel(): void {
    const all: BenderNode[] = [];
    let cursor = this.firstNode;
    while (cursor !== null) {
      all.push(cursor);
      cursor = cursor.next;
    }
    const stride = Math.max(1, (LABEL_MAX / (all.length + 1)) | 0);
    let label = stride;
    for (const node of all) {
      node._omTag = label;
      label += stride;
    }
  }
}
