import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildPilates,
  buildYoga,
  collectBoxes,
  formatBoxDiff,
  loadFixtures,
  pilatesBox,
  yogaBox,
} from './fixture-loader.js';
import type { SpecNode } from './fixture-loader.js';

describe('fixture-loader validation', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pilates-fixtures-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeSpec(name: string, body: unknown): void {
    writeFileSync(join(dir, name), JSON.stringify(body));
  }

  it('loads a minimal valid fixture', () => {
    writeSpec('a.spec.json', {
      name: 'flex-direction/row',
      tags: ['flex-direction'],
      root: { id: 'root', style: { width: 10, height: 1 } },
      expected: { root: { left: 0, top: 0, width: 10, height: 1 } },
    });
    const fx = loadFixtures(dir);
    expect(fx).toHaveLength(1);
    expect(fx[0]!.name).toBe('flex-direction/row');
    expect(fx[0]!.tags).toEqual(['flex-direction']);
  });

  it('rejects unknown tag', () => {
    writeSpec('bad-tag.spec.json', {
      name: 'x',
      tags: ['bogus'],
      root: { id: 'root' },
      expected: { root: { left: 0, top: 0, width: 0, height: 0 } },
    });
    expect(() => loadFixtures(dir)).toThrow(/unknown tag/);
  });

  it('rejects empty tags array', () => {
    writeSpec('empty-tags.spec.json', {
      name: 'x',
      tags: [],
      root: { id: 'root' },
      expected: { root: { left: 0, top: 0, width: 0, height: 0 } },
    });
    expect(() => loadFixtures(dir)).toThrow(/non-empty array/);
  });

  it('rejects duplicate ids', () => {
    writeSpec('dup.spec.json', {
      name: 'x',
      tags: ['gap'],
      root: { id: 'a', children: [{ id: 'a' }] },
      expected: {
        a: { left: 0, top: 0, width: 0, height: 0 },
      },
    });
    expect(() => loadFixtures(dir)).toThrow(/duplicate id/);
  });

  it('rejects id in tree without expected box', () => {
    writeSpec('missing-expected.spec.json', {
      name: 'x',
      tags: ['gap'],
      root: { id: 'root', children: [{ id: 'kid' }] },
      expected: { root: { left: 0, top: 0, width: 0, height: 0 } },
    });
    expect(() => loadFixtures(dir)).toThrow(/no expected box/);
  });

  it('rejects expected box with no matching tree node', () => {
    writeSpec('extra-expected.spec.json', {
      name: 'x',
      tags: ['gap'],
      root: { id: 'root' },
      expected: {
        root: { left: 0, top: 0, width: 0, height: 0 },
        ghost: { left: 0, top: 0, width: 0, height: 0 },
      },
    });
    expect(() => loadFixtures(dir)).toThrow(/not in tree/);
  });

  it('discovers fixtures in subdirectories deterministically', () => {
    mkdirSync(join(dir, 'gap'));
    writeSpec('gap/one.spec.json', {
      name: 'gap/one',
      tags: ['gap'],
      root: { id: 'r' },
      expected: { r: { left: 0, top: 0, width: 0, height: 0 } },
    });
    mkdirSync(join(dir, 'flex-direction'));
    writeSpec('flex-direction/a.spec.json', {
      name: 'flex-direction/a',
      tags: ['flex-direction'],
      root: { id: 'r' },
      expected: { r: { left: 0, top: 0, width: 0, height: 0 } },
    });
    const fx = loadFixtures(dir);
    expect(fx.map(f => f.name)).toEqual(['flex-direction/a', 'gap/one']);
  });
});

describe('fixture-loader builders', () => {
  it('builds equivalent Pilates and Yoga trees from a spec', () => {
    const spec: SpecNode = {
      id: 'root',
      style: { flexDirection: 'row', width: 60, height: 5, justifyContent: 'space-between' },
      children: [
        { id: 'a', style: { width: 10 } },
        { id: 'b', style: { width: 10 } },
        { id: 'c', style: { width: 10 } },
      ],
    };
    const p = buildPilates(spec);
    p.root.calculateLayout();
    const y = buildYoga(spec);
    y.root.calculateLayout(undefined, undefined);
    const expected = {
      root: { left: 0, top: 0, width: 60, height: 5 },
      a: { left: 0, top: 0, width: 10, height: 5 },
      b: { left: 25, top: 0, width: 10, height: 5 },
      c: { left: 50, top: 0, width: 10, height: 5 },
    };
    expect(collectBoxes(p.byId, pilatesBox)).toEqual(expected);
    expect(collectBoxes(y.byId, yogaBox)).toEqual(expected);
    y.root.freeRecursive();
  });
});

describe('formatBoxDiff', () => {
  it('marks matching ids ok and divergences as expected→got', () => {
    const expected = {
      root: { left: 0, top: 0, width: 10, height: 5 },
      a: { left: 0, top: 0, width: 5, height: 5 },
    };
    const got = {
      root: { left: 0, top: 0, width: 10, height: 5 },
      a: { left: 1, top: 0, width: 5, height: 5 },
    };
    const out = formatBoxDiff('Pilates', expected, got);
    expect(out).toContain('Pilates');
    expect(out).toContain('root: ok');
    expect(out).toContain('a: expected=0,0 5x5  got=1,0 5x5');
  });
});
