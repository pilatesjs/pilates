/**
 * LayoutPool — typed-array storage indexed by Node._id.
 *
 * Manages Float64Arrays for absolute corner coordinates used by
 * roundLayout. IDs are allocated at Node construction and recycled
 * via FinalizationRegistry when the Node is garbage-collected.
 *
 * @internal
 */

const INITIAL_CAPACITY = 1024;

/**
 * Mutable pool object. Properties are reassigned during growth so that
 * consumers reading `Pool.absCornersX[id]` always see the latest array.
 */
export const Pool: {
  absCornersX: Float64Array;
  absCornersY: Float64Array;
} = {
  absCornersX: new Float64Array(INITIAL_CAPACITY),
  absCornersY: new Float64Array(INITIAL_CAPACITY),
};

let _nextId = 0;
let _capacity = INITIAL_CAPACITY;
const _freeIds: number[] = [];

const _registry = new FinalizationRegistry<number>((id: number) => {
  _freeIds.push(id);
});

function growPool(): void {
  const newCapacity = _capacity * 2;
  const newX = new Float64Array(newCapacity);
  const newY = new Float64Array(newCapacity);
  newX.set(Pool.absCornersX);
  newY.set(Pool.absCornersY);
  Pool.absCornersX = newX;
  Pool.absCornersY = newY;
  _capacity = newCapacity;
}

/**
 * Allocate a unique integer ID for `node`. The ID is recycled via
 * FinalizationRegistry when `node` becomes unreachable.
 *
 * @internal
 */
export function allocateNodeId(node: object): number {
  let id: number;
  if (_freeIds.length > 0) {
    id = _freeIds.pop()!;
  } else {
    if (_nextId >= _capacity) {
      growPool();
    }
    id = _nextId++;
  }
  _registry.register(node, id);
  return id;
}

/**
 * Returns diagnostic stats about the pool. Intended for tests only.
 *
 * @internal
 */
export function _poolStats(): { capacity: number; nextId: number; freeCount: number } {
  return { capacity: _capacity, nextId: _nextId, freeCount: _freeIds.length };
}

/**
 * Reset pool to initial state. Call in `beforeEach` in tests only.
 *
 * @internal
 */
export function _resetPoolForTesting(): void {
  Pool.absCornersX = new Float64Array(INITIAL_CAPACITY);
  Pool.absCornersY = new Float64Array(INITIAL_CAPACITY);
  _nextId = 0;
  _capacity = INITIAL_CAPACITY;
  _freeIds.length = 0;
}
