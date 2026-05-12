/**
 * Order-Maintenance-keyed priority queue.
 *
 * The hot data structure of the Spineless Traversal runtime (Kirisame,
 * Wang, Panchekha — PLDI 2025). Each item is keyed by an {@link OMNode}
 * representing its position in the layout-field traversal order; the
 * queue extracts items in OM-order, so the runtime always processes
 * the earliest-dirty field next.
 *
 * Implementation: binary min-heap over `{ value, omNode }` records.
 * Ordering uses `om.compare(a.omNode, b.omNode)`. Standard O(log N)
 * push/popMin, O(1) peek/size.
 *
 * Membership tracking: an internal `Set` allows O(1) `has(value)`
 * queries so the Spineless runtime can avoid enqueueing the same
 * field twice. Important: this assumes `value` instances are stable
 * (used as Map keys via reference equality), which fits the Spineless
 * "one OMNode per (Node, field-name) pair, allocated once" model.
 *
 * ## Correctness under OM relabel
 *
 * The OM data structure may relabel internal tags on insert
 * (`BenderOrderMaintenance`'s windowed redistribute). The heap
 * invariant is "parent ≤ all descendants by OM compare". A relabel
 * preserves the RELATIVE order of all live OM nodes, so
 * `sign(compare(a, b))` is unchanged — the heap invariant holds.
 *
 * @internal
 */

import type { OMNode, OrderMaintenance } from './order-maintenance.js';

/**
 * @internal
 */
export class OmPriorityQueue<T> {
  private readonly om: OrderMaintenance;
  // Parallel arrays for the heap. heapValue[i] is the user-supplied
  // value; heapOmNode[i] is its OM position. Using parallel arrays
  // rather than {value, omNode} pair objects avoids per-push
  // allocation, which matters at Spineless-runtime scale (10k+
  // pushes per layout pass at the largest TUI tree size).
  private readonly heapValue: T[] = [];
  private readonly heapOmNode: OMNode[] = [];
  // Membership set keyed by reference. Allows O(1) `has` checks.
  private readonly members: Set<T> = new Set();

  constructor(om: OrderMaintenance) {
    this.om = om;
  }

  get size(): number {
    return this.heapValue.length;
  }

  isEmpty(): boolean {
    return this.heapValue.length === 0;
  }

  has(value: T): boolean {
    return this.members.has(value);
  }

  /**
   * Push a value at the given OM position. Caller is responsible for
   * checking `has(value)` first if dedup matters (some workflows
   * intentionally re-enqueue after deletion).
   *
   * Returns `true` if added, `false` if `value` was already present
   * (no-op — the queue is unchanged, original OM position retained).
   */
  push(value: T, omNode: OMNode): boolean {
    if (this.members.has(value)) return false;
    this.heapValue.push(value);
    this.heapOmNode.push(omNode);
    this.members.add(value);
    this.siftUp(this.heapValue.length - 1);
    return true;
  }

  /**
   * Return (without removing) the value at OM-minimum. Returns
   * `undefined` if the queue is empty.
   */
  peek(): T | undefined {
    return this.heapValue[0];
  }

  /**
   * Remove and return the OM-minimum value. Returns `undefined` if
   * the queue is empty.
   */
  popMin(): T | undefined {
    const n = this.heapValue.length;
    if (n === 0) return undefined;
    const top = this.heapValue[0]!;
    const last = n - 1;
    if (last > 0) {
      this.heapValue[0] = this.heapValue[last]!;
      this.heapOmNode[0] = this.heapOmNode[last]!;
    }
    this.heapValue.length = last;
    this.heapOmNode.length = last;
    this.members.delete(top);
    if (last > 0) this.siftDown(0);
    return top;
  }

  /**
   * Sift the element at index `start` up the heap until heap property
   * is restored. O(log N).
   */
  private siftUp(start: number): void {
    let i = start;
    const value = this.heapValue[i]!;
    const omNode = this.heapOmNode[i]!;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentOm = this.heapOmNode[parent]!;
      if (this.om.compare(omNode, parentOm) >= 0) break;
      this.heapValue[i] = this.heapValue[parent]!;
      this.heapOmNode[i] = parentOm;
      i = parent;
    }
    this.heapValue[i] = value;
    this.heapOmNode[i] = omNode;
  }

  /**
   * Sift the element at index `start` down the heap until heap property
   * is restored. O(log N).
   */
  private siftDown(start: number): void {
    let i = start;
    const n = this.heapValue.length;
    const value = this.heapValue[i]!;
    const omNode = this.heapOmNode[i]!;
    const halfN = n >> 1;
    while (i < halfN) {
      let bestChild = (i << 1) | 1; // 2i + 1, left child
      const right = bestChild + 1;
      if (right < n) {
        if (this.om.compare(this.heapOmNode[right]!, this.heapOmNode[bestChild]!) < 0) {
          bestChild = right;
        }
      }
      if (this.om.compare(this.heapOmNode[bestChild]!, omNode) >= 0) break;
      this.heapValue[i] = this.heapValue[bestChild]!;
      this.heapOmNode[i] = this.heapOmNode[bestChild]!;
      i = bestChild;
    }
    this.heapValue[i] = value;
    this.heapOmNode[i] = omNode;
  }
}
