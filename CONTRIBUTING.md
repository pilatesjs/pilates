# Contributing to Pilates

Thanks for considering a contribution. This is a small project and the bar
for changes is correctness — every flex behavior is validated cell-for-cell
against a reference implementation, and that bar applies to changes too.

## Setup

```bash
git clone https://github.com/pilatesjs/pilates
cd pilates
pnpm install
pnpm ci   # lint + typecheck + build + test
```

Requires Node 20+ and pnpm 10+. The `packageManager` field in
`package.json` pins the pnpm version Corepack will use.

## Layout

```
packages/
  core/      Engine: imperative Node API, layout algorithm, text measurement
  render/    Out-of-box renderer: declarative tree → painted ANSI string
  diff/      Cell-level frame diff + minimal ANSI redraw
examples/    Runnable CLIs (chat-log, dashboard, gallery, modal,
             progress-table, split-pane)
placeholder/ Stub package claiming the bare `pilates` name on npm
tools/       Build-time helpers (Unicode table generator)
```

## Making a change

1. **Open an issue first** for non-trivial work. Saves us both time if the
   approach needs discussion before implementation.
2. **Branch from `main`** with a descriptive name (`fix/wrap-edge-case`,
   `feat/baseline-alignment`).
3. **Add or update a test** for any user-visible behavior change. New flex
   features must have an oracle fixture in
   `packages/core/test/yoga-oracle.test.ts` so we can prove the layout is
   spec-correct.
4. **Run `pnpm ci`** before opening a PR. CI runs the same on push.
5. **Update `CHANGELOG.md`** when the change affects published packages.

## Commit messages

Conventional-style prefixes: `feat(core):`, `fix(render):`, `docs:`,
`chore:`, `test:`. Keep the subject line under 72 chars; the body explains
the *why*. See `git log --oneline` for recent examples.

## Code style

[Biome](https://biomejs.dev/) handles formatting and most linting:

```bash
pnpm format          # auto-fix formatting
pnpm lint            # check (no fixes)
```

The repo's `biome.json` is the source of truth — please don't override it
in your editor.

## Algorithm changes

Layout is the load-bearing part of this project. Changes to
`packages/core/src/algorithm/` need:

- An oracle fixture proving the output matches the reference WASM
  implementation cell-for-cell
- All 200 existing tests still passing
- A CHANGELOG entry describing the user-visible effect

If a change would *break* an existing oracle fixture, that needs a clear
rationale (and probably an issue discussion first).

## Reporting issues

Use the issue templates. For layout bugs, a minimal reproduction in the
form of a Pilates spec + the actual vs. expected layout boxes is the
fastest path to a fix.
