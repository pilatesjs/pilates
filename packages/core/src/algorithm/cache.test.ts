import { describe, expect, it } from 'vitest';
import { MeasureMode } from '../measure-func.js';
import { MeasureCache } from './cache.js';

describe('MeasureCache', () => {
  const KEY_A = {
    availableWidth: 10,
    widthMode: MeasureMode.AtMost,
    availableHeight: 5,
    heightMode: MeasureMode.AtMost,
  };
  const KEY_B = {
    availableWidth: 20,
    widthMode: MeasureMode.Exactly,
    availableHeight: 10,
    heightMode: MeasureMode.AtMost,
  };
  const KEY_C = {
    availableWidth: 30,
    widthMode: MeasureMode.Undefined,
    availableHeight: 7,
    heightMode: MeasureMode.Undefined,
  };

  it('returns undefined on empty cache', () => {
    const c = new MeasureCache();
    expect(c.lookup(KEY_A)).toBeUndefined();
  });

  it('stores and retrieves an entry by exact key match', () => {
    const c = new MeasureCache();
    c.store(KEY_A, { width: 8, height: 4 });
    expect(c.lookup(KEY_A)).toEqual({ width: 8, height: 4 });
  });

  it('returns undefined when any key field differs', () => {
    const c = new MeasureCache();
    c.store(KEY_A, { width: 8, height: 4 });
    expect(c.lookup({ ...KEY_A, availableWidth: 11 })).toBeUndefined();
    expect(c.lookup({ ...KEY_A, widthMode: MeasureMode.Exactly })).toBeUndefined();
    expect(c.lookup({ ...KEY_A, availableHeight: 6 })).toBeUndefined();
    expect(c.lookup({ ...KEY_A, heightMode: MeasureMode.Exactly })).toBeUndefined();
  });

  it('overwrites the value when storing the same key twice', () => {
    const c = new MeasureCache();
    c.store(KEY_A, { width: 8, height: 4 });
    c.store(KEY_A, { width: 9, height: 5 });
    expect(c.lookup(KEY_A)).toEqual({ width: 9, height: 5 });
  });

  it('keeps eight distinct entries (slot capacity)', () => {
    const c = new MeasureCache();
    const keys = Array.from({ length: 8 }, (_, i) => ({
      availableWidth: 10 + i,
      widthMode: MeasureMode.AtMost,
      availableHeight: 5,
      heightMode: MeasureMode.AtMost,
    }));
    keys.forEach((k, i) => c.store(k, { width: i, height: i }));
    keys.forEach((k, i) => {
      expect(c.lookup(k)).toEqual({ width: i, height: i });
    });
  });

  it('evicts the oldest entry when a ninth distinct key is stored', () => {
    const c = new MeasureCache();
    const keys = Array.from({ length: 9 }, (_, i) => ({
      availableWidth: 10 + i,
      widthMode: MeasureMode.AtMost,
      availableHeight: 5,
      heightMode: MeasureMode.AtMost,
    }));
    keys.forEach((k, i) => c.store(k, { width: i, height: i }));
    expect(c.lookup(keys[0]!)).toBeUndefined();
    for (let i = 1; i < 9; i++) {
      expect(c.lookup(keys[i]!)).toEqual({ width: i, height: i });
    }
  });

  it('clear() drops every entry', () => {
    const c = new MeasureCache();
    c.store(KEY_A, { width: 8, height: 4 });
    c.store(KEY_B, { width: 18, height: 9 });
    c.clear();
    expect(c.lookup(KEY_A)).toBeUndefined();
    expect(c.lookup(KEY_B)).toBeUndefined();
  });

  it('treats Infinity as a valid availableWidth/Height key value', () => {
    const c = new MeasureCache();
    const inf = {
      availableWidth: Infinity,
      widthMode: MeasureMode.Undefined,
      availableHeight: Infinity,
      heightMode: MeasureMode.Undefined,
    };
    c.store(inf, { width: 5, height: 5 });
    expect(c.lookup(inf)).toEqual({ width: 5, height: 5 });
  });

  it('tracks hits and misses', () => {
    const c = new MeasureCache();
    expect(c.hits).toBe(0);
    expect(c.misses).toBe(0);
    c.lookup(KEY_A);
    expect(c.misses).toBe(1);
    c.store(KEY_A, { width: 8, height: 4 });
    c.lookup(KEY_A);
    c.lookup(KEY_A);
    expect(c.hits).toBe(2);
    expect(c.misses).toBe(1);
  });
});
