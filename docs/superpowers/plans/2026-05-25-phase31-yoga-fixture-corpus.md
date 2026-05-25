# Phase 3.1 — Yoga Fixture Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a ≥60-fixture declarative `.spec.json` corpus that asserts `@pilates/core` and `yoga-layout` both match hand-authored expected boxes, on branch `tests/fixture-corpus`.

**Architecture:** One JSON file per fixture under `packages/core/test/fixtures/<tag>/`. A loader builds equivalent Pilates and Yoga trees from each spec, indexed by `id`. A single parameterized `vitest` test asserts both engines agree with the hand-authored expected boxes; failures pretty-print a tree diff via `inspectLayout`. Two divergence modes — engine-vs-spec (catches authoring error or a regression in one engine) and engine-vs-engine (defer the fixture, file an issue).

**Tech Stack:** TypeScript, vitest, `yoga-layout` 3.x WASM, Node ≥22.13, pnpm@10.32.

**Spec:** `docs/superpowers/specs/2026-05-25-phase31-yoga-fixture-corpus-design.md`

**Branch:** `tests/fixture-corpus` (already created from commit `2630f56`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/core/test/fixture-loader.ts` | Schema types, file discovery, tree builders for both engines, box collection, tree-diff formatter |
| `packages/core/test/fixtures.test.ts` | Parameterized vitest runner |
| `packages/core/test/fixtures/<tag>/*.spec.json` | The fixture data, 64+ files |

The loader is one file — schema, discovery, and both build functions belong together; splitting them would force duplicate type imports and make the dual-engine factoring less obvious to a reader. Existing `yoga-oracle.test.ts` stays untouched (its hand-curated TS fixtures and their inline regression comments remain in-place; the loader **copies** the dispatch tables rather than importing, per the spec's "duplication is intentional" call).

---

## Task 1: Loader scaffold — types + file discovery

**Files:**
- Create: `packages/core/test/fixture-loader.ts`
- Create: `packages/core/test/fixtures/.gitkeep` (empty file so the directory commits)

**Why first:** Gives later tasks a typed surface to test against, and confirms the build-tree shape before any fixtures exist.

- [ ] **Step 1: Create the loader file with schema types and discovery only.**

```ts
// packages/core/test/fixture-loader.ts
/**
 * Declarative-fixture loader for Phase 3.1. See
 * docs/superpowers/specs/2026-05-25-phase31-yoga-fixture-corpus-design.md.
 *
 * Schema types are JSON-shaped; tree builders for Pilates and yoga-layout
 * are added in later tasks and share the dispatch table style of
 * yoga-oracle.test.ts (which we intentionally duplicate rather than
 * import — that test file's helpers stay inline next to its TS fixtures).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Align,
  FlexDirection,
  FlexWrap,
  Justify,
  Overflow,
  PositionType,
} from '../src/style.js';

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

export interface SpecStyle {
  flexDirection?: FlexDirection;
  flexWrap?: FlexWrap;
  width?: number;
  height?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number;
  flex?: number;
  paddingAll?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  marginAll?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  gapRow?: number;
  gapColumn?: number;
  justifyContent?: Justify;
  alignItems?: Align;
  alignSelf?: Align;
  alignContent?: Align;
  positionType?: PositionType;
  positionTop?: number;
  positionRight?: number;
  positionBottom?: number;
  positionLeft?: number;
  aspectRatio?: number;
  overflow?: Overflow;
  overflowX?: Overflow;
  overflowY?: Overflow;
}

export interface SpecNode {
  id: string;
  style?: SpecStyle;
  children?: SpecNode[];
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Fixture {
  /** "<tag>/<short-slug>"; used as the test display name. */
  name: string;
  tags: FixtureTag[];
  available?: { width?: number; height?: number };
  root: SpecNode;
  expected: Record<string, Box>;
  /** Absolute path on disk — included for failure messages. */
  sourcePath: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES_DIR = join(__dirname, 'fixtures');

/** Recursively collect all `*.spec.json` files under `dir`, sorted for determinism. */
function listSpecFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSpecFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.spec.json')) out.push(full);
  }
  return out.sort();
}

function validateTags(tags: unknown, sourcePath: string): FixtureTag[] {
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error(`${sourcePath}: "tags" must be a non-empty array`);
  }
  for (const t of tags) {
    if (typeof t !== 'string' || !(TAG_VALUES as readonly string[]).includes(t)) {
      throw new Error(
        `${sourcePath}: unknown tag ${JSON.stringify(t)}; allowed: ${TAG_VALUES.join(', ')}`,
      );
    }
  }
  return tags as FixtureTag[];
}

function collectIds(node: SpecNode, into: Set<string>, sourcePath: string): void {
  if (typeof node.id !== 'string' || node.id.length === 0) {
    throw new Error(`${sourcePath}: every node needs a non-empty string "id"`);
  }
  if (into.has(node.id)) {
    throw new Error(`${sourcePath}: duplicate id ${JSON.stringify(node.id)}`);
  }
  into.add(node.id);
  for (const child of node.children ?? []) collectIds(child, into, sourcePath);
}

export function loadFixtures(dir: string = DEFAULT_FIXTURES_DIR): Fixture[] {
  const out: Fixture[] = [];
  for (const file of listSpecFiles(dir)) {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Fixture>;
    if (typeof raw.name !== 'string') throw new Error(`${file}: missing "name"`);
    if (!raw.root) throw new Error(`${file}: missing "root"`);
    if (!raw.expected) throw new Error(`${file}: missing "expected"`);
    const tags = validateTags(raw.tags, file);

    const ids = new Set<string>();
    collectIds(raw.root, ids, file);
    for (const id of ids) {
      if (!(id in raw.expected)) {
        throw new Error(`${file}: id ${JSON.stringify(id)} in tree has no expected box`);
      }
    }
    for (const id of Object.keys(raw.expected)) {
      if (!ids.has(id)) {
        throw new Error(`${file}: expected id ${JSON.stringify(id)} not in tree`);
      }
    }

    out.push({
      name: raw.name,
      tags,
      available: raw.available,
      root: raw.root,
      expected: raw.expected,
      sourcePath: file,
    });
  }
  return out;
}
```

- [ ] **Step 2: Add the `.gitkeep` so the empty fixtures dir tracks.**

```bash
mkdir -p packages/core/test/fixtures
touch packages/core/test/fixtures/.gitkeep
```

- [ ] **Step 3: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS (no errors). Per memory `feedback_pilates_typecheck_command`, use this command, not `tsc -b`.

- [ ] **Step 4: Commit.**

```bash
git add packages/core/test/fixture-loader.ts packages/core/test/fixtures/.gitkeep
git commit -m "test(core): scaffold yoga-fixture loader (schema + discovery)"
```

---

## Task 2: TDD the validation paths

**Files:**
- Modify: `packages/core/test/fixture-loader.ts` (no changes expected; just verify)
- Create: `packages/core/test/fixture-loader.test.ts`

**Why:** The loader's value is its validation. Test the validation before any fixture exists, against a temp directory.

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/core/test/fixture-loader.test.ts
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
```

- [ ] **Step 2: Run the test — expect PASS (the loader already implements these checks).**

Run: `pnpm test packages/core/test/fixture-loader.test.ts`
Expected: 7 passing.

If a test fails, fix the loader — these are the validation contract.

- [ ] **Step 3: Commit.**

```bash
git add packages/core/test/fixture-loader.test.ts
git commit -m "test(core): cover fixture-loader validation paths"
```

---

## Task 3: Add `buildPilates` and `buildYoga` builders

**Files:**
- Modify: `packages/core/test/fixture-loader.ts`

The dispatch tables are mechanically copied from `packages/core/test/yoga-oracle.test.ts` lines 68–181 and extended to cover the new style fields (`aspectRatio`, `overflow*`, per-edge margin).

- [ ] **Step 1: Append the builders to the loader file.**

Add to the bottom of `packages/core/test/fixture-loader.ts`:

```ts
// ─── tree builders ─────────────────────────────────────────────────────
import Yoga, {
  Align as YAlign,
  Edge as YEdge,
  FlexDirection as YFlexDir,
  Gutter as YGutter,
  Justify as YJustify,
  Overflow as YOverflow,
  PositionType as YPositionType,
  Wrap as YWrap,
} from 'yoga-layout';
import { Edge } from '../src/edge.js';
import { Node } from '../src/node.js';

const FLEX_DIR_MAP: Record<NonNullable<SpecStyle['flexDirection']>, YFlexDir> = {
  row: YFlexDir.Row,
  column: YFlexDir.Column,
  'row-reverse': YFlexDir.RowReverse,
  'column-reverse': YFlexDir.ColumnReverse,
};
const WRAP_MAP: Record<NonNullable<SpecStyle['flexWrap']>, YWrap> = {
  nowrap: YWrap.NoWrap,
  wrap: YWrap.Wrap,
  'wrap-reverse': YWrap.WrapReverse,
};
const JUSTIFY_MAP: Record<NonNullable<SpecStyle['justifyContent']>, YJustify> = {
  'flex-start': YJustify.FlexStart,
  'flex-end': YJustify.FlexEnd,
  center: YJustify.Center,
  'space-between': YJustify.SpaceBetween,
  'space-around': YJustify.SpaceAround,
  'space-evenly': YJustify.SpaceEvenly,
};
const ALIGN_MAP: Record<NonNullable<SpecStyle['alignItems']>, YAlign> = {
  auto: YAlign.Auto,
  'flex-start': YAlign.FlexStart,
  'flex-end': YAlign.FlexEnd,
  center: YAlign.Center,
  stretch: YAlign.Stretch,
  'space-between': YAlign.SpaceBetween,
  'space-around': YAlign.SpaceAround,
};
const POSITION_TYPE_MAP: Record<NonNullable<SpecStyle['positionType']>, YPositionType> = {
  relative: YPositionType.Relative,
  absolute: YPositionType.Absolute,
};
const OVERFLOW_MAP: Record<NonNullable<SpecStyle['overflow']>, YOverflow> = {
  visible: YOverflow.Visible,
  hidden: YOverflow.Hidden,
  scroll: YOverflow.Scroll,
  auto: YOverflow.Hidden, // yoga has no 'auto'; pilates treats it like hidden in practice
};

export interface BuiltTree<T> {
  root: T;
  byId: Map<string, T>;
}

export function buildPilates(spec: SpecNode): BuiltTree<Node> {
  const byId = new Map<string, Node>();
  function go(n: SpecNode): Node {
    const node = Node.create();
    const s = n.style ?? {};
    if (s.flexDirection) node.setFlexDirection(s.flexDirection);
    if (s.flexWrap) node.setFlexWrap(s.flexWrap);
    if (s.width !== undefined) node.setWidth(s.width);
    if (s.height !== undefined) node.setHeight(s.height);
    if (s.minWidth !== undefined) node.setMinWidth(s.minWidth);
    if (s.maxWidth !== undefined) node.setMaxWidth(s.maxWidth);
    if (s.minHeight !== undefined) node.setMinHeight(s.minHeight);
    if (s.maxHeight !== undefined) node.setMaxHeight(s.maxHeight);
    if (s.flexGrow !== undefined) node.setFlexGrow(s.flexGrow);
    if (s.flexShrink !== undefined) node.setFlexShrink(s.flexShrink);
    if (s.flexBasis !== undefined) node.setFlexBasis(s.flexBasis);
    if (s.flex !== undefined) node.setFlex(s.flex);
    if (s.paddingAll !== undefined) node.setPadding(Edge.All, s.paddingAll);
    if (s.paddingTop !== undefined) node.setPadding(Edge.Top, s.paddingTop);
    if (s.paddingRight !== undefined) node.setPadding(Edge.Right, s.paddingRight);
    if (s.paddingBottom !== undefined) node.setPadding(Edge.Bottom, s.paddingBottom);
    if (s.paddingLeft !== undefined) node.setPadding(Edge.Left, s.paddingLeft);
    if (s.marginAll !== undefined) node.setMargin(Edge.All, s.marginAll);
    if (s.marginTop !== undefined) node.setMargin(Edge.Top, s.marginTop);
    if (s.marginRight !== undefined) node.setMargin(Edge.Right, s.marginRight);
    if (s.marginBottom !== undefined) node.setMargin(Edge.Bottom, s.marginBottom);
    if (s.marginLeft !== undefined) node.setMargin(Edge.Left, s.marginLeft);
    if (s.gapRow !== undefined) node.setGap('row', s.gapRow);
    if (s.gapColumn !== undefined) node.setGap('column', s.gapColumn);
    if (s.justifyContent) node.setJustifyContent(s.justifyContent);
    if (s.alignItems) node.setAlignItems(s.alignItems);
    if (s.alignSelf) node.setAlignSelf(s.alignSelf);
    if (s.alignContent) node.setAlignContent(s.alignContent);
    if (s.positionType) node.setPositionType(s.positionType);
    if (s.positionTop !== undefined) node.setPosition(Edge.Top, s.positionTop);
    if (s.positionRight !== undefined) node.setPosition(Edge.Right, s.positionRight);
    if (s.positionBottom !== undefined) node.setPosition(Edge.Bottom, s.positionBottom);
    if (s.positionLeft !== undefined) node.setPosition(Edge.Left, s.positionLeft);
    if (s.aspectRatio !== undefined) node.setAspectRatio(s.aspectRatio);
    if (s.overflow) node.setOverflow(s.overflow);
    if (s.overflowX) node.setOverflowX(s.overflowX);
    if (s.overflowY) node.setOverflowY(s.overflowY);
    byId.set(n.id, node);
    for (let i = 0; i < (n.children?.length ?? 0); i++) {
      node.insertChild(go(n.children![i]!), i);
    }
    return node;
  }
  return { root: go(spec), byId };
}

type YogaNode = import('yoga-layout').Node;

export function buildYoga(spec: SpecNode): BuiltTree<YogaNode> {
  const byId = new Map<string, YogaNode>();
  function go(n: SpecNode): YogaNode {
    const node = Yoga.Node.create();
    const s = n.style ?? {};
    if (s.flexDirection) node.setFlexDirection(FLEX_DIR_MAP[s.flexDirection]);
    if (s.flexWrap) node.setFlexWrap(WRAP_MAP[s.flexWrap]);
    if (s.width !== undefined) node.setWidth(s.width);
    if (s.height !== undefined) node.setHeight(s.height);
    if (s.minWidth !== undefined) node.setMinWidth(s.minWidth);
    if (s.maxWidth !== undefined) node.setMaxWidth(s.maxWidth);
    if (s.minHeight !== undefined) node.setMinHeight(s.minHeight);
    if (s.maxHeight !== undefined) node.setMaxHeight(s.maxHeight);
    if (s.flexGrow !== undefined) node.setFlexGrow(s.flexGrow);
    if (s.flexShrink !== undefined) node.setFlexShrink(s.flexShrink);
    if (s.flexBasis !== undefined) node.setFlexBasis(s.flexBasis);
    if (s.flex !== undefined) node.setFlex(s.flex);
    if (s.paddingAll !== undefined) node.setPadding(YEdge.All, s.paddingAll);
    if (s.paddingTop !== undefined) node.setPadding(YEdge.Top, s.paddingTop);
    if (s.paddingRight !== undefined) node.setPadding(YEdge.Right, s.paddingRight);
    if (s.paddingBottom !== undefined) node.setPadding(YEdge.Bottom, s.paddingBottom);
    if (s.paddingLeft !== undefined) node.setPadding(YEdge.Left, s.paddingLeft);
    if (s.marginAll !== undefined) node.setMargin(YEdge.All, s.marginAll);
    if (s.marginTop !== undefined) node.setMargin(YEdge.Top, s.marginTop);
    if (s.marginRight !== undefined) node.setMargin(YEdge.Right, s.marginRight);
    if (s.marginBottom !== undefined) node.setMargin(YEdge.Bottom, s.marginBottom);
    if (s.marginLeft !== undefined) node.setMargin(YEdge.Left, s.marginLeft);
    if (s.gapRow !== undefined) node.setGap(YGutter.Row, s.gapRow);
    if (s.gapColumn !== undefined) node.setGap(YGutter.Column, s.gapColumn);
    if (s.justifyContent) node.setJustifyContent(JUSTIFY_MAP[s.justifyContent]);
    if (s.alignItems) node.setAlignItems(ALIGN_MAP[s.alignItems]);
    if (s.alignSelf) node.setAlignSelf(ALIGN_MAP[s.alignSelf]);
    if (s.alignContent) node.setAlignContent(ALIGN_MAP[s.alignContent]);
    if (s.positionType) node.setPositionType(POSITION_TYPE_MAP[s.positionType]);
    if (s.positionTop !== undefined) node.setPosition(YEdge.Top, s.positionTop);
    if (s.positionRight !== undefined) node.setPosition(YEdge.Right, s.positionRight);
    if (s.positionBottom !== undefined) node.setPosition(YEdge.Bottom, s.positionBottom);
    if (s.positionLeft !== undefined) node.setPosition(YEdge.Left, s.positionLeft);
    if (s.aspectRatio !== undefined) node.setAspectRatio(s.aspectRatio);
    if (s.overflow) node.setOverflow(OVERFLOW_MAP[s.overflow]);
    // Yoga has no separate setOverflowX/Y; if asymmetric overflow is wanted,
    // the fixture should set `overflow` and the divergence — if any — will be
    // exposed by the runner. Leaving these intentionally unmapped per the
    // spec's "defer divergences" policy.
    byId.set(n.id, node);
    for (let i = 0; i < (n.children?.length ?? 0); i++) {
      node.insertChild(go(n.children![i]!), i);
    }
    return node;
  }
  return { root: go(spec), byId };
}

export function pilatesBox(n: Node): Box {
  const l = n.getComputedLayout();
  return { left: l.left, top: l.top, width: l.width, height: l.height };
}

export function yogaBox(n: YogaNode): Box {
  const l = n.getComputedLayout();
  return { left: l.left, top: l.top, width: l.width, height: l.height };
}

export function collectBoxes<T>(byId: Map<string, T>, getBox: (n: T) => Box): Record<string, Box> {
  const out: Record<string, Box> = {};
  for (const [id, node] of byId) out[id] = getBox(node);
  return out;
}
```

- [ ] **Step 2: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: TDD a builder round-trip — Pilates and Yoga produce identical, expected layouts for one in-memory spec.**

Append to `packages/core/test/fixture-loader.test.ts`:

```ts
import { buildPilates, buildYoga, collectBoxes, pilatesBox, yogaBox } from './fixture-loader.js';
import type { SpecNode } from './fixture-loader.js';

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
    y.root.calculateLayout();
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
```

- [ ] **Step 4: Run the test — expect PASS.**

Run: `pnpm test packages/core/test/fixture-loader.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/test/fixture-loader.ts packages/core/test/fixture-loader.test.ts
git commit -m "test(core): add Pilates+Yoga tree builders to fixture-loader"
```

---

## Task 4: Tree-diff formatter

**Files:**
- Modify: `packages/core/test/fixture-loader.ts`

The diff goes into the vitest assertion message when a fixture fails. It prints expected vs got per id, in tree order.

- [ ] **Step 1: Append `formatBoxDiff` to the loader.**

```ts
import { inspectLayout } from '../src/inspect.js';

/**
 * Pretty-print a Pilates root + a got/expected box map for failure messages.
 * Boxes that match are dimmed (just the id); boxes that diverge show
 * `expected → got` per field.
 */
export function formatBoxDiff(
  label: string,
  expected: Record<string, Box>,
  got: Record<string, Box>,
): string {
  const lines: string[] = [`── ${label} ──`];
  const ids = [...new Set([...Object.keys(expected), ...Object.keys(got)])].sort();
  for (const id of ids) {
    const e = expected[id];
    const g = got[id];
    if (!e) {
      lines.push(`  ${id}: <no expected>  got=${fmt(g!)}`);
      continue;
    }
    if (!g) {
      lines.push(`  ${id}: expected=${fmt(e)}  <no got>`);
      continue;
    }
    if (e.left === g.left && e.top === g.top && e.width === g.width && e.height === g.height) {
      lines.push(`  ${id}: ok  ${fmt(e)}`);
    } else {
      lines.push(`  ${id}: expected=${fmt(e)}  got=${fmt(g)}`);
    }
  }
  return lines.join('\n');
}

function fmt(b: Box): string {
  return `${b.left},${b.top} ${b.width}x${b.height}`;
}

export { inspectLayout };
```

- [ ] **Step 2: TDD the formatter.**

Append to `packages/core/test/fixture-loader.test.ts`:

```ts
import { formatBoxDiff } from './fixture-loader.js';

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
```

- [ ] **Step 3: Run the test.**

Run: `pnpm test packages/core/test/fixture-loader.test.ts`
Expected: 9 passing.

- [ ] **Step 4: Commit.**

```bash
git add packages/core/test/fixture-loader.ts packages/core/test/fixture-loader.test.ts
git commit -m "test(core): add formatBoxDiff for fixture failure messages"
```

---

## Task 5: Parameterized fixture runner

**Files:**
- Create: `packages/core/test/fixtures.test.ts`

Loads every fixture, runs both engines, and asserts each against `expected`. On failure, the message includes both diffs plus a Pilates `inspectLayout`.

- [ ] **Step 1: Write the runner.**

```ts
// packages/core/test/fixtures.test.ts
/**
 * Phase 3.1 declarative-fixture runner. See
 * docs/superpowers/specs/2026-05-25-phase31-yoga-fixture-corpus-design.md.
 *
 * Each fixture under packages/core/test/fixtures/ runs as one `it`,
 * asserting both Pilates and Yoga match the hand-authored expected boxes.
 * Engine ↔ engine disagreement is exposed by either of the two engine-vs-
 * expected assertions failing; the spec's policy is to defer (not commit)
 * such fixtures and file an issue.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPilates,
  buildYoga,
  collectBoxes,
  formatBoxDiff,
  inspectLayout,
  loadFixtures,
  pilatesBox,
  yogaBox,
} from './fixture-loader.js';

const FIXTURES = loadFixtures();

describe('declarative fixtures', () => {
  if (FIXTURES.length === 0) {
    it.skip('no fixtures discovered (will be populated in later tasks)', () => {
      /* intentionally empty */
    });
    return;
  }

  for (const fixture of FIXTURES) {
    const display = `[${fixture.tags.join(',')}] ${fixture.name}`;
    it(display, () => {
      const p = buildPilates(fixture.root);
      p.root.calculateLayout(fixture.available?.width, fixture.available?.height);
      const pBoxes = collectBoxes(p.byId, pilatesBox);

      const y = buildYoga(fixture.root);
      y.root.calculateLayout(fixture.available?.width, fixture.available?.height);
      const yBoxes = collectBoxes(y.byId, yogaBox);

      try {
        expect(pBoxes).toEqual(fixture.expected);
        expect(yBoxes).toEqual(fixture.expected);
      } catch (err) {
        const message =
          `\n${formatBoxDiff('Pilates vs expected', fixture.expected, pBoxes)}\n` +
          `${formatBoxDiff('Yoga vs expected', fixture.expected, yBoxes)}\n` +
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

- [ ] **Step 2: Run the suite — should report 0 tests run (the directory has only `.gitkeep`), but suite must load cleanly.**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: PASS with 1 skipped test ("no fixtures discovered…").

- [ ] **Step 3: Commit.**

```bash
git add packages/core/test/fixtures.test.ts
git commit -m "test(core): add parameterized declarative-fixture runner"
```

---

## Task 6: Author bucket 1 — `flex-direction/` (8 fixtures)

**Files:**
- Create: `packages/core/test/fixtures/flex-direction/*.spec.json` (8 files)

These are the simplest cases and serve as the smoke check for the whole pipeline.

- [ ] **Step 1: Author the 8 fixtures.** For each fixture, derive `expected` by hand from the CSS — then optionally cross-check by running the runner. The fixtures are:

1. `row-basic.spec.json` — row of three fixed-width children, no extra space.
2. `column-basic.spec.json` — column of three fixed-height children.
3. `row-reverse.spec.json` — `row-reverse` with two fixed-width children.
4. `column-reverse.spec.json` — `column-reverse` with two fixed-height children.
5. `row-reverse-asymmetric-padding.spec.json` — covers the `flipMainAxis` regression (mirror about inner content box). Equivalent to `yoga-oracle.test.ts:339`.
6. `column-reverse-asymmetric-padding.spec.json` — same regression on column axis.
7. `row-with-margin.spec.json` — row where children carry `marginLeft` / `marginRight`.
8. `column-with-margin.spec.json` — column where children carry `marginTop` / `marginBottom`.

Example for #1:

```json
{
  "name": "flex-direction/row-basic",
  "tags": ["flex-direction"],
  "root": {
    "id": "root",
    "style": { "flexDirection": "row", "width": 60, "height": 10 },
    "children": [
      { "id": "a", "style": { "width": 20 } },
      { "id": "b", "style": { "width": 15 } },
      { "id": "c", "style": { "width": 25 } }
    ]
  },
  "expected": {
    "root": { "left": 0, "top": 0, "width": 60, "height": 10 },
    "a":    { "left": 0, "top": 0, "width": 20, "height": 10 },
    "b":    { "left": 20, "top": 0, "width": 15, "height": 10 },
    "c":    { "left": 35, "top": 0, "width": 25, "height": 10 }
  }
}
```

Each remaining fixture follows the same shape. Author all 8 before running.

- [ ] **Step 2: Run the suite.**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: 8 passing.

If any fail engine-vs-expected: read the failure diff, fix the expected (your authoring error) or — rare — fix Pilates (real bug, escalate). If engine-vs-engine diverges, **defer that fixture**: delete the file, file an issue with the JSON, add a line to a running `DEFERRED.md` scratch list.

- [ ] **Step 3: Commit.**

```bash
git add packages/core/test/fixtures/flex-direction/
git commit -m "test(core): add flex-direction fixture bucket (8 fixtures)"
```

---

## Task 7: Author bucket 2 — `justify-content/` (10 fixtures)

**Files:**
- Create: `packages/core/test/fixtures/justify-content/*.spec.json` (10 files)

Fixtures: `flex-start`, `flex-end`, `center`, `space-between-2`, `space-between-3`, `space-around-2`, `space-around-3`, `space-evenly-2`, `space-evenly-3`, `center-on-column`.

- [ ] **Step 1: Author the 10 fixtures.** Use the same shape as bucket 1. Mirror the `yoga-oracle.test.ts` justify-content section (lines 402–451) for the simpler cases, then extend to cover `space-evenly` and the 3-item variants.

- [ ] **Step 2: Run the suite.**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: 18 passing.

- [ ] **Step 3: Commit.**

```bash
git add packages/core/test/fixtures/justify-content/
git commit -m "test(core): add justify-content fixture bucket (10 fixtures)"
```

---

## Task 8: Author bucket 3 — `align-items/` + `align-self/` (12 fixtures)

**Files:**
- Create: `packages/core/test/fixtures/align-items/*.spec.json`
- Create: `packages/core/test/fixtures/align-self/*.spec.json`

Split: ~8 `align-items` (flex-start, flex-end, center, stretch, and two variants each on row + column), ~4 `align-self` (override flex-start with flex-end, override center with stretch, etc.).

`baseline` is NOT in the Pilates `Align` union (`packages/core/src/style.ts:25`) — skip baseline fixtures entirely. No bucket capacity is lost; that's why the count is 12 not 16.

- [ ] **Step 1: Author the 12 fixtures.** Use `yoga-oracle.test.ts:454–507` as the seed for shapes.

- [ ] **Step 2: Run the suite.**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: 30 passing.

- [ ] **Step 3: Commit.**

```bash
git add packages/core/test/fixtures/align-items/ packages/core/test/fixtures/align-self/
git commit -m "test(core): add align-items + align-self fixture buckets (12 fixtures)"
```

---

## Task 9: Author bucket 4 — `flex-wrap/` (8 fixtures)

**Files:**
- Create: `packages/core/test/fixtures/flex-wrap/*.spec.json` (8 files)

Fixtures: `wrap-basic`, `wrap-reverse-basic`, `nowrap-overflow`, `wrap-with-justify`, `wrap-with-align-content`, `wrap-3-children-2-lines`, `wrap-column-direction`, `wrap-with-gap`.

- [ ] **Step 1: Author the 8 fixtures.** These are higher-risk for engine-vs-engine divergence — be prepared to defer some. (Yoga's wrap + align-content interaction is the most likely flashpoint.)

- [ ] **Step 2: Run the suite.**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: 38 passing. If any fixture diverges engine-vs-engine, defer and file an issue.

- [ ] **Step 3: Commit.**

```bash
git add packages/core/test/fixtures/flex-wrap/
git commit -m "test(core): add flex-wrap fixture bucket (8 fixtures)"
```

---

## Task 10: Author bucket 5 — `absolute-position/` + `position-edges/` (12 fixtures)

**Files:**
- Create: `packages/core/test/fixtures/absolute-position/*.spec.json`
- Create: `packages/core/test/fixtures/position-edges/*.spec.json`

Split: ~8 absolute (top-left, top-right, bottom-left, bottom-right, sized from left+right, sized from top+bottom, parent-with-padding-edges-relative-to-outer (Yoga 3.x semantics — see `yoga-oracle.test.ts:583`), nested-flex-inside-absolute), ~4 position-edges on relative (positionTop without absolute, etc.).

- [ ] **Step 1: Author the 12 fixtures.** Pull shapes from `yoga-oracle.test.ts:509–617`.

- [ ] **Step 2: Run the suite.**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: 50 passing.

- [ ] **Step 3: Commit.**

```bash
git add packages/core/test/fixtures/absolute-position/ packages/core/test/fixtures/position-edges/
git commit -m "test(core): add absolute-position + position-edges fixture buckets (12 fixtures)"
```

---

## Task 11: Author bucket 6 — `aspect-ratio/` (4 fixtures)

**Files:**
- Create: `packages/core/test/fixtures/aspect-ratio/*.spec.json` (4 files)

Fixtures: `width-defined-height-from-ratio`, `height-defined-width-from-ratio`, `with-flex-grow`, `nested-in-flex-row`.

- [ ] **Step 1: Author the 4 fixtures.** Pilates' `aspectRatio` derivation rules are documented in `style.ts:91-97` — explicit values win over the ratio; only the `'auto'` axis is derived.

- [ ] **Step 2: Run the suite.**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: 54 passing.

- [ ] **Step 3: Commit.**

```bash
git add packages/core/test/fixtures/aspect-ratio/
git commit -m "test(core): add aspect-ratio fixture bucket (4 fixtures)"
```

---

## Task 12: Author bucket 7 — `gap/` (6 fixtures)

**Files:**
- Create: `packages/core/test/fixtures/gap/*.spec.json` (6 files)

Fixtures: `row-gap`, `column-gap`, `gap-with-justify-space-between`, `gap-with-wrap`, `row-and-column-gap`, `gap-3-items-on-column`.

- [ ] **Step 1: Author the 6 fixtures.** Seed shapes from `yoga-oracle.test.ts:267–285`.

- [ ] **Step 2: Run the suite.**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: 60 passing.

- [ ] **Step 3: Commit.**

```bash
git add packages/core/test/fixtures/gap/
git commit -m "test(core): add gap fixture bucket (6 fixtures)"
```

---

## Task 13: Author bucket 8 — `overflow/` (4 fixtures)

**Files:**
- Create: `packages/core/test/fixtures/overflow/*.spec.json` (4 files)

Fixtures: `hidden`, `visible`, `scroll`, `mixed`.

These are minimal — the engines should agree on the box geometry; overflow semantics show up at paint time, not in `getComputedLayout`. So the fixtures are essentially smoke tests confirming the `overflow` setter doesn't perturb layout boxes vs. an otherwise-identical fixture.

- [ ] **Step 1: Author the 4 fixtures.** Example for `hidden`:

```json
{
  "name": "overflow/hidden",
  "tags": ["overflow"],
  "root": {
    "id": "root",
    "style": { "flexDirection": "row", "width": 20, "height": 5, "overflow": "hidden" },
    "children": [{ "id": "kid", "style": { "width": 40, "height": 5 } }]
  },
  "expected": {
    "root": { "left": 0, "top": 0, "width": 20, "height": 5 },
    "kid":  { "left": 0, "top": 0, "width": 40, "height": 5 }
  }
}
```

- [ ] **Step 2: Run the suite.**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: 64 passing.

- [ ] **Step 3: Commit.**

```bash
git add packages/core/test/fixtures/overflow/
git commit -m "test(core): add overflow fixture bucket (4 fixtures)"
```

---

## Task 14: Whole-repo verification

- [ ] **Step 1: Lint.**

Run: `pnpm lint`
Expected: PASS. If biome complains about JSON formatting, run `pnpm format` and commit any changes under a separate `style: ...` commit.

- [ ] **Step 2: Full test pass.**

Run: `pnpm test`
Expected: PASS. The new 64 fixture tests appear in the summary.

- [ ] **Step 3: Differential pass.**

Run: `pnpm test:differential`
Expected: PASS.

- [ ] **Step 4: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS. Per memory `feedback_pilates_typecheck_command`.

- [ ] **Step 5: Full CI dry-run.**

Run: `pnpm ci`
Expected: PASS.

If anything fails: fix in-place, commit, re-run. No `--no-verify`, no skipping.

---

## Task 15: Open the PR

- [ ] **Step 1: Push the branch.**

```bash
git push -u origin tests/fixture-corpus
```

- [ ] **Step 2: Open the PR.** Per memory `feedback_pilates_branch_pr_workflow`.

```bash
gh pr create --title "test(core): Phase 3.1 yoga fixture corpus (~64 declarative .spec.json)" --body "$(cat <<'EOF'
## Summary
- New `.spec.json` corpus under `packages/core/test/fixtures/` (64 fixtures across 8 buckets), each asserting that **both** Pilates and `yoga-layout` match hand-authored expected boxes.
- New loader `packages/core/test/fixture-loader.ts` (schema, discovery, dual-engine builders, tree-diff formatter) + parameterized runner `packages/core/test/fixtures.test.ts`.
- Existing `yoga-oracle.test.ts` is untouched; its inline TS fixtures + regression comments stay as-is.

## Coverage
| Bucket | Fixtures |
|---|---|
| flex-direction | 8 |
| justify-content | 10 |
| align-items + align-self | 12 |
| flex-wrap | 8 |
| absolute-position + position-edges | 12 |
| aspect-ratio | 4 |
| gap | 6 |
| overflow | 4 |
| **Total** | **64** |

`percent-dims` dropped — Pilates `Length = number \| 'auto'`, no percent path. `align-items: baseline` skipped — not in the Pilates `Align` union.

## Deferred (engine ↔ engine divergence)
<!-- Fill in any fixtures deferred during authoring, with issue links. Delete the section if empty. -->
- None.

## Test plan
- [x] `pnpm test`
- [x] `pnpm test:differential`
- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm ci`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return the PR URL** as the deliverable.

---

## Notes

- **Throwaway port script:** if a Yoga gentest port script is written, keep it outside the repo (e.g., `/tmp/`) — the PR diff is JSON + two TS files only.
- **Deferral list:** while authoring, keep a running text file outside the repo with any deferred fixtures + issue URLs. Empty by end of Task 13 in the optimistic case; otherwise paste into the PR's "Deferred" section.
- **Bench guard:** this PR adds tests only; benches are unaffected. No bench-budget changes expected.
- **Memory pointers used:**
  - `feedback_pilates_typecheck_command` — `pnpm typecheck` not `tsc -b`.
  - `feedback_pilates_branch_pr_workflow` — branch + PR for everything.
  - `feedback_pilates_validation_infra_pays_off` — when engines disagree, the differential evidence wins; defer + issue.
  - `feedback_pilates_perf_hypothesis_verify_first` — probed capabilities (aspect-ratio, overflow) before locking the spec.
