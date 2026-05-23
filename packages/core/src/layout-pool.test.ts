import { beforeEach, describe, expect, test } from 'vitest';
import { Pool, _poolStats, _resetPoolForTesting, allocateNodeId } from './layout-pool.js';

describe('LayoutPool', () => {
  beforeEach(() => {
    _resetPoolForTesting();
  });

  test('allocateNodeId returns sequential IDs starting at 0', () => {
    const obj1 = {};
    const obj2 = {};
    const obj3 = {};
    expect(allocateNodeId(obj1)).toBe(0);
    expect(allocateNodeId(obj2)).toBe(1);
    expect(allocateNodeId(obj3)).toBe(2);
  });

  test('Pool exposes absCornersX and absCornersY as Float64Arrays', () => {
    expect(Pool.absCornersX).toBeInstanceOf(Float64Array);
    expect(Pool.absCornersY).toBeInstanceOf(Float64Array);
  });

  test('initial capacity is at least 1024', () => {
    expect(Pool.absCornersX.length).toBeGreaterThanOrEqual(1024);
    expect(Pool.absCornersY.length).toBeGreaterThanOrEqual(1024);
  });

  test('pool stats reflect allocations', () => {
    const obj = {};
    allocateNodeId(obj);
    const stats = _poolStats();
    expect(stats.nextId).toBe(1);
    expect(stats.capacity).toBeGreaterThanOrEqual(1024);
  });

  test('writes to Pool arrays persist by index', () => {
    const obj = {};
    const id = allocateNodeId(obj);
    Pool.absCornersX[id] = 42.5;
    Pool.absCornersY[id] = 100.25;
    expect(Pool.absCornersX[id]).toBe(42.5);
    expect(Pool.absCornersY[id]).toBe(100.25);
  });

  test('pool grows when nextId would exceed capacity', () => {
    const initialCapacity = _poolStats().capacity;
    // Allocate enough to force a grow
    const objs: object[] = [];
    for (let i = 0; i < initialCapacity + 10; i++) {
      objs.push({});
      allocateNodeId(objs[i]!);
    }
    const stats = _poolStats();
    expect(stats.capacity).toBeGreaterThan(initialCapacity);
    expect(Pool.absCornersX.length).toBe(stats.capacity);
    expect(Pool.absCornersY.length).toBe(stats.capacity);
  });

  test('data is preserved across pool growth', () => {
    const obj = {};
    const id = allocateNodeId(obj);
    Pool.absCornersX[id] = 99.5;
    // Force growth
    const fillerObjs: object[] = [];
    const initialCap = _poolStats().capacity;
    for (let i = 0; i < initialCap; i++) {
      fillerObjs.push({});
      allocateNodeId(fillerObjs[i]!);
    }
    // The original write should still be there
    expect(Pool.absCornersX[id]).toBe(99.5);
  });

  test('_resetPoolForTesting clears state', () => {
    const objs: object[] = [];
    for (let i = 0; i < 100; i++) {
      objs.push({});
      allocateNodeId(objs[i]!);
    }
    expect(_poolStats().nextId).toBe(100);
    _resetPoolForTesting();
    expect(_poolStats().nextId).toBe(0);
    expect(_poolStats().freeCount).toBe(0);
  });
});
