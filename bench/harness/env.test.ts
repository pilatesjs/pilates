import { describe, expect, test } from 'vitest';
import { snapshotEnv } from './env.js';

describe('snapshotEnv', () => {
  test('returns an object with the documented shape', () => {
    const env = snapshotEnv();
    expect(env.node).toMatch(/^v\d+\.\d+/);
    expect(typeof env.platform).toBe('string');
    expect(typeof env.arch).toBe('string');
    expect(env.platformId).toBe(`${env.platform}-${env.arch}`);
    expect(typeof env.cpu.model).toBe('string');
    expect(env.cpu.cores).toBeGreaterThan(0);
    expect(typeof env.os).toBe('string');
    expect(typeof env.git.sha).toBe('string');
    expect(env.git.sha.length).toBeGreaterThanOrEqual(7);
    expect(typeof env.git.branch).toBe('string');
    expect(typeof env.git.dirty).toBe('boolean');
    expect(env.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
    expect(typeof env.packages).toBe('object');
  });

  test('captures @pilates/core version from its package.json', () => {
    const env = snapshotEnv();
    expect(env.packages['@pilates/core']).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('platformId is stable across calls', () => {
    expect(snapshotEnv().platformId).toBe(snapshotEnv().platformId);
  });
});
