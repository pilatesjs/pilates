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

/** Reset for tests. @internal */
export function _resetFieldIdsForTesting(): void {
  _nextFieldId = 0;
}
