/**
 * Smoke tests for the bin entry point. Drives the script via tsx as a
 * subprocess so we exercise the same shebang path users hit via
 * `npm create pilates-app`.
 *
 * Behavior tests for the underlying `createApp()` function (template
 * copy, name substitution, existing-dir error) are in `create-app.test.ts`.
 * This file only covers what's unique to `index.ts`: argv parsing, help
 * flag, error formatting, and exit codes.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const BIN = resolve(HERE, 'index.ts');
// Run node from the repo root so it can resolve `tsx` from node_modules.
const REPO_ROOT = resolve(HERE, '..', '..', '..');

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runBin(args: string[]): RunResult {
  try {
    const out = execFileSync('node', ['--import', 'tsx', BIN, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout: out, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      code: err.status ?? 1,
      stdout: typeof err.stdout === 'string' ? err.stdout : (err.stdout?.toString() ?? ''),
      stderr: typeof err.stderr === 'string' ? err.stderr : (err.stderr?.toString() ?? ''),
    };
  }
}

describe('create-pilates-app CLI', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'pilates-cli-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('prints usage for --help and exits 0', () => {
    const r = runBin(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage:');
  });

  it('prints usage for -h short flag and exits 0', () => {
    const r = runBin(['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage:');
  });

  it('scaffolds a project from a positional directory arg', () => {
    const target = join(workdir, 'my-app');
    const r = runBin([target]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Scaffolded');
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(target, 'package.json'))).toBe(true);

    const pkg = readFileSync(join(target, 'package.json'), 'utf8');
    expect(pkg).toContain('my-app');
    expect(pkg).not.toContain('__PROJECT_NAME__');
  });

  it('exits non-zero with an error message when the target already exists and is non-empty', () => {
    const target = join(workdir, 'occupied');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'leftover.txt'), 'preexisting');

    const r = runBin([target]);
    expect(r.code).toBe(1);
    expect(r.stderr.toLowerCase()).toContain('already exists');
  });
});
