/**
 * Environment snapshot for bench reproducibility. Captures the
 * data that varies across bench-machine, time, and code revision —
 * everything else (scenario shapes, harness behaviour) is determined
 * by the source tree.
 *
 * @internal
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface EnvSnapshot {
  /** Node.js version, e.g. "v22.21.0". */
  node: string;
  /** `process.platform`, e.g. "darwin" / "linux" / "win32". */
  platform: string;
  /** `process.arch`, e.g. "arm64" / "x64". */
  arch: string;
  /** Combination `${platform}-${arch}` — keys thresholds.json + history. */
  platformId: string;
  /** CPU model + logical core count. */
  cpu: { model: string; cores: number };
  /** OS release string from `os.release()`. */
  os: string;
  /** Git position: HEAD SHA (full), branch, and dirty-flag. */
  git: { sha: string; branch: string; dirty: boolean };
  /** ISO 8601 UTC timestamp of the snapshot. */
  timestamp: string;
  /** Workspace package versions, keyed by package name. */
  packages: Record<string, string>;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function readPackageVersion(pkgRelPath: string): string | undefined {
  try {
    const json = JSON.parse(
      readFileSync(resolve(REPO_ROOT, pkgRelPath, 'package.json'), 'utf8'),
    ) as { name: string; version: string };
    return json.version;
  } catch {
    return undefined;
  }
}

export function snapshotEnv(): EnvSnapshot {
  const cpuList = cpus();
  const packages: Record<string, string> = {};
  for (const pkg of ['core', 'render', 'diff', 'react', 'widgets']) {
    const v = readPackageVersion(`packages/${pkg}`);
    if (v !== undefined) packages[`@pilates/${pkg}`] = v;
  }
  const sha = git('rev-parse HEAD');
  const branch = git('rev-parse --abbrev-ref HEAD');
  const dirty = git('status --porcelain').length > 0;
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    platformId: `${process.platform}-${process.arch}`,
    cpu: {
      model: cpuList[0]?.model ?? 'unknown',
      cores: cpuList.length,
    },
    os: release(),
    git: { sha, branch, dirty },
    timestamp: new Date().toISOString(),
    packages,
  };
}
