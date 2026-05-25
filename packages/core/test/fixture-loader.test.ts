import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadFixtures } from './fixture-loader.js';

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
