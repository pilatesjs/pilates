// tools/reduce-fixture.ts
/**
 * Reduce a SpecNode JSON (or a fast-check counterexample's first arg)
 * to a commit-ready `.spec.json` fixture, pre-filled with both engines'
 * actual `getComputedLayout` output.
 *
 * Usage:
 *   pnpm tsx tools/reduce-fixture.ts <input.json> [options]
 *
 * See plan: docs/superpowers/plans/2026-05-25-divergence-allowlist-and-reduction.md
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  buildPilates,
  buildYoga,
  collectBoxes,
  loadFixtures,
  pilatesBox,
  yogaBox,
} from '../packages/core/test/fixture-loader.js';
import type { Box, SpecNode } from '../packages/core/test/fixture-loader.js';

interface CliOpts {
  inputPath: string;
  available?: { width?: number; height?: number };
  outPath?: string;
  name: string;
  fastCheck: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  if (argv.length < 1) {
    throw new Error(
      'usage: reduce-fixture.ts <input.json> [--available WxH] [--out <path>] [--name <name>] [--fast-check]',
    );
  }
  const out: CliOpts = { inputPath: '', name: 'tmp/<unnamed>', fastCheck: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--available') {
      const v = argv[++i];
      if (v === undefined) throw new Error('--available requires WxH');
      const m = /^(\d+)x(\d+)$/.exec(v);
      if (!m) throw new Error(`--available expected WxH, got ${v}`);
      out.available = { width: Number(m[1]), height: Number(m[2]) };
    } else if (arg === '--out') {
      const v = argv[++i];
      if (v === undefined) throw new Error('--out requires a path');
      out.outPath = v;
    } else if (arg === '--name') {
      const v = argv[++i];
      if (v === undefined) throw new Error('--name requires a string');
      out.name = v;
    } else if (arg === '--fast-check') {
      out.fastCheck = true;
    } else if (out.inputPath === '') {
      out.inputPath = arg;
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  if (out.inputPath === '') throw new Error('input.json path required');
  return out;
}

/** True iff EVERY node in the tree has a non-empty string id. */
export function allNodesHaveIds(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const n = node as { id?: unknown; children?: unknown };
  if (typeof n.id !== 'string' || n.id.length === 0) return false;
  if (Array.isArray(n.children)) {
    for (const c of n.children) {
      if (!allNodesHaveIds(c)) return false;
    }
  }
  return true;
}

/** Auto-assign n0, n1, ... in DFS pre-order. Returns a new tree. */
export function assignIds(node: unknown): SpecNode {
  let counter = 0;
  function go(n: unknown): SpecNode {
    if (typeof n !== 'object' || n === null) {
      throw new Error('input tree contains a non-object node');
    }
    const src = n as { style?: unknown; children?: unknown };
    const id = `n${counter++}`;
    const built: SpecNode =
      src.style !== undefined ? { id, style: src.style as SpecNode['style'] } : { id };
    if (Array.isArray(src.children) && src.children.length > 0) {
      built.children = src.children.map(go);
    }
    return built;
  }
  return go(node);
}

function shallowEqualBox(a: Box, b: Box): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

export function mapsEqual(a: Record<string, Box>, b: Record<string, Box>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const k of aKeys) {
    const aBox = a[k];
    const bBox = b[k];
    if (aBox === undefined || bBox === undefined) return false;
    if (!shallowEqualBox(aBox, bBox)) return false;
  }
  return true;
}

export function emitConsensus(
  name: string,
  available: CliOpts['available'],
  tree: SpecNode,
  boxes: Record<string, Box>,
): unknown {
  return {
    name,
    // NOTE: tags must be non-empty for loadFixtures; edit this before committing.
    tags: ['flex-direction'],
    ...(available !== undefined ? { available } : {}),
    root: tree,
    expected: boxes,
  };
}

export function emitDivergent(
  name: string,
  available: CliOpts['available'],
  tree: SpecNode,
  pBoxes: Record<string, Box>,
  yBoxes: Record<string, Box>,
): unknown {
  return {
    name,
    tags: ['divergent'],
    divergenceReason: '<TODO: fill in>',
    ...(available !== undefined ? { available } : {}),
    root: tree,
    expectedPilates: pBoxes,
    expectedYoga: yBoxes,
  };
}

/** Round-trip the emitted JSON through the loader as a self-test. */
function roundTrip(fixtureJson: unknown, sourceLabel: string): void {
  const tmp = mkdtempSync(join(tmpdir(), 'pilates-reduce-rt-'));
  try {
    writeFileSync(join(tmp, 'rt.spec.json'), JSON.stringify(fixtureJson));
    loadFixtures(tmp);
  } catch (err) {
    throw new Error(
      `[reduce-fixture] emitted fixture for ${sourceLabel} failed round-trip: ${(err as Error).message}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(readFileSync(opts.inputPath, 'utf8'));
  const rawTree = opts.fastCheck ? (raw as unknown[])[0] : raw;

  const tree: SpecNode = allNodesHaveIds(rawTree) ? (rawTree as SpecNode) : assignIds(rawTree);

  const p = buildPilates(tree);
  p.root.calculateLayout(opts.available?.width, opts.available?.height);
  const pActual = collectBoxes(p.byId, pilatesBox);

  const y = buildYoga(tree);
  y.root.calculateLayout(opts.available?.width, opts.available?.height);
  const yActual = collectBoxes(y.byId, yogaBox);
  y.root.freeRecursive();

  const agree = mapsEqual(pActual, yActual);
  const fixture = agree
    ? emitConsensus(opts.name, opts.available, tree, pActual)
    : emitDivergent(opts.name, opts.available, tree, pActual, yActual);

  roundTrip(fixture, opts.inputPath);

  const serialized = `${JSON.stringify(fixture, null, 2)}\n`;
  if (opts.outPath !== undefined) {
    const parent = dirname(opts.outPath);
    if (parent !== '' && parent !== '.') mkdirSync(parent, { recursive: true });
    writeFileSync(opts.outPath, serialized);
    process.stderr.write(`reduce-fixture: wrote ${opts.outPath}\n`);
  } else {
    process.stdout.write(serialized);
  }

  if (!agree) {
    process.stderr.write(
      'WARNING: Pilates and Yoga produced different layouts. The emitted fixture uses the divergent shape; fill in "divergenceReason" before committing.\n',
    );
  }
}

// Only run as CLI when invoked directly, not when imported by tests.
// On Windows, process.argv[1] uses backslashes and absolute paths start with a drive letter
// (e.g. C:\...), so pathToFileURL gives the canonical file:///C:/... URL that matches
// import.meta.url.
import { pathToFileURL } from 'node:url';
const argvUrl = process.argv[1] !== undefined ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === argvUrl) {
  main();
}
