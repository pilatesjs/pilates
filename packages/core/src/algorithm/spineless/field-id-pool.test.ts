import { beforeEach, describe, expect, test } from 'vitest';
import { Node } from '../../node.js';
import { _resetFieldIdsForTesting, allocateFieldId, fieldIdCount } from './field-id-pool.js';
import { field } from './grammar.js';

describe('FieldIdPool', () => {
  beforeEach(() => {
    _resetFieldIdsForTesting();
  });

  test('allocateFieldId returns sequential ids starting at 0', () => {
    expect(allocateFieldId()).toBe(0);
    expect(allocateFieldId()).toBe(1);
    expect(allocateFieldId()).toBe(2);
  });

  test('fieldIdCount reflects allocated count', () => {
    expect(fieldIdCount()).toBe(0);
    allocateFieldId();
    expect(fieldIdCount()).toBe(1);
    allocateFieldId();
    expect(fieldIdCount()).toBe(2);
  });

  test('_resetFieldIdsForTesting resets the counter', () => {
    allocateFieldId();
    allocateFieldId();
    allocateFieldId();
    expect(fieldIdCount()).toBe(3);
    _resetFieldIdsForTesting();
    expect(fieldIdCount()).toBe(0);
    expect(allocateFieldId()).toBe(0);
  });
});

describe('field() — id assignment', () => {
  beforeEach(() => {
    _resetFieldIdsForTesting();
  });

  test('field(node, name) returns an object with a numeric id', () => {
    const node = Node.create();
    const f = field(node, 'width');
    expect(typeof f.id).toBe('number');
    expect(Number.isInteger(f.id)).toBe(true);
    expect(f.id).toBeGreaterThanOrEqual(0);
  });

  test('calling field(node, name) twice returns the SAME object (interning preserved)', () => {
    const node = Node.create();
    const a = field(node, 'width');
    const b = field(node, 'width');
    expect(a).toBe(b);
    expect(a.id).toBe(b.id);
  });

  test('different (node, name) pairs get distinct ids', () => {
    const node = Node.create();
    const w = field(node, 'width');
    const h = field(node, 'height');
    expect(w.id).not.toBe(h.id);
  });
});
