# Phase 3.2 — Divergence Allowlist + Reduction Workflow

**Status:** approved (design phase)
**Date:** 2026-05-25
**Branch:** `feat/divergence-allowlist-and-reduction`
**Predecessor:** Phase 3.1 yoga fixture corpus (PR #149, merged at `2a2fb36`).

## Goal

Two related deliverables, scoped to a single PR:

1. **Divergence allowlist** — extend the `.spec.json` schema so a fixture
   can encode known engine divergence (one expected box-map per engine
   plus a required `divergenceReason`). The runner asserts each engine
   against its own expected. Today the only options are "defer to
   `DEFERRED-FIXTURES.md`" or "fix one engine"; this lets us commit
   long-lived intentional divergences.
2. **Reduction tool** — `tools/reduce-fixture.ts`, a CLI that takes a
   tree spec (e.g. a fast-check counterexample's `NodeSpec`) and emits a
   ready-to-commit `.spec.json` with actual engine outputs pre-filled.
   Eliminates the hand-port step.

## Non-goals

- **No automatic shrinking inside the tool.** Fast-check already shrinks;
  re-shrinking is out of scope.
- **No GUI or interactive picker.** CLI only.
- **No retroactive remediation of `DEFERRED-FIXTURES.md`** — that file was
  removed in PR #152. The allowlist replaces it for future divergences.

## Schema extension

Today a fixture has `expected: Record<id, Box>`. Extend to allow EITHER
the consensus shape OR a divergence shape, never both.

### Consensus shape (unchanged)

```jsonc
{
  "name": "...",
  "tags": ["..."],
  "root": { ... },
  "expected": { "id": { "left": 0, "top": 0, "width": 0, "height": 0 } }
}
```

### Divergence shape (new)

```jsonc
{
  "name": "position-edges/<example>",
  "tags": ["position-edges", "divergent"],
  "divergenceReason": "Pilates clamps negative top to 0 to avoid corrupting sibling cells; Yoga 3.x allows negative tops since browsers can overflow.",
  "root": { ... },
  "expectedPilates": { "id": { "left": 0, "top": 0, ... } },
  "expectedYoga":    { "id": { "left": 0, "top": -2, ... } }
}
```

### Loader contract additions

- Exactly one of these must hold:
  - `expected` is set AND `expectedPilates` / `expectedYoga` /
    `divergenceReason` are all absent.
  - `expectedPilates` AND `expectedYoga` AND `divergenceReason` are all
    set AND `expected` is absent.
- `divergenceReason` must be a non-empty string.
- Both `expectedPilates` and `expectedYoga` must cover the same id set
  as the tree (existing two-way validation runs against each separately).
- The string `"divergent"` is a reserved tag value, added to `FixtureTag`.
  Divergent fixtures MUST carry this tag; the loader asserts the
  invariant in both directions (tag present iff divergence-shape used).

The loader's `Fixture` interface gains a discriminated union:

```ts
interface FixtureBase { name, tags, sourcePath, available?, root }
interface ConsensusFixture extends FixtureBase {
  expected: Record<string, Box>;
}
interface DivergentFixture extends FixtureBase {
  divergenceReason: string;
  expectedPilates: Record<string, Box>;
  expectedYoga: Record<string, Box>;
}
type Fixture = ConsensusFixture | DivergentFixture;
```

A helper `isDivergent(f: Fixture): f is DivergentFixture` narrows the
union for consumers.

### Runner behavior

`fixtures.test.ts`:

- Consensus fixture: unchanged — assert both engines match `expected`.
- Divergent fixture: assert Pilates matches `expectedPilates`; assert
  Yoga matches `expectedYoga`. Both must match (so a future Pilates fix
  that *agrees with Yoga* still fails — forcing the fixture to be
  re-classified as consensus).

The test display name includes `[divergent]` for divergent fixtures so
they stand out in the suite output.

## Reduction tool — `tools/reduce-fixture.ts`

### Invocation

```bash
pnpm tsx tools/reduce-fixture.ts <input.json> [--available WxH] [--out <path>] [--name <name>]
```

- `<input.json>`: a JSON file containing one of:
  - A `SpecNode` tree directly: `{ "id": "...", "style": ..., "children": [...] }`. `id` optional — auto-assigned `n0` (root), `n1`, ... in DFS pre-order if absent.
  - A fast-check counterexample array, when invoked with `--fast-check`:
    `[NodeSpec, ...other-args]` — only the first array element (the tree)
    is read.
- `--available WxH`: optional, e.g. `--available 40x10`. Default: omit.
- `--out <path>`: write the .spec.json to this path. Default: stdout.
- `--name <name>`: set the `name` field on the emitted fixture. Default:
  `tmp/<unnamed>`.

### Behavior

1. Read + parse input.
2. Build Pilates + Yoga trees via the loader's `buildPilates` /
   `buildYoga`.
3. Run `calculateLayout(availW, availH)` on both.
4. Collect actual boxes per id from each engine.
5. Compare deep-equal:
   - **Agree**: emit a consensus fixture with `expected` =
     consensus boxes.
   - **Disagree**: emit a divergent fixture with `expectedPilates` =
     Pilates actuals, `expectedYoga` = Yoga actuals, and
     `divergenceReason: "<TODO: fill in>"`. Print a leading comment line
     to stderr telling the user to fill in the reason and add the
     `divergent` tag before committing.
6. Emit a `tags: []` placeholder — user fills in.

### Output formatting

JSON, 2-space indent, matches biome's existing JSON style so `pnpm
format` is a no-op on commit. The tool delegates to `JSON.stringify(v,
null, 2)` then runs biome-equivalent compaction is OUT OF SCOPE — accept
that `pnpm format` will re-flow once the user commits.

### Where the tool lives

`tools/reduce-fixture.ts` at the repo root, matching
`tools/generate-unicode-tables.ts` convention. Not packaged with
`@pilates/core` — pure dev-time utility.

## Tests

### Loader

Extend `packages/core/test/fixture-loader.test.ts`:

- Accepts a valid consensus fixture (existing — no change).
- Accepts a valid divergent fixture (new).
- Rejects: both `expected` AND `expectedPilates` set.
- Rejects: only `expectedPilates` (missing `expectedYoga`).
- Rejects: divergent shape without `divergenceReason`.
- Rejects: empty-string `divergenceReason`.
- Rejects: `divergent` tag without divergent shape.
- Rejects: divergent shape without `divergent` tag.

### Reduction tool

`tools/reduce-fixture.test.ts`:

- Agree path: input tree → emitted fixture has `expected` + no
  divergent fields.
- Disagree path: requires a known-divergent input. **Probe-first**: at
  implementation time, scan for one. If found, use it. If not, the
  disagree branch test uses a **synthetic** test that mocks the
  builder helpers to force disagreement (e.g., a builder that adds 1 to
  Yoga's left). The synthetic-mock path is acceptable because we're
  testing the TOOL's branching, not the engines.
- Auto-ID assignment: input without `id` → output has `n0`, `n1`, ...
- Fast-check input mode: `[tree, ...]` is read correctly.

### Reference divergent fixture

DoD requires one committed divergent fixture so the runner branch is
exercised at suite-run time. **Probe Pilates for a real intentional
divergence first.** Likely candidates to probe (look but don't assume):

- Negative position values clipping.
- Overflow behavior at non-zero `pointScaleFactor` (Pilates uses 1, but
  edge cases may differ).
- Any `aspectRatio` corner where Pilates intentionally rounds
  differently.

If probe finds nothing real: commit a single synthetic
divergent fixture where the divergence is forced by a Pilates-specific
style prop Yoga ignores (e.g., `overflowX: 'scroll'` with `overflowY:
'visible'` — Pilates honors per-axis; Yoga only honors the shorthand).
The fixture is small, the divergence is documented and intentional, and
it exercises the runner branch genuinely.

## Documentation

Short section appended to `README.md` (or a new `docs/` page if README
is already crowded):

```markdown
### Reducing fuzzer counterexamples to fixtures

When a fuzz test fails with a JSON counterexample, port it to a
hand-readable `.spec.json` fixture via:

    pnpm tsx tools/reduce-fixture.ts counterexample.json --fast-check --out packages/core/test/fixtures/<bucket>/<name>.spec.json

If the two engines agree, the emitted fixture is consensus. If they
disagree, the emitted fixture uses the divergence shape — fill in the
`divergenceReason` and add the `divergent` tag before committing.
```

## Risks

- **Schema drift between loader and tool.** The tool emits JSON;
  the loader validates it. A schema mismatch between the two surfaces
  silently at PR time. Mitigation: the tool imports the loader's types
  directly (no duplicated shape definitions) and round-trips its output
  through the loader as a self-test before writing.
- **Auto-assigned ids overwrite meaningful ids.** Mitigation: only
  assign `n0`, `n1`, ... when the input lacks ALL ids; if any node has
  an id, assume the user wants them all preserved (and validate the
  required uniqueness via the loader).
- **Probe-first for the reference fixture.** Pilates may have no real
  divergence today; synthetic fallback is documented.

## Definition of done

- Loader accepts both consensus and divergent shapes; validates the
  invariants above; existing 68 fixtures continue to pass.
- `Fixture` type is a discriminated union with `isDivergent` helper.
- `tools/reduce-fixture.ts` works on at least the agree-path test
  input; disagree-path covered by either a real divergent input or the
  synthetic-mock test.
- One reference divergent fixture committed (real if probe finds one,
  synthetic otherwise) so the runner branch is exercised.
- `README.md` section on the reduction workflow.
- `pnpm test`, `pnpm test:differential`, `pnpm typecheck`, `pnpm lint`,
  `pnpm run ci` all green.
- PR opened against `main` per the branch+PR workflow.
