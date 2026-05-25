# Phase 3.1 — Declarative Yoga Gentest Fixture Corpus

**Status:** approved (design phase)
**Date:** 2026-05-25
**Owner:** Pilates testing roadmap, Phase 3.1
**Branch:** `tests/fixture-corpus`
**Successor:** Phase 3.2 (divergence allowlist + reduction workflow) — out of scope here.

## Goal

Build a static `.spec.json` fixture corpus (≥60 fixtures) for `@pilates/core`,
ported mechanically from Meta Yoga's `gentest/fixtures/*.html`. Each fixture is
a single source of truth that both Pilates and `yoga-layout` (WASM) load,
producing two independently verifiable assertions:

1. Pilates layout matches hand-authored expected boxes.
2. `yoga-layout` matches the same expected boxes.

Both assertions failing the same way catches cases where Pilates and Yoga
drift from CSS spec together — the existing `yoga-oracle.test.ts` cannot do
this (it has no third reference point).

## Non-goals

- **No divergence allowlist.** If any fixture surfaces Pilates ↔ Yoga
  disagreement, the fixture is *deferred* (not committed) and an issue is
  filed with the JSON as repro seed. Allowlist plumbing is Phase 3.2.
- **No replacement of `yoga-oracle.test.ts`.** That file's hand-curated TS
  fixtures stay — their inline regression comments (e.g., `flipMainAxis`
  history) are documentation, not duplication.
- **No replacement of `properties.test.ts`.** Fast-check differential fuzzing
  runs alongside.
- **No `percent-dims` bucket.** Pilates `Length = number | 'auto'`
  (`packages/core/src/style.ts:41`); percent values are not a supported
  capability. Bucket removed from the user prompt's original list.

## Capability probe (2026-05-25)

| Capability | Status | Notes |
|---|---|---|
| `aspect-ratio` | ✅ | `Node.setAspectRatio(number \| undefined)` (`node.ts:359`) |
| `overflow` | ✅ | `setOverflow` / `setOverflowX` / `setOverflowY` (`node.ts:437`) |
| `percent-dims` | ❌ | `Length = number \| 'auto'`; no percent path |
| All other prompt-listed tags | ✅ | Match existing `SpecNode` shape in `yoga-oracle.test.ts` |

## Schema

### File: `packages/core/test/fixtures/<tag>/<name>.spec.json`

```jsonc
{
  "name": "justify-content/space-between-row",
  "tags": ["justify-content", "flex-direction"],
  "available": { "width": 60, "height": 5 },
  "root": {
    "id": "root",
    "style": {
      "flexDirection": "row",
      "width": 60,
      "height": 5,
      "justifyContent": "space-between"
    },
    "children": [
      { "id": "a", "style": { "width": 10 } },
      { "id": "b", "style": { "width": 10 } },
      { "id": "c", "style": { "width": 10 } }
    ]
  },
  "expected": {
    "root": { "left": 0, "top": 0, "width": 60, "height": 5 },
    "a":    { "left": 0,  "top": 0, "width": 10, "height": 5 },
    "b":    { "left": 25, "top": 0, "width": 10, "height": 5 },
    "c":    { "left": 50, "top": 0, "width": 10, "height": 5 }
  }
}
```

### Field semantics

- **`name`** (string, required) — display name in test output. Should be
  `<bucket>/<short-slug>`; the loader does not enforce this but the corpus
  convention does.
- **`tags`** (string[], required) — non-empty array of tag enum values (see
  below). Used for filtering: a future `vitest -t "tag:gap"` invocation picks
  up only gap-tagged fixtures.
- **`available`** (`{ width?: number, height?: number }`, optional) — passed
  to `calculateLayout(availableWidth, availableHeight)`. Omit for fully-sized
  roots.
- **`root`** (`SpecNode`, required) — see below.
- **`expected`** (`Record<id, Box>`, required) — every node in the tree must
  have a corresponding expected box. `Box = { left, top, width, height }`,
  all integers (Pilates and Yoga both use cell-aligned `pointScaleFactor=1`).

### `SpecNode`

```ts
interface SpecNode {
  id: string;                    // unique within fixture
  style?: SpecStyle;             // omittable for default-style nodes
  children?: SpecNode[];
}
```

`SpecStyle` is a JSON-serializable subset of `Node`'s setters. It mirrors
the existing `SpecNode` shape in `yoga-oracle.test.ts` (camelCase, Pilates
type union, no CSS kebab-case), extended with:

- `aspectRatio?: number`
- `overflow?: 'visible' | 'hidden' | 'scroll'`
- `overflowX?`, `overflowY?` (same union)

All numeric values are integers. All enum values are the literal-union string
types from `packages/core/src/style.ts`.

### Tag enum

```
flex-direction | justify-content | align-items | align-self | flex-wrap
| absolute-position | aspect-ratio | gap | overflow | position-edges
```

The loader narrows `tags` to this enum and rejects unknown values at load
time. Multi-tagged fixtures are encouraged: `space-between-with-gap` should
carry both `justify-content` and `gap`.

## Files added

### `packages/core/test/fixture-loader.ts`

Exports:

```ts
export interface Fixture { /* schema above */ }
export function loadFixtures(dir?: string): Fixture[];   // default: ./fixtures
export function buildPilates(spec: SpecNode): { root: Node, byId: Map<string, Node> };
export function buildYoga(spec: SpecNode): { root: YNode, byId: Map<string, YNode> };
export function collectBoxes<T>(byId: Map<string, T>, getBox: (n: T) => Box): Record<string, Box>;
export function formatTreeDiff(expected: Record<string, Box>, got: Record<string, Box>): string;
```

Implementation notes:
- `buildPilates` / `buildYoga` are factored from the equivalents in
  `yoga-oracle.test.ts`. That file does **not** import from the loader (its
  helpers stay inline for clarity); the loader copies the dispatch tables.
  Duplication is intentional — these are two unrelated test surfaces.
- `formatTreeDiff` uses `inspectLayout` from `packages/core/src/algorithm/inspect.ts`
  to pretty-print the Pilates tree, then renders Yoga + expected as
  side-by-side columns keyed on id. Output goes through `expect`'s message
  channel (no direct `console.log`).
- File discovery: `fs.readdirSync(dir, { withFileTypes: true, recursive: true })`,
  filter to `.spec.json`, sort for determinism.

### `packages/core/test/fixtures.test.ts`

```ts
describe('declarative fixtures', () => {
  for (const fixture of loadFixtures()) {
    const display = `[${fixture.tags.join(',')}] ${fixture.name}`;
    it(display, () => {
      const { root: pRoot, byId: pIds } = buildPilates(fixture.root);
      pRoot.calculateLayout(fixture.available?.width, fixture.available?.height);
      const pBoxes = collectBoxes(pIds, n => /* Pilates Box */);

      const { root: yRoot, byId: yIds } = buildYoga(fixture.root);
      yRoot.calculateLayout(fixture.available?.width, fixture.available?.height);
      const yBoxes = collectBoxes(yIds, n => /* Yoga Box */);
      yRoot.freeRecursive();

      try {
        expect(pBoxes).toEqual(fixture.expected);
        expect(yBoxes).toEqual(fixture.expected);
      } catch (err) {
        throw new Error(formatTreeDiff(fixture.expected, pBoxes) + '\n' +
                        formatTreeDiff(fixture.expected, yBoxes) +
                        '\n--- original ---\n' + (err as Error).message);
      }
    });
  }
});
```

The three-way comparison (Pilates vs expected, Yoga vs expected) is preferred
over Pilates-vs-Yoga because:
- It catches cases where both engines drift together from CSS spec.
- It produces a cleaner failure message: "Pilates broke" vs "Yoga broke" vs
  "we authored the expected wrong".

A redundant `expect(pBoxes).toEqual(yBoxes)` is **not** added — passing the
two anchored assertions implies it.

### `packages/core/test/fixtures/`

Directory tree (one dir per primary tag), with 64 fixtures distributed as:

| Directory | Count | Sample fixtures |
|---|---|---|
| `flex-direction/` | 8 | `row-basic`, `column-basic`, `row-reverse-padding`, `column-reverse-padding`, `row-with-margins`, ... |
| `justify-content/` | 10 | `flex-start`, `flex-end`, `center`, `space-between-2`, `space-between-3`, `space-around-2`, `space-around-3`, `space-evenly-2`, `space-evenly-3`, `center-on-column` |
| `align-items/`, `align-self/` | 12 | combined: `align-items-{flex-start,flex-end,center,stretch,baseline*}`, `align-self-overrides`, `align-self-stretch`, ... (*if Pilates supports `baseline`; probe at fixture-authoring time, drop if not) |
| `flex-wrap/` | 8 | `wrap-basic`, `wrap-reverse`, `nowrap-overflow`, `wrap-with-justify`, `wrap-with-align-content`, ... |
| `absolute-position/`, `position-edges/` | 12 | combined: top-left/top-right/bottom-left/bottom-right anchored, left+right sizing, top+bottom sizing, nested-in-flex, padding-relative-to-outer (Yoga 3.x semantics), ... |
| `aspect-ratio/` | 4 | `width-defined`, `height-defined`, `with-flex-grow`, `nested` |
| `gap/` | 6 | `row-gap`, `column-gap`, `gap-with-justify`, `gap-with-wrap`, `row-and-column-gap`, `gap-3-items` |
| `overflow/` | 4 | `hidden`, `visible`, `scroll`, `mixed-x-y` |
| **Total** | **64** | |

Counts are minimums; if a port from Yoga's gentest is mechanical and
non-redundant, include it.

## Sourcing fixtures from Yoga gentest

1. Clone `facebook/yoga` to a scratch directory **outside the repo**:
   `cd /tmp && git clone --depth 1 https://github.com/facebook/yoga.git`.
2. Source files: `yoga/gentest/fixtures/*.html`. Each HTML file contains one
   or more rooted `<div>` trees with inline `style="..."` and data attributes
   that drive Yoga's own test generator.
3. Port mechanically: parse the inline CSS, map kebab-case → camelCase,
   reject unsupported properties (percent dims, anything not in our `SpecStyle`).
4. **The expected boxes are NOT taken from Yoga's gentest output.** Instead,
   author them by hand from the CSS layout — that is the entire point of
   this corpus (catching engines that drift together). It is acceptable to
   sanity-check a freshly authored fixture by running both engines once;
   the *committed* expected values are still hand-derived.
5. A throwaway porting script is fine but **not committed** — its output
   needs human review for the camelCase + supported-prop filter anyway.

## Divergence policy

Per Phase 3.1's non-goals, when a fixture exposes Pilates ↔ Yoga disagreement:

1. **Do not commit the fixture.**
2. Open a GitHub issue with:
   - the fixture JSON,
   - both engines' actual boxes,
   - the hand-authored expected box,
   - a one-line hypothesis on which engine is wrong.
3. Leave the divergence for Phase 3.2's allowlist + reduction workflow.

The PR description lists every deferred fixture by name with the linked
issue. Per memory `feedback_pilates_validation_infra_pays_off`: if Pilates
and Yoga disagree and reasoning sides with Pilates, the fuzzer is usually
right. Same applies to gentest fixtures.

## Definition of done

- `packages/core/test/fixtures/` populated, ≥60 fixtures across applicable
  buckets.
- `packages/core/test/fixture-loader.ts` and `packages/core/test/fixtures.test.ts`
  present and green.
- `pnpm test` green.
- `pnpm test:differential` green (the fixture runner is part of `packages/core`).
- `pnpm typecheck` clean (per memory `feedback_pilates_typecheck_command` —
  not `tsc -b`).
- PR `tests/fixture-corpus` → `main`, branch+PR workflow per memory
  `feedback_pilates_branch_pr_workflow`. PR description enumerates any
  deferred fixtures + linked issues.

## Risks / open questions

- **`align-items: baseline`** — Pilates support unknown; probe before
  authoring the bucket. If unsupported, the align bucket caps at ~10
  fixtures (still over the per-bucket floor).
- **Yoga 3.x absolute-position semantics** — Pilates already pins these
  (see `yoga-oracle.test.ts:583`). Fixtures should target the *current*
  behavior (edges relative to outer box) — fixtures authoring "inner box"
  expected values is the most likely source of hand-authoring errors.
- **Throwaway port script visibility** — keep it out of the repo entirely;
  the PR diff should be JSON + two TS files only.
