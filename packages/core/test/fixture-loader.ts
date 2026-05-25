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
