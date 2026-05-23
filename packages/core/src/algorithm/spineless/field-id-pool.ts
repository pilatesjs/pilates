/**
 * Monotonic integer ID allocator for Spineless `Field` objects.
 * Phase 15I indexes the runtime's typed-array storage by field.id.
 *
 * IDs are never recycled — Fields are interned per (node, name) and
 * live as long as their node. The max id is the live-field high-water
 * mark, matching LayoutPool's accepted tradeoff.
 *
 * @internal
 */

let _nextFieldId = 0;

/** Allocate a fresh unique integer id for a Field. */
export function allocateFieldId(): number {
  return _nextFieldId++;
}

/** Current id count — the exclusive upper bound of allocated ids.
 *  Runtime typed arrays size to at least this. @internal */
export function fieldIdCount(): number {
  return _nextFieldId;
}

/** Reset for tests. @internal
 *
 * WARNING: Only safe to call when no live `Field` objects exist
 * anywhere — the `FIELD_REGISTRY` WeakMap in `grammar.ts` is NOT
 * cleared, so any `Field` retained across this call still holds
 * its old id. Newly-allocated fields will then collide with retained
 * ids, aliasing entries in the runtime's typed-array storage. The
 * standard test harness creates fresh `Node`s per test, so retained
 * cross-test references are the only way to hit this; don't introduce
 * them.
 */
export function _resetFieldIdsForTesting(): void {
  _nextFieldId = 0;
}
