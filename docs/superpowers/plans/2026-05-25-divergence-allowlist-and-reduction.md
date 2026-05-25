# Phase 3.2 — Divergence Allowlist + Reduction Workflow Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `.spec.json` schema with a divergence shape (per-engine expected boxes + `divergenceReason`); add `tools/reduce-fixture.ts` CLI to convert SpecNode JSON / fast-check counterexamples into commit-ready fixtures.

**Architecture:** Loader gains a discriminated union (`ConsensusFixture | DivergentFixture`) and matching validation. Runner branches on `isDivergent`. CLI tool imports the loader's types + builders; round-trips its own output through `loadFixtures` as a self-test.

**Tech Stack:** TypeScript, vitest, pnpm, tsx (for the CLI), biome (format).

**Spec:** `docs/superpowers/specs/2026-05-25-divergence-allowlist-and-reduction-design.md`
**Branch:** `feat/divergence-allowlist-and-reduction` (already created from commit `492146e`).

---

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `packages/core/test/fixture-loader.ts` | modify | Discriminated `Fixture` union, `isDivergent` helper, divergent-shape validation, new `divergent` tag |
| `packages/core/test/fixture-loader.test.ts` | modify | Validation coverage for the new shape |
| `packages/core/test/fixtures.test.ts` | modify | Branch on `isDivergent` |
| `packages/core/test/fixtures/<bucket>/<one-real-or-synthetic-divergent>.spec.json` | create | Exercise the runner branch at suite-run time |
| `tools/reduce-fixture.ts` | create | CLI: SpecNode/fast-check JSON → `.spec.json` |
| `tools/reduce-fixture.test.ts` | create | Tool unit tests |
| `README.md` | modify | Short docs section on the reduction workflow |

---

## Task 1: Extend `FixtureTag` with `'divergent'`

**Files:**
- Modify: `packages/core/test/fixture-loader.ts`

- [ ] **Step 1: Add `'divergent'` to the `FixtureTag` union and `TAG_VALUES`.**

Find in `packages/core/test/fixture-loader.ts`:

```ts
export type FixtureTag =
  | 'flex-direction'
  | 'justify-content'
  | 'align-items'
  | 'align-self'
  | 'flex-wrap'
  | 'absolute-position'
  | 'aspect-ratio'
  | 'gap'
  | 'overflow'
  | 'position-edges';

const TAG_VALUES: readonly FixtureTag[] = [
  'flex-direction',
  'justify-content',
  'align-items',
  'align-self',
  'flex-wrap',
  'absolute-position',
  'aspect-ratio',
  'gap',
  'overflow',
  'position-edges',
];
```

Append `| 'divergent'` to the union AND append `'divergent'` to the array. Both must list it.

- [ ] **Step 2: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Run the existing suite to confirm no regression.**

Run: `pnpm test packages/core/test/fixture-loader.test.ts packages/core/test/fixtures.test.ts`
Expected: 77 tests pass (9 in loader test + 68 fixtures).

- [ ] **Step 4: Commit.**

```bash
git add packages/core/test/fixture-loader.ts
git commit -m "test(core): reserve 'divergent' fixture tag"
```

---

## Task 2: Discriminated `Fixture` union + `isDivergent` helper

**Files:**
- Modify: `packages/core/test/fixture-loader.ts`

- [ ] **Step 1: Replace the existing `Fixture` interface with the discriminated union.**

Find the existing `Fixture` interface (it has fields `name`, `tags`, `available?`, `root`, `expected`, `sourcePath`):

```ts
export interface Fixture {
  name: string;
  tags: FixtureTag[];
  available?: { width?: number; height?: number };
  root: SpecNode;
  expected: Record<string, Box>;
  sourcePath: string;
}
```

Replace with:

```ts
interface FixtureBase {
  /** "<tag>/<short-slug>"; used as the test display name. */
  name: string;
  tags: FixtureTag[];
  available?: { width?: number; height?: number };
  root: SpecNode;
  /** Absolute path on disk — included for failure messages. */
  sourcePath: string;
}

export interface ConsensusFixture extends FixtureBase {
  expected: Record<string, Box>;
}

export interface DivergentFixture extends FixtureBase {
  divergenceReason: string;
  expectedPilates: Record<string, Box>;
  expectedYoga: Record<string, Box>;
}

export type Fixture = ConsensusFixture | DivergentFixture;

/** True iff the fixture encodes a known Pilates ↔ Yoga divergence. */
export function isDivergent(f: Fixture): f is DivergentFixture {
  return 'divergenceReason' in f;
}
```

- [ ] **Step 2: Update `loadFixtures` to handle both shapes.**

Find the existing `loadFixtures` body (around line 151–203 of `fixture-loader.ts`). Replace its body with:

```ts
export function loadFixtures(dir: string = DEFAULT_FIXTURES_DIR): Fixture[] {
  const out: Fixture[] = [];
  for (const file of listSpecFiles(dir)) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${file}: top-level value must be a JSON object`);
    }
    const raw = parsed as Record<string, unknown>;

    if (typeof raw.name !== 'string') throw new Error(`${file}: missing "name"`);
    if (typeof raw.root !== 'object' || raw.root === null || Array.isArray(raw.root)) {
      throw new Error(`${file}: "root" must be an object`);
    }
    const tags = validateTags(raw.tags, file);

    const hasConsensus = raw.expected !== undefined;
    const hasDivergent =
      raw.expectedPilates !== undefined ||
      raw.expectedYoga !== undefined ||
      raw.divergenceReason !== undefined;
    if (hasConsensus && hasDivergent) {
      throw new Error(
        `${file}: cannot mix "expected" with "expectedPilates"/"expectedYoga"/"divergenceReason"`,
      );
    }
    if (!hasConsensus && !hasDivergent) {
      throw new Error(`${file}: must have "expected" OR the divergent triple`);
    }

    const root = raw.root as SpecNode;
    const available = parseAvailable(raw.available, file);

    const ids = new Set<string>();
    collectIds(root, ids, file);

    const hasDivergentTag = tags.includes('divergent');

    if (hasConsensus) {
      if (hasDivergentTag) {
        throw new Error(
          `${file}: "divergent" tag requires the divergent shape (expectedPilates/expectedYoga/divergenceReason)`,
        );
      }
      validateExpectedShape(raw.expected, file, 'expected');
      const expected = raw.expected as Record<string, Box>;
      assertIdMatch(ids, expected, file, 'expected');
      out.push({
        name: raw.name,
        tags,
        ...(available !== undefined ? { available } : {}),
        root,
        expected,
        sourcePath: file,
      });
    } else {
      if (!hasDivergentTag) {
        throw new Error(
          `${file}: divergent shape requires the "divergent" tag`,
        );
      }
      if (typeof raw.divergenceReason !== 'string' || raw.divergenceReason.length === 0) {
        throw new Error(`${file}: "divergenceReason" must be a non-empty string`);
      }
      validateExpectedShape(raw.expectedPilates, file, 'expectedPilates');
      validateExpectedShape(raw.expectedYoga, file, 'expectedYoga');
      const expectedPilates = raw.expectedPilates as Record<string, Box>;
      const expectedYoga = raw.expectedYoga as Record<string, Box>;
      assertIdMatch(ids, expectedPilates, file, 'expectedPilates');
      assertIdMatch(ids, expectedYoga, file, 'expectedYoga');
      out.push({
        name: raw.name,
        tags,
        ...(available !== undefined ? { available } : {}),
        root,
        divergenceReason: raw.divergenceReason,
        expectedPilates,
        expectedYoga,
        sourcePath: file,
      });
    }
  }
  return out;
}

function parseAvailable(
  v: unknown,
  file: string,
): { width?: number; height?: number } | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`${file}: "available" must be an object if present`);
  }
  return v as { width?: number; height?: number };
}

function validateExpectedShape(v: unknown, file: string, key: string): void {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`${file}: "${key}" must be an object`);
  }
}

function assertIdMatch(
  ids: Set<string>,
  expected: Record<string, Box>,
  file: string,
  key: string,
): void {
  for (const id of ids) {
    if (!(id in expected)) {
      throw new Error(`${file}: id ${JSON.stringify(id)} in tree has no box in "${key}"`);
    }
  }
  for (const id of Object.keys(expected)) {
    if (!ids.has(id)) {
      throw new Error(`${file}: id ${JSON.stringify(id)} in "${key}" not in tree`);
    }
  }
}
```

(Two-way id validation is factored out into `assertIdMatch` so it works for both the consensus map and each per-engine map; same for the "must be an object" check.)

- [ ] **Step 3: Typecheck + run existing tests.**

Run: `pnpm typecheck && pnpm test packages/core/test/fixture-loader.test.ts packages/core/test/fixtures.test.ts`
Expected: typecheck PASS; 77 tests pass.

- [ ] **Step 4: Commit.**

```bash
git add packages/core/test/fixture-loader.ts
git commit -m "test(core): discriminated Fixture union + divergent shape validation"
```

---

## Task 3: Cover the new validation paths in the loader test

**Files:**
- Modify: `packages/core/test/fixture-loader.test.ts`

- [ ] **Step 1: Append a new describe block with 7 test cases.**

Append to `packages/core/test/fixture-loader.test.ts`:

```ts
import type { Box, SpecNode } from './fixture-loader.js';

describe('divergent fixture shape', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pilates-fixtures-div-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  function writeSpec(name: string, body: unknown): void {
    writeFileSync(join(dir, name), JSON.stringify(body));
  }
  const tinyRoot: SpecNode = { id: 'root', style: { width: 1, height: 1 } };
  const tinyBox: Box = { left: 0, top: 0, width: 1, height: 1 };

  it('loads a valid divergent fixture', () => {
    writeSpec('a.spec.json', {
      name: 'x/divergent',
      tags: ['gap', 'divergent'],
      divergenceReason: 'reason',
      root: tinyRoot,
      expectedPilates: { root: tinyBox },
      expectedYoga: { root: { ...tinyBox, left: 1 } },
    });
    const fx = loadFixtures(dir);
    expect(fx).toHaveLength(1);
    expect('divergenceReason' in fx[0]!).toBe(true);
  });

  it('rejects mixing expected with the divergent triple', () => {
    writeSpec('a.spec.json', {
      name: 'x',
      tags: ['gap', 'divergent'],
      divergenceReason: 'reason',
      root: tinyRoot,
      expected: { root: tinyBox },
      expectedPilates: { root: tinyBox },
      expectedYoga: { root: tinyBox },
    });
    expect(() => loadFixtures(dir)).toThrow(/cannot mix/);
  });

  it('rejects partial divergent shape (missing expectedYoga)', () => {
    writeSpec('a.spec.json', {
      name: 'x',
      tags: ['gap', 'divergent'],
      divergenceReason: 'r',
      root: tinyRoot,
      expectedPilates: { root: tinyBox },
    });
    expect(() => loadFixtures(dir)).toThrow(/expectedYoga/);
  });

  it('rejects empty divergenceReason', () => {
    writeSpec('a.spec.json', {
      name: 'x',
      tags: ['gap', 'divergent'],
      divergenceReason: '',
      root: tinyRoot,
      expectedPilates: { root: tinyBox },
      expectedYoga: { root: tinyBox },
    });
    expect(() => loadFixtures(dir)).toThrow(/non-empty string/);
  });

  it('rejects divergent tag without divergent shape', () => {
    writeSpec('a.spec.json', {
      name: 'x',
      tags: ['gap', 'divergent'],
      root: tinyRoot,
      expected: { root: tinyBox },
    });
    expect(() => loadFixtures(dir)).toThrow(/requires the divergent shape/);
  });

  it('rejects divergent shape without divergent tag', () => {
    writeSpec('a.spec.json', {
      name: 'x',
      tags: ['gap'],
      divergenceReason: 'r',
      root: tinyRoot,
      expectedPilates: { root: tinyBox },
      expectedYoga: { root: tinyBox },
    });
    expect(() => loadFixtures(dir)).toThrow(/requires the "divergent" tag/);
  });

  it('rejects neither expected nor divergent', () => {
    writeSpec('a.spec.json', {
      name: 'x',
      tags: ['gap'],
      root: tinyRoot,
    });
    expect(() => loadFixtures(dir)).toThrow(/must have "expected" OR/);
  });
});
```

Note: the top imports already include `mkdtempSync, rmSync, writeFileSync` and `tmpdir, join` from earlier blocks in the file. The `import type { Box, SpecNode }` is new — add it at the top of the file alongside other imports if not already present (check first; the file may already import these). If it does, drop the duplicate import.

- [ ] **Step 2: Run the test.**

Run: `pnpm test packages/core/test/fixture-loader.test.ts`
Expected: 16 passing (9 existing + 7 new).

- [ ] **Step 3: Commit.**

```bash
git add packages/core/test/fixture-loader.test.ts
git commit -m "test(core): cover divergent fixture validation paths"
```

---

## Task 4: Runner branches on `isDivergent`

**Files:**
- Modify: `packages/core/test/fixtures.test.ts`

- [ ] **Step 1: Replace the runner's body.**

Open `packages/core/test/fixtures.test.ts`. Replace the parameterized `for` body so the runner branches per-fixture shape. The full new file:

```ts
// packages/core/test/fixtures.test.ts
/**
 * Phase 3.1+3.2 declarative-fixture runner.
 *
 * Each fixture under packages/core/test/fixtures/ runs as one `it`.
 * Consensus fixtures assert BOTH Pilates and Yoga match `expected`.
 * Divergent fixtures (marked with the `divergent` tag and an
 * `expectedPilates` / `expectedYoga` pair) assert each engine against
 * its own expected box-map — a future fix that brings the engines back
 * into agreement will fail the per-engine assertion, forcing the
 * fixture to be re-classified as consensus.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPilates,
  buildYoga,
  collectBoxes,
  formatBoxDiff,
  inspectLayout,
  isDivergent,
  loadFixtures,
  pilatesBox,
  yogaBox,
} from './fixture-loader.js';

const FIXTURES = loadFixtures();

describe('declarative fixtures', () => {
  if (FIXTURES.length === 0) {
    it.skip('no fixtures discovered', () => {
      /* intentionally empty */
    });
    return;
  }

  for (const fixture of FIXTURES) {
    const divergentSuffix = isDivergent(fixture) ? ' [divergent]' : '';
    const display = `[${fixture.tags.join(',')}] ${fixture.name}${divergentSuffix}`;
    it(display, () => {
      const p = buildPilates(fixture.root);
      p.root.calculateLayout(fixture.available?.width, fixture.available?.height);
      const pBoxes = collectBoxes(p.byId, pilatesBox);

      const y = buildYoga(fixture.root);
      y.root.calculateLayout(fixture.available?.width, fixture.available?.height);
      const yBoxes = collectBoxes(y.byId, yogaBox);

      try {
        if (isDivergent(fixture)) {
          expect(pBoxes).toEqual(fixture.expectedPilates);
          expect(yBoxes).toEqual(fixture.expectedYoga);
        } else {
          expect(pBoxes).toEqual(fixture.expected);
          expect(yBoxes).toEqual(fixture.expected);
        }
      } catch (err) {
        const expectedP = isDivergent(fixture) ? fixture.expectedPilates : fixture.expected;
        const expectedY = isDivergent(fixture) ? fixture.expectedYoga : fixture.expected;
        const message =
          `\n${formatBoxDiff('Pilates vs expected', expectedP, pBoxes)}\n` +
          `${formatBoxDiff('Yoga vs expected', expectedY, yBoxes)}\n` +
          `── Pilates inspectLayout ──\n${inspectLayout(p.root)}\n` +
          `── source: ${fixture.sourcePath} ──`;
        (err as Error).message = `${(err as Error).message}\n${message}`;
        throw err;
      } finally {
        y.root.freeRecursive();
      }
    });
  }
});
```

- [ ] **Step 2: Typecheck + run the full suite.**

Run: `pnpm typecheck && pnpm test packages/core/test/fixtures.test.ts`
Expected: typecheck PASS; 68 fixtures still pass (no divergent fixtures committed yet).

- [ ] **Step 3: Commit.**

```bash
git add packages/core/test/fixtures.test.ts
git commit -m "test(core): runner branches on isDivergent"
```

---

## Task 5: Add one synthetic divergent fixture (probe-first)

**Files:**
- Create: `packages/core/test/fixtures/overflow/divergent-per-axis.spec.json`

The spec calls for a real divergence if probing finds one. The candidate already identified during Phase 3.1 design: `overflowX` / `overflowY` asymmetry. Pilates honors `setOverflowX` / `setOverflowY` independently; Yoga 3.x has only a single `setOverflow` and the loader's `buildYoga` intentionally drops the X/Y axis-specific calls (see `fixture-loader.ts` builder comment).

For pure flex-flow geometry this does NOT cause divergence (overflow doesn't affect `getComputedLayout` boxes — confirmed by the `overflow/` bucket's existing 4 consensus fixtures). So `overflowX/Y` alone won't trigger a divergence.

- [ ] **Step 1: Probe Pilates for a real intentional divergence.**

Look for Pilates-specific behavior that diverges from Yoga AND surfaces in `getComputedLayout`. Read these grep hits and the inline comments — the candidates are tagged `Pilates-specific` or `differs from Yoga`:

```bash
grep -rn "Pilates-specific\|differs from Yoga\|Yoga.*ignores\|Pilates.*ignores\|terminal-specific" packages/core/src/ 2>&1 | head -30
```

If you find a real divergence point that surfaces in box geometry, author a real fixture exercising it. Document the divergence reason in `divergenceReason` precisely (cite the code line where the choice was made).

- [ ] **Step 2: If no real geometric divergence is found, fall back to the synthetic option.**

The synthetic option: a margin asymmetry that Pilates rounds one way and Yoga the other (BOTH engines support all the props; the divergence is real, just synthetic in that the test was constructed to land on the edge). For example:

```json
{
  "name": "overflow/synthetic-per-axis-divergence",
  "tags": ["overflow", "divergent"],
  "divergenceReason": "Synthetic divergence to exercise the divergent-fixture runner branch. Pilates' buildYoga intentionally does not map overflowX/overflowY (Yoga has only the shorthand setOverflow); for layout geometry the engines agree, so this fixture relies on a forced 1-pixel difference via independent expected maps. Replace with a real divergence point if one is later identified.",
  "root": {
    "id": "root",
    "style": { "flexDirection": "row", "width": 20, "height": 5, "overflowX": "hidden", "overflowY": "visible" },
    "children": [{ "id": "kid", "style": { "width": 40, "height": 10 } }]
  },
  "expectedPilates": {
    "root": { "left": 0, "top": 0, "width": 20, "height": 5 },
    "kid":  { "left": 0, "top": 0, "width": 40, "height": 10 }
  },
  "expectedYoga": {
    "root": { "left": 0, "top": 0, "width": 20, "height": 5 },
    "kid":  { "left": 0, "top": 0, "width": 40, "height": 10 }
  }
}
```

**Wait** — both expected maps are identical here. That fails the spirit
of the divergence test: the test would still pass if `isDivergent` were
unwired. Re-read step 1: a SYNTHETIC divergence must produce values
that actually differ.

If the probe found nothing and the synthetic-overflow case doesn't
diverge, fall back to: **a `min-width` clamp on a flex child where the
classic-vs-spineless rounding lands on opposing cells.** This is
unstable across engine versions and not maintainable.

**Better fallback (use this if step 1 finds nothing):** **skip
committing a divergent fixture at all**, leaving the runner-branch
exercise to the unit tests in Task 3. Update the DoD: the runner branch
is covered by the in-process loader/runner tests; a committed reference
fixture awaits a real divergence point. Document this in the PR
description.

- [ ] **Step 3: Run the suite.**

If a fixture was committed:
```
pnpm test packages/core/test/fixtures.test.ts
```
Expected: 69 passing.

If no fixture was committed: skip this step.

- [ ] **Step 4: Commit (only if a real-or-genuine-synthetic fixture exists).**

```bash
git add packages/core/test/fixtures/<bucket>/divergent-<name>.spec.json
git commit -m "test(core): add reference divergent fixture (<reason>)"
```

If no fixture committed, add a `MAYBE_DIVERGENT.md` (or just a one-line PR-description note) explaining the deferral. Either way, the task is DONE after step 1 either commits a fixture or determines none is appropriate.

---

## Task 6: Reduction tool — scaffold + I/O

**Files:**
- Create: `tools/reduce-fixture.ts`

This task creates the CLI shell. Tasks 7 and 8 add the build + serialize.

- [ ] **Step 1: Create the file with the CLI skeleton.**

```ts
// tools/reduce-fixture.ts
/**
 * Reduce a SpecNode JSON (or a fast-check counterexample's first arg)
 * to a commit-ready `.spec.json` fixture, pre-filled with both engines'
 * actual `getComputedLayout` output.
 *
 * Usage:
 *   pnpm tsx tools/reduce-fixture.ts <input.json> [options]
 *
 * Options:
 *   --available WxH    Pass `availableWidth` × `availableHeight` to calculateLayout.
 *   --out <path>       Write to file (default: stdout).
 *   --name <name>      Set the fixture's `name` field (default: tmp/<unnamed>).
 *   --fast-check       Read input as a fast-check counterexample array;
 *                      the first element is the SpecNode tree.
 *
 * Behavior:
 *   - Auto-assigns ids `n0` (root), `n1`, ... in DFS pre-order IF the
 *     input has no ids on any node; otherwise validates that every node
 *     has a unique id.
 *   - Runs both Pilates and Yoga, compares actuals.
 *   - Agree: emits a consensus fixture with `expected` = agreed boxes.
 *   - Disagree: emits a divergent fixture with `expectedPilates`,
 *     `expectedYoga`, and `divergenceReason: "<TODO: fill in>"`, and
 *     prints a warning to stderr.
 *   - Round-trips its own output through `loadFixtures` as a self-test
 *     before writing.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  buildPilates,
  buildYoga,
  collectBoxes,
  loadFixtures,
  pilatesBox,
  yogaBox,
  type Box,
  type SpecNode,
} from '../packages/core/test/fixture-loader.js';

interface CliOpts {
  inputPath: string;
  available?: { width?: number; height?: number };
  outPath?: string;
  name: string;
  fastCheck: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  if (argv.length < 1) {
    throw new Error('usage: reduce-fixture.ts <input.json> [--available WxH] [--out <path>] [--name <name>] [--fast-check]');
  }
  const out: CliOpts = {
    inputPath: '',
    name: 'tmp/<unnamed>',
    fastCheck: false,
  };
  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--available') {
      const v = argv[++i];
      if (v === undefined) throw new Error('--available requires WxH');
      const m = /^(\d+)x(\d+)$/.exec(v);
      if (!m) throw new Error(`--available expected WxH, got ${v}`);
      out.available = { width: Number(m[1]), height: Number(m[2]) };
    } else if (arg === '--out') {
      out.outPath = argv[++i];
      if (out.outPath === undefined) throw new Error('--out requires a path');
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

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(readFileSync(opts.inputPath, 'utf8'));
  const tree = opts.fastCheck ? raw[0] : raw;
  // Build + compare in Task 7; emit + self-test in Task 8.
  console.error('reduce-fixture: parsed', opts.inputPath, '— build+emit not yet implemented');
  void tree;
  void buildPilates;
  void buildYoga;
  void collectBoxes;
  void pilatesBox;
  void yogaBox;
  void loadFixtures;
  void mkdtempSync;
  void rmSync;
  void mkdirSync;
  void tmpdir;
  void basename;
  void join;
  void writeFileSync;
  type _Box = Box;
  type _SpecNode = SpecNode;
}

main();
```

The `void` and dead `type` references silence unused-import errors while the implementation is split across tasks. Task 7 removes them.

- [ ] **Step 2: Verify the CLI is invokable.**

Run:
```bash
echo '{"id":"root","style":{"width":10,"height":5}}' > /tmp/probe.json
pnpm tsx tools/reduce-fixture.ts /tmp/probe.json 2>&1
```
Expected: stderr message `reduce-fixture: parsed /tmp/probe.json — build+emit not yet implemented`. Exit code 0.

Run with bad args:
```bash
pnpm tsx tools/reduce-fixture.ts 2>&1 || true
```
Expected: usage error.

- [ ] **Step 3: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS. The script lives at the repo root; verify that root-level `tsconfig.json` or `tools/` configuration covers it. If `pnpm typecheck` doesn't pick up `tools/`, no error is thrown — but tsx will catch syntax errors at run time, which step 2 already did.

- [ ] **Step 4: Commit.**

```bash
git add tools/reduce-fixture.ts
git commit -m "feat(tools): scaffold reduce-fixture CLI"
```

---

## Task 7: Reduction tool — id assignment + build + compare

**Files:**
- Modify: `tools/reduce-fixture.ts`

- [ ] **Step 1: Add helpers and replace `main`.**

Open `tools/reduce-fixture.ts`. Remove the `void` placeholders and the `type _Box / _SpecNode` lines from Task 6. Replace `main` and add helpers below `parseArgs`:

```ts
/**
 * True iff EVERY node in the tree has an `id` string. Used to decide
 * whether to auto-assign ids: if any id is missing, auto-assign all.
 */
function allNodesHaveIds(node: unknown): boolean {
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

/** Auto-assign `n0`, `n1`, ... in DFS pre-order. Mutates a copy. */
function assignIds(node: unknown): SpecNode {
  let counter = 0;
  function go(n: unknown): SpecNode {
    if (typeof n !== 'object' || n === null) {
      throw new Error('input tree contains a non-object node');
    }
    const src = n as { style?: unknown; children?: unknown };
    const id = `n${counter++}`;
    const out: SpecNode = { id, ...(src.style !== undefined ? { style: src.style as never } : {}) };
    if (Array.isArray(src.children) && src.children.length > 0) {
      out.children = src.children.map(go);
    }
    return out;
  }
  return go(node);
}

function shallowEqualBox(a: Box, b: Box): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

function mapsEqual(a: Record<string, Box>, b: Record<string, Box>): boolean {
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

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(readFileSync(opts.inputPath, 'utf8'));
  const rawTree = opts.fastCheck ? raw[0] : raw;

  const tree: SpecNode = allNodesHaveIds(rawTree) ? (rawTree as SpecNode) : assignIds(rawTree);

  const p = buildPilates(tree);
  p.root.calculateLayout(opts.available?.width, opts.available?.height);
  const pActual = collectBoxes(p.byId, pilatesBox);

  const y = buildYoga(tree);
  y.root.calculateLayout(opts.available?.width, opts.available?.height);
  const yActual = collectBoxes(y.byId, yogaBox);
  y.root.freeRecursive();

  const agree = mapsEqual(pActual, yActual);

  // Emit step lives in Task 8; for now, dump a diagnostic to stderr.
  console.error(`reduce-fixture: agree=${agree} ids=${Object.keys(pActual).length}`);
  void writeFileSync;
  void mkdtempSync;
  void rmSync;
  void mkdirSync;
  void tmpdir;
  void basename;
  void join;
  void loadFixtures;
  void opts.name;
  void opts.outPath;
}
```

The `void` placeholders for `writeFileSync` etc. continue to silence
unused-import warnings; Task 8 removes them as it adds the emit step.

- [ ] **Step 2: Run on a known-agree input to verify.**

```bash
echo '{"id":"root","style":{"flexDirection":"row","width":40,"height":5},"children":[{"id":"a","style":{"width":10}},{"id":"b","style":{"width":10}}]}' > /tmp/agree.json
pnpm tsx tools/reduce-fixture.ts /tmp/agree.json 2>&1
```
Expected: stderr `reduce-fixture: agree=true ids=3`.

- [ ] **Step 3: Run on an input with no ids to verify auto-assignment.**

```bash
echo '{"style":{"flexDirection":"row","width":40,"height":5},"children":[{"style":{"width":10}},{"style":{"width":10}}]}' > /tmp/no-ids.json
pnpm tsx tools/reduce-fixture.ts /tmp/no-ids.json 2>&1
```
Expected: stderr `reduce-fixture: agree=true ids=3`. (No crash from missing ids.)

- [ ] **Step 4: Commit.**

```bash
git add tools/reduce-fixture.ts
git commit -m "feat(tools): reduce-fixture builds both engines and compares"
```

---

## Task 8: Reduction tool — emit fixture + round-trip self-test

**Files:**
- Modify: `tools/reduce-fixture.ts`

- [ ] **Step 1: Replace `main` with the emit-path version.**

In `tools/reduce-fixture.ts`, replace the `main` function (and remove the `void` placeholders introduced in Task 7) with:

```ts
function emitConsensus(name: string, available: CliOpts['available'], tree: SpecNode, boxes: Record<string, Box>): unknown {
  return {
    name,
    tags: [],
    ...(available !== undefined ? { available } : {}),
    root: tree,
    expected: boxes,
  };
}

function emitDivergent(
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
  const rawTree = opts.fastCheck ? raw[0] : raw;

  const tree: SpecNode = allNodesHaveIds(rawTree) ? (rawTree as SpecNode) : assignIds(rawTree);

  const p = buildPilates(tree);
  p.root.calculateLayout(opts.available?.width, opts.available?.height);
  const pActual = collectBoxes(p.byId, pilatesBox);

  const y = buildYoga(tree);
  y.root.calculateLayout(opts.available?.width, opts.available?.height);
  const yActual = collectBoxes(y.byId, yogaBox);
  y.root.freeRecursive();

  const fixture = mapsEqual(pActual, yActual)
    ? emitConsensus(opts.name, opts.available, tree, pActual)
    : emitDivergent(opts.name, opts.available, tree, pActual, yActual);

  roundTrip(fixture, opts.inputPath);

  const serialized = `${JSON.stringify(fixture, null, 2)}\n`;
  if (opts.outPath !== undefined) {
    if (opts.outPath.includes('/')) mkdirSync(join(opts.outPath, '..'), { recursive: true });
    writeFileSync(opts.outPath, serialized);
    process.stderr.write(`reduce-fixture: wrote ${opts.outPath}\n`);
  } else {
    process.stdout.write(serialized);
  }

  if (!mapsEqual(pActual, yActual)) {
    process.stderr.write(
      '⚠ Pilates and Yoga produced different layouts. The emitted fixture uses the divergent shape; fill in "divergenceReason" and review tags before committing.\n',
    );
  }
}
```

Remove the unused `basename` import if it's no longer referenced. The `void` placeholders should ALL be gone now.

- [ ] **Step 2: Run on the agree input — should print a consensus fixture.**

```bash
pnpm tsx tools/reduce-fixture.ts /tmp/agree.json
```
Expected: a JSON document on stdout with `tags: []`, `expected: { ... }`. Stderr: nothing (or just a non-warning line).

- [ ] **Step 3: Run on the no-ids input with `--out` flag.**

```bash
pnpm tsx tools/reduce-fixture.ts /tmp/no-ids.json --out /tmp/out.spec.json --name "test/auto-ids"
cat /tmp/out.spec.json
```
Expected: file written; contents include `"name": "test/auto-ids"`, `"id": "n0"`, `"id": "n1"`, `"id": "n2"`, plus a valid `expected` map for those ids.

- [ ] **Step 4: Verify the round-trip catches a malformed emission.**

There's no easy way to provoke a bad emit from valid input, so this is a code-inspection check: confirm `roundTrip` is called BEFORE writing to `--out` or stdout. If the loader rejects the emitted JSON, the tool exits with an error and writes nothing — that's the contract.

- [ ] **Step 5: Commit.**

```bash
git add tools/reduce-fixture.ts
git commit -m "feat(tools): reduce-fixture emits fixture + round-trips through loader"
```

---

## Task 9: Reduction tool — unit tests

**Files:**
- Create: `tools/reduce-fixture.test.ts`

The CLI is a script; instead of invoking it as a subprocess, the test imports its helpers. Refactor first if needed: in Task 8 the helpers are inside the module but the entry point calls `main()` at module top level — that breaks importable tests. Adjust the module to guard the call.

- [ ] **Step 1: Guard `main()` so the module is importable.**

At the BOTTOM of `tools/reduce-fixture.ts`, change:

```ts
main();
```

to:

```ts
// Only run as a CLI when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  main();
}
export { allNodesHaveIds, assignIds, emitConsensus, emitDivergent, mapsEqual };
```

(The URL-vs-path comparison handles both forward and backslash on Windows.)

Mark `parseArgs`, `emitConsensus`, `emitDivergent`, `roundTrip`, `main` as not-exported privates by leaving them un-`export`-prefixed. Only export the pure helpers under test.

Typecheck: `pnpm typecheck`. Expected: PASS.

- [ ] **Step 2: Write the test.**

Create `tools/reduce-fixture.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { allNodesHaveIds, assignIds, emitConsensus, emitDivergent, mapsEqual } from './reduce-fixture.js';

describe('reduce-fixture helpers', () => {
  describe('allNodesHaveIds', () => {
    it('true when every node has a string id', () => {
      expect(
        allNodesHaveIds({ id: 'a', children: [{ id: 'b' }, { id: 'c', children: [{ id: 'd' }] }] }),
      ).toBe(true);
    });
    it('false when a leaf lacks an id', () => {
      expect(allNodesHaveIds({ id: 'a', children: [{}] })).toBe(false);
    });
    it('false when root lacks an id', () => {
      expect(allNodesHaveIds({ children: [{ id: 'a' }] })).toBe(false);
    });
  });

  describe('assignIds', () => {
    it('assigns n0/n1/n2/... in DFS pre-order', () => {
      const out = assignIds({
        children: [{}, { children: [{}, {}] }, {}],
      });
      // Expected pre-order: root, c0, c1, c1.c0, c1.c1, c2 → n0..n5
      const collect: string[] = [];
      function walk(n: { id: string; children?: { id: string; children?: unknown }[] }): void {
        collect.push(n.id);
        for (const c of n.children ?? []) walk(c as { id: string; children?: never });
      }
      walk(out);
      expect(collect).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
    });
    it('preserves the style field', () => {
      const out = assignIds({ style: { width: 10 } });
      expect(out.style).toEqual({ width: 10 });
    });
  });

  describe('mapsEqual', () => {
    const a = { x: { left: 0, top: 0, width: 1, height: 1 } };
    const b = { x: { left: 0, top: 0, width: 1, height: 1 } };
    const c = { x: { left: 1, top: 0, width: 1, height: 1 } };
    it('true for deep-equal maps', () => expect(mapsEqual(a, b)).toBe(true));
    it('false for box mismatch', () => expect(mapsEqual(a, c)).toBe(false));
    it('false for key-set mismatch', () =>
      expect(mapsEqual(a, { ...a, y: { left: 0, top: 0, width: 1, height: 1 } })).toBe(false));
  });

  describe('emit shapes', () => {
    const tree = { id: 'r', style: { width: 1, height: 1 } };
    const box = { r: { left: 0, top: 0, width: 1, height: 1 } };
    it('consensus has `expected`, no divergent fields', () => {
      const out = emitConsensus('x', undefined, tree, box) as Record<string, unknown>;
      expect(out.expected).toEqual(box);
      expect(out.expectedPilates).toBeUndefined();
      expect(out.expectedYoga).toBeUndefined();
      expect(out.divergenceReason).toBeUndefined();
      expect(out.tags).toEqual([]);
    });
    it('divergent has the triple + divergent tag', () => {
      const out = emitDivergent('x', undefined, tree, box, box) as Record<string, unknown>;
      expect(out.expected).toBeUndefined();
      expect(out.expectedPilates).toEqual(box);
      expect(out.expectedYoga).toEqual(box);
      expect(out.divergenceReason).toBe('<TODO: fill in>');
      expect(out.tags).toEqual(['divergent']);
    });
  });
});
```

- [ ] **Step 3: Run the test.**

Run: `pnpm test tools/reduce-fixture.test.ts`
Expected: 9 tests pass.

- [ ] **Step 4: Confirm `tools/` is in the vitest include path.**

If step 3 fails with "no test files matched", check root `package.json` / `vitest.config.ts`. The repo's `pnpm test` runs `vitest run` from root, which uses the default include `**/*.{test,spec}.?(c|m)[jt]s?(x)`. That should match `tools/reduce-fixture.test.ts`. If it doesn't, extend the include — but try first.

- [ ] **Step 5: Commit.**

```bash
git add tools/reduce-fixture.ts tools/reduce-fixture.test.ts
git commit -m "test(tools): unit tests for reduce-fixture helpers"
```

---

## Task 10: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Inspect current README structure.**

Run: `head -60 README.md`. Find a logical insertion point — likely at the end of a "Testing" or "Development" section, or as a new top-level "Tools" section.

- [ ] **Step 2: Insert the docs.**

Append to `README.md` (use the most appropriate top-level section based on the file's existing structure):

```markdown
### Reducing fuzzer counterexamples to fixtures

When a fast-check fuzz test fails it emits a JSON counterexample —
typically 100+ lines of nested style objects. Convert it to a
hand-readable `.spec.json` fixture with:

```bash
pnpm tsx tools/reduce-fixture.ts counterexample.json --fast-check \
  --out packages/core/test/fixtures/<bucket>/<name>.spec.json \
  --name "<bucket>/<name>"
```

If Pilates and Yoga agree on the layout, the emitted fixture is a
consensus shape (`expected` map). If they diverge, the emitted fixture
is a divergent shape (`expectedPilates` + `expectedYoga` +
`divergenceReason: "<TODO: fill in>"`); fill in the reason and add the
`divergent` tag before committing.
````

- [ ] **Step 3: Commit.**

```bash
git add README.md
git commit -m "docs: README section on the reduce-fixture workflow"
```

---

## Task 11: Whole-repo verification

- [ ] **Step 1: Lint.**

Run: `pnpm lint`
Expected: PASS. If any JSON / TS formatting drifted, `pnpm format`, then commit under `style: ...`.

- [ ] **Step 2: Full test pass.**

Run: `pnpm test`
Expected: PASS. New counts:
- +7 loader validation tests (Task 3)
- +9 reduce-fixture helper tests (Task 9)
- +0 or +1 fixtures depending on Task 5 outcome.

- [ ] **Step 3: Differential.**

Run: `pnpm test:differential`
Expected: PASS.

- [ ] **Step 4: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Full ci.**

Run: `pnpm run ci` (NOT `pnpm ci` — see memory).
Expected: PASS.

---

## Task 12: Push + open PR

- [ ] **Step 1: Push.**

```bash
git push -u origin feat/divergence-allowlist-and-reduction
```

- [ ] **Step 2: Open PR.**

```bash
gh pr create --base main --title "feat(test): divergence allowlist + reduce-fixture CLI" --body "$(cat <<'EOF'
## Summary

Phase 3.2 of the testing roadmap:

- **Divergence allowlist** — `.spec.json` schema now allows EITHER a consensus `expected` map (existing) OR a divergent triple (`expectedPilates`, `expectedYoga`, `divergenceReason`). The new `divergent` reserved tag marks divergent fixtures.
- **Reduction CLI** — `tools/reduce-fixture.ts` reads a SpecNode JSON (or a fast-check counterexample) and emits a commit-ready `.spec.json`, pre-filled with both engines' actual `getComputedLayout` output. Self-tests the emission via a round-trip through the loader.

## Changes

- `packages/core/test/fixture-loader.ts` — discriminated `Fixture` union (`ConsensusFixture | DivergentFixture`), `isDivergent` helper, validation for the new shape, `'divergent'` tag.
- `packages/core/test/fixture-loader.test.ts` — 7 new validation tests.
- `packages/core/test/fixtures.test.ts` — runner branches on `isDivergent`.
- `tools/reduce-fixture.ts` + `tools/reduce-fixture.test.ts` — new CLI + 9 helper tests.
- `README.md` — workflow section.
- Reference divergent fixture: <one of "committed at packages/core/test/fixtures/<path>" if Task 5 found a real or genuine-synthetic divergence; "deferred — no real divergence point found, runner branch covered by unit tests" if not>.

## Test plan

- [x] `pnpm test`
- [x] `pnpm test:differential`
- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm run ci`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return the PR URL.**

---

## Self-review notes

**Spec coverage:**
- Schema OR + validation → Tasks 1, 2, 3
- Loader discriminated union → Task 2
- `isDivergent` helper → Task 2
- Runner branch → Task 4
- Reference divergent fixture → Task 5 (with deferral fallback documented)
- Reduction CLI scaffold + I/O → Task 6
- CLI build + compare → Task 7
- CLI emit + round-trip → Task 8
- CLI tests → Task 9
- README docs → Task 10
- DoD all-green → Task 11

**Memory pointers used:**
- `feedback_pilates_typecheck_command` — `pnpm typecheck`.
- `feedback_pilates_branch_pr_workflow` — branch + PR.
- `feedback_pnpm_script_name_collisions` — `pnpm run ci`.

**Risks called out:**
- Task 5's reference fixture may end up deferred if no real divergence exists; that's acceptable per the spec.
- Task 9 step 1 requires turning the script into an importable module; the `import.meta.url` guard handles Windows path normalization.
