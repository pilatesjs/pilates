import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './create-app.js';

describe('createApp', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cpa-test-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('scaffolds every expected file into a new directory', () => {
    const target = join(tmp, 'my-app');
    createApp({ targetDir: target, projectName: 'my-app' });
    for (const f of ['package.json', 'tsconfig.json', 'index.tsx', 'README.md', '.gitignore']) {
      expect(existsSync(join(target, f))).toBe(true);
    }
  });

  it('delivers _gitignore as .gitignore and leaves no _gitignore behind', () => {
    const target = join(tmp, 'app');
    createApp({ targetDir: target, projectName: 'app' });
    expect(existsSync(join(target, '.gitignore'))).toBe(true);
    expect(readdirSync(target)).not.toContain('_gitignore');
  });

  it('substitutes the project name into package.json', () => {
    const target = join(tmp, 'cool-tui');
    createApp({ targetDir: target, projectName: 'cool-tui' });
    const raw = readFileSync(join(target, 'package.json'), 'utf8');
    expect(JSON.parse(raw).name).toBe('cool-tui');
    expect(raw).not.toContain('__PROJECT_NAME__');
  });

  it('substitutes the project name into README.md', () => {
    const target = join(tmp, 'cool-tui');
    createApp({ targetDir: target, projectName: 'cool-tui' });
    const readme = readFileSync(join(target, 'README.md'), 'utf8');
    expect(readme).toContain('cool-tui');
    expect(readme).not.toContain('__PROJECT_NAME__');
  });

  it('generates an index.tsx importing the @pilates/react API', () => {
    const target = join(tmp, 'app');
    createApp({ targetDir: target, projectName: 'app' });
    const index = readFileSync(join(target, 'index.tsx'), 'utf8');
    expect(index).toContain("from '@pilates/react'");
    for (const sym of ['Box', 'Text', 'render', 'useApp', 'useInput']) {
      expect(index).toContain(sym);
    }
  });

  it('throws when the target directory exists and is non-empty', () => {
    const target = join(tmp, 'occupied');
    createApp({ targetDir: target, projectName: 'occupied' });
    expect(() => createApp({ targetDir: target, projectName: 'occupied' })).toThrow(/not empty/);
  });
});
